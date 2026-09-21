import crypto from 'node:crypto';
import type pg from 'pg';
import { config } from '../config.js';
import { licenseKeyHash } from '../license/crypto.js';
import { commercialLifecycle, type CommercialLifecycle, type CommercialLifecycleRow } from '../license/lifecycle.js';
import { provisionTenantDatabase, tenantIdentifiers, type TenantProvisioningSetup } from './tenant-provisioning.js';

type Recipe = {
  business: TenantProvisioningSetup['business'];
  enabled_features: string[];
  admin: TenantProvisioningSetup['admin'];
};

function parseJson(value: unknown) {
  if (typeof value === 'string') return JSON.parse(value) as unknown;
  return value;
}

type QueryRow = Record<string, unknown>;

type Runtime = {
  business: QueryRow;
  schemaVersion?: string | null;
};

type ProvisionedBusiness = {
  license: QueryRow;
};

function machineErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function recipeFromRow(row: QueryRow): Recipe {
  const value = parseJson(row.setup) as Partial<Recipe> | null;
  if (!value?.business || !value.admin || !Array.isArray(value.enabled_features)) {
    throw Object.assign(new Error('Internal provisioning data is incomplete.'), {
      statusCode: 409,
      code: 'PROVISIONING_RECIPE_INVALID',
    });
  }
  return value as Recipe;
}

function lifecycleRowQuery(where = 'vb.id=$1') {
  return `
    select
      vb.id vendor_business_id,
      vb.status vendor_business_status,
      l.id license_id,
      l.status license_status,
      l.expires_at license_expires_at,
      l.max_devices,l.max_desktop_devices,l.max_web_devices,l.max_mobile_devices,
      t.status tenant_status,
      p.last_error_code provisioning_error_code,
      (select b.id from businesses b where b.vendor_business_id=vb.id limit 1) runtime_business_id
    from vendor_businesses vb
    left join lateral (
      select id,status,expires_at,max_devices,max_desktop_devices,max_web_devices,max_mobile_devices
      from licenses
      where vendor_business_id=vb.id
      order by issued_at desc,created_at desc
      limit 1
    ) l on true
    left join saas_tenants t on t.vendor_business_id=vb.id
    left join vendor_business_provisioning p on p.vendor_business_id=vb.id
    where ${where}
  `;
}

export async function readVendorBusinessLifecycle(
  controlPool: pg.Pool,
  vendorBusinessId: string,
): Promise<CommercialLifecycle> {
  const row = (await controlPool.query(lifecycleRowQuery(), [vendorBusinessId])).rows[0];
  return commercialLifecycle(row as CommercialLifecycleRow, config.SAAS_TENANCY_MODE);
}

async function ensureSharedRuntimeBusiness(
  client: pg.PoolClient,
  vendorBusinessId: string,
  recipe: Recipe,
  passwordHash: string,
) {
  const identifiers = tenantIdentifiers(recipe.business.name, vendorBusinessId);
  let business: QueryRow | undefined = (await client.query(
    'select * from businesses where vendor_business_id=$1 limit 1 for update',
    [vendorBusinessId],
  )).rows[0];

  if (!business) {
    business = (await client.query(
      `insert into businesses(name,slug,business_type,logo,currency,locale,timezone,vendor_business_id)
       values($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        recipe.business.name,
        identifiers.slug,
        recipe.business.business_type,
        recipe.business.logo ?? null,
        recipe.business.currency.toUpperCase(),
        recipe.business.locale,
        recipe.business.timezone,
        vendorBusinessId,
      ],
    )).rows[0];
  }
  if (!business) {
    throw Object.assign(new Error('Internal shared-business provisioning did not create the business record.'), {
      statusCode: 500,
      code: 'TENANT_PROVISIONING_INCOMPLETE',
    });
  }

  let branch: QueryRow | undefined = (await client.query(
    'select * from branches where business_id=$1 order by id limit 1',
    [business.id],
  )).rows[0];
  if (!branch) {
    branch = (await client.query(
      `insert into branches(business_id,name,code,address,phone)
       values($1,'Principal','MAIN',$2,$3) returning *`,
      [business.id, recipe.business.address ?? null, recipe.business.phone ?? null],
    )).rows[0];
  }
  if (!branch) {
    throw Object.assign(new Error('Internal shared-business provisioning did not create the main branch.'), {
      statusCode: 500,
      code: 'TENANT_PROVISIONING_INCOMPLETE',
    });
  }

  for (const feature of [...new Set(recipe.enabled_features)]) {
    await client.query(
      'insert into business_features(business_id,feature) values($1,$2) on conflict do nothing',
      [business.id, feature],
    );
  }

  const normalizedEmail = recipe.admin.email.toLowerCase();
  let owner: QueryRow | null = (await client.query(
    "select id,name,email,role,is_active from users where business_id=$1 and role in ('patron','owner') order by id limit 1 for update",
    [business.id],
  )).rows[0] ?? null;
  if (owner && String(owner.email).toLowerCase() !== normalizedEmail) {
    throw Object.assign(new Error('The existing business owner does not match the internal provisioning record.'), {
      statusCode: 409,
      code: 'TENANT_OWNER_MISMATCH',
    });
  }
  if (!owner) {
    owner = (await client.query(
      `insert into users(business_id,branch_id,name,email,password,role,is_active)
       values($1,$2,$3,$4,$5,'patron',true)
       returning id,name,email,role,is_active`,
      [business.id, branch.id, recipe.admin.name, normalizedEmail, passwordHash],
    )).rows[0];
  }
  if (!owner) {
    throw Object.assign(new Error('Internal shared-business provisioning did not return complete records.'), {
      statusCode: 500,
      code: 'TENANT_PROVISIONING_INCOMPLETE',
    });
  }
  return { business, branch, owner, identifiers };
}

/**
 * Completes a Vendor-created business without a customer credential. The
 * durable recipe lets a Vendor retry safely after infrastructure failures;
 * tenant and runtime creation are independently idempotent.
 */
export async function provisionVendorBusiness(
  controlPool: pg.Pool,
  vendorBusinessId: string,
  actor: string,
) {
  const initial = (await controlPool.query(
    `select vb.*,p.setup,p.owner_password_hash,p.plan_id,p.license_expires_at,
            p.offline_validity_days,p.notes
     from vendor_businesses vb
     join vendor_business_provisioning p on p.vendor_business_id=vb.id
     where vb.id=$1`,
    [vendorBusinessId],
  )).rows[0];
  if (!initial) {
    throw Object.assign(new Error('Internal provisioning data is unavailable for this business.'), {
      statusCode: 409,
      code: 'PROVISIONING_RECIPE_MISSING',
    });
  }
  if (initial.status !== 'active') {
    throw Object.assign(new Error('This business is not active.'), {
      statusCode: 409,
      code: 'VENDOR_BUSINESS_INACTIVE',
    });
  }

  const recipe = recipeFromRow(initial as QueryRow);
  const identifiers = tenantIdentifiers(recipe.business.name, vendorBusinessId);
  await controlPool.query(
    `update vendor_business_provisioning
     set attempts=attempts+1,last_attempt_at=now(),last_error_code=null,updated_at=now()
     where vendor_business_id=$1`,
    [vendorBusinessId],
  );

  try {
    let runtime: Runtime;
    if (config.SAAS_TENANCY_MODE === 'database_per_tenant') {
      await controlPool.query(
        `insert into saas_tenants(vendor_business_id,slug,database_name,status,last_error)
         values($1,$2,$3,'provisioning',null)
         on conflict(vendor_business_id) do update set
           status=case when saas_tenants.status='active' then 'active' else 'provisioning' end,
           last_error=null,updated_at=now()`,
        [vendorBusinessId, identifiers.slug, identifiers.databaseName],
      );
      const result = await provisionTenantDatabase({
        vendorBusinessId,
        setup: recipe,
        passwordHash: String(initial.owner_password_hash),
      });
      runtime = { ...result, schemaVersion: result.schemaVersion };
    } else {
      const client = await controlPool.connect();
      try {
        await client.query('begin');
        runtime = await ensureSharedRuntimeBusiness(client, vendorBusinessId, recipe, String(initial.owner_password_hash));
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    let completed: ProvisionedBusiness | null = null;
    const client = await controlPool.connect();
    try {
      await client.query('begin');
      const current = (await client.query(
        `select vb.*,p.plan_id,p.license_expires_at,p.offline_validity_days,p.notes
         from vendor_businesses vb
         join vendor_business_provisioning p on p.vendor_business_id=vb.id
         where vb.id=$1 for update of vb,p`,
        [vendorBusinessId],
      )).rows[0];
      if (!current || current.status !== 'active') {
        throw Object.assign(new Error('This business is no longer active.'), {
          statusCode: 409,
          code: 'VENDOR_BUSINESS_INACTIVE',
        });
      }

      const plan = (await client.query(
        'select * from license_plans where id=$1 and active=true for share',
        [current.plan_id],
      )).rows[0];
      if (!plan) {
        throw Object.assign(new Error('The selected plan is no longer active.'), {
          statusCode: 422,
          code: 'PLAN_NOT_FOUND',
        });
      }

      let license = (await client.query(
        'select * from licenses where vendor_business_id=$1 order by issued_at desc,created_at desc limit 1 for update',
        [vendorBusinessId],
      )).rows[0];
      if (!license) {
        const opaqueKey = crypto.randomBytes(32).toString('base64url');
        license = (await client.query(
          `insert into licenses(
            customer_id,vendor_business_id,plan_id,key_hash,status,business_type,allowed_features,
            max_devices,max_desktop_devices,max_web_devices,max_mobile_devices,
            expires_at,offline_validity_days,notes
          ) values($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
          [
            current.customer_id,
            current.id,
            plan.id,
            licenseKeyHash(opaqueKey),
            current.business_type,
            JSON.stringify(recipe.enabled_features),
            Number(plan.default_device_limit),
            plan.default_desktop_device_limit ?? null,
            plan.default_web_device_limit ?? null,
            plan.default_mobile_device_limit ?? null,
            current.license_expires_at ?? null,
            current.offline_validity_days ?? plan.offline_validity_days ?? null,
            current.notes ?? 'Created during internal Vendor provisioning',
          ],
        )).rows[0];
      }

      if (config.SAAS_TENANCY_MODE === 'database_per_tenant') {
        const shadow = (await client.query(
          'select * from businesses where vendor_business_id=$1 limit 1 for update',
          [vendorBusinessId],
        )).rows[0] ?? (await client.query(
          `insert into businesses(name,slug,business_type,logo,currency,locale,timezone,vendor_business_id)
           values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [
            recipe.business.name,
            identifiers.slug,
            recipe.business.business_type,
            recipe.business.logo ?? null,
            recipe.business.currency.toUpperCase(),
            recipe.business.locale,
            recipe.business.timezone,
            vendorBusinessId,
          ],
        )).rows[0];
        await client.query(
          `update saas_tenants set control_business_id=$2,status='active',schema_version=$3,
             provisioned_at=coalesce(provisioned_at,now()),last_error=null,updated_at=now()
           where vendor_business_id=$1`,
          [vendorBusinessId, shadow.id, runtime.schemaVersion ?? null],
        );
        await client.query(
          `insert into business_licenses(business_id,license_id,status) values($1,$2,'active')
           on conflict(business_id) do update set license_id=excluded.license_id,status='active',updated_at=now()`,
          [shadow.id, license.id],
        );
      } else {
        await client.query(
          `insert into business_licenses(business_id,license_id,status) values($1,$2,'active')
           on conflict(business_id) do update set license_id=excluded.license_id,status='active',updated_at=now()`,
          [runtime.business.id, license.id],
        );
      }

      await client.query(
        `update vendor_business_provisioning
         set completed_at=coalesce(completed_at,now()),last_error_code=null,updated_at=now()
         where vendor_business_id=$1`,
        [vendorBusinessId],
      );
      await client.query(
        `insert into license_audit_logs(actor,action,entity_type,entity_id,description)
         values($1,'tenant.provision.complete','vendor_business',$2,$3)`,
        [actor, vendorBusinessId, 'Business provisioned internally and is ready for device activation'],
      );
      await client.query('commit');
      completed = { license: license as QueryRow };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    // Query on a separate connection only after the control-plane transaction
    // commits; before that, PostgreSQL would correctly report the new runtime
    // and licence as invisible and return a false PROVISIONING state.
    if (!completed) {
      throw Object.assign(new Error('Internal provisioning did not complete its control-plane transaction.'), {
        statusCode: 500,
        code: 'TENANT_PROVISIONING_INCOMPLETE',
      });
    }
    return {
      license: completed.license,
      lifecycle: await readVendorBusinessLifecycle(controlPool, vendorBusinessId),
    };
  } catch (error) {
    const machineCode = machineErrorCode(error);
    const errorCode = machineCode
      ? machineCode.slice(0, 80)
      : 'TENANT_PROVISIONING_FAILED';
    await controlPool.query(
      `update vendor_business_provisioning
       set last_error_code=$2,updated_at=now() where vendor_business_id=$1`,
      [vendorBusinessId, errorCode],
    );
    if (config.SAAS_TENANCY_MODE === 'database_per_tenant') {
      await controlPool.query(
        `update saas_tenants set status='error',last_error=$2,updated_at=now()
         where vendor_business_id=$1 and status<>'active'`,
        [vendorBusinessId, errorCode],
      );
    }
    await controlPool.query(
      `insert into license_audit_logs(actor,action,entity_type,entity_id,description)
       values($1,'tenant.provision.failed','vendor_business',$2,$3)`,
      [actor, vendorBusinessId, `Internal provisioning failed: ${errorCode}`],
    );
    throw Object.assign(new Error('Business provisioning could not be completed. Retry it from the Vendor Console.'), {
      statusCode: 503,
      code: 'TENANT_PROVISIONING_FAILED',
    });
  }
}
