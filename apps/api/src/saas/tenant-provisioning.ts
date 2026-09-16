import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const tenantMigrationsRoot = [
  path.resolve(moduleDir, '../../tenant-drizzle'),
  path.resolve(moduleDir, '../../../tenant-drizzle'),
].find((candidate) => existsSync(candidate)) ?? path.resolve(moduleDir, '../../tenant-drizzle');

export type TenantProvisioningSetup = {
  business: {
    name: string;
    business_type: string;
    logo?: string | null;
    currency: string;
    locale: string;
    timezone: string;
    address?: string | null;
    phone?: string | null;
  };
  enabled_features: string[];
  admin: {
    name: string;
    email: string;
  };
};

function safeSlugBase(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'business';
}

function uuidSuffix(value: string) {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (normalized.length < 8) {
    throw Object.assign(new Error('Vendor Business identifier is invalid.'), {
      statusCode: 500,
      code: 'TENANT_VENDOR_BUSINESS_ID_INVALID',
    });
  }
  return normalized.slice(0, 8);
}

export function tenantIdentifiers(businessName: string, vendorBusinessId: string) {
  const suffix = uuidSuffix(vendorBusinessId);
  const base = safeSlugBase(businessName);
  const slug = `${base}-${suffix}`.slice(0, 80).replace(/-+$/g, '');
  const databaseName = `corepos_${base.replace(/-/g, '_').slice(0, 40)}_${suffix}`.slice(0, 63);

  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) {
    throw Object.assign(new Error('Unable to derive a safe tenant database name.'), {
      statusCode: 500,
      code: 'TENANT_DATABASE_NAME_INVALID',
    });
  }

  return { slug, databaseName };
}

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error('Unsafe PostgreSQL identifier.');
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function tenantDatabaseUrl(databaseName: string) {
  const template = config.SAAS_TENANT_DATABASE_URL_TEMPLATE;
  if (!template?.includes('{database}')) {
    throw Object.assign(new Error('Tenant database URL template is not configured.'), {
      statusCode: 503,
      code: 'TENANT_DATABASE_TEMPLATE_MISSING',
    });
  }
  return template.replace('{database}', encodeURIComponent(databaseName));
}

export async function ensureTenantDatabase(databaseName: string) {
  if (!config.SAAS_DATABASE_ADMIN_URL) {
    throw Object.assign(new Error('Tenant database administrator connection is not configured.'), {
      statusCode: 503,
      code: 'TENANT_DATABASE_ADMIN_MISSING',
    });
  }

  const admin = new pg.Client({
    connectionString: config.SAAS_DATABASE_ADMIN_URL,
    application_name: 'bimik-tenant-provisioner',
    connectionTimeoutMillis: 5_000,
  });

  await admin.connect();
  try {
    const exists = (await admin.query('select 1 from pg_database where datname=$1', [databaseName])).rowCount;
    if (exists) return;

    const owner = config.SAAS_TENANT_DB_OWNER
      ? ` OWNER ${quoteIdentifier(config.SAAS_TENANT_DB_OWNER)}`
      : '';

    await admin.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)}${owner} TEMPLATE template0 ENCODING 'UTF8'`,
    );
  } finally {
    await admin.end();
  }
}

export async function tenantMigrationFiles() {
  const entries = await fs.readdir(tenantMigrationsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function migrateTenantDatabase(pool: pg.Pool) {
  await pool.query(`
    create table if not exists bimik_tenant_migrations(
      filename text primary key,
      sha256 varchar(64) not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = await tenantMigrationFiles();
  for (const filename of files) {
    const sql = await fs.readFile(path.join(tenantMigrationsRoot, filename), 'utf8');
    const sha256 = crypto.createHash('sha256').update(sql).digest('hex');
    const existing = (await pool.query(
      'select sha256 from bimik_tenant_migrations where filename=$1',
      [filename],
    )).rows[0];

    if (existing) {
      if (existing.sha256 !== sha256) {
        throw Object.assign(new Error(`Tenant migration drift detected for ${filename}.`), {
          statusCode: 500,
          code: 'TENANT_MIGRATION_DRIFT',
        });
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      // Drizzle's marker is a SQL comment, so PostgreSQL safely ignores it.
      await client.query(sql);
      await client.query(
        'insert into bimik_tenant_migrations(filename,sha256) values($1,$2)',
        [filename, sha256],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  return files.at(-1)?.replace(/\.sql$/, '') ?? null;
}

export async function ensureTenantDatabaseReady(databaseName: string) {
  await ensureTenantDatabase(databaseName);
  const pool = new pg.Pool({
    connectionString: tenantDatabaseUrl(databaseName),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'bimik-tenant-migrator',
  });
  try {
    const schemaVersion = await migrateTenantDatabase(pool);
    return { pool, schemaVersion };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function provisionTenantDatabase(input: {
  vendorBusinessId: string;
  setup: TenantProvisioningSetup;
  passwordHash: string;
}) {
  const identifiers = tenantIdentifiers(input.setup.business.name, input.vendorBusinessId);
  await ensureTenantDatabase(identifiers.databaseName);

  const pool = new pg.Pool({
    connectionString: tenantDatabaseUrl(identifiers.databaseName),
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: `bimik-provision-${identifiers.slug}`,
  });

  try {
    const schemaVersion = await migrateTenantDatabase(pool);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('lock table businesses in exclusive mode');

      const existing = (await client.query(
        'select * from businesses where vendor_business_id=$1 limit 1',
        [input.vendorBusinessId],
      )).rows[0];

      if (existing) {
        let branch = (await client.query(
          'select * from branches where business_id=$1 order by id limit 1',
          [existing.id],
        )).rows[0] ?? null;

        if (!branch) {
          branch = (await client.query(
            `insert into branches(business_id,name,code,address,phone)
             values($1,'Principal','MAIN',$2,$3)
             returning *`,
            [existing.id, input.setup.business.address ?? null, input.setup.business.phone ?? null],
          )).rows[0];
        }

        const normalizedEmail = input.setup.admin.email.toLowerCase();
        let patron = (await client.query(
          "select id,name,email,role,is_active from users where business_id=$1 and role in ('patron','owner') order by id limit 1",
          [existing.id],
        )).rows[0] ?? null;

        if (patron && String(patron.email).toLowerCase() !== normalizedEmail) {
          throw Object.assign(new Error('Tenant owner does not match the provisioning request.'), {
            statusCode: 409,
            code: 'TENANT_OWNER_MISMATCH',
          });
        }

        if (!patron) {
          const existingUser = (await client.query(
            'select * from users where business_id=$1 and lower(email)=$2 limit 1 for update',
            [existing.id, normalizedEmail],
          )).rows[0] ?? null;

          patron = existingUser
            ? (await client.query(
                `update users
                 set branch_id=$1,name=$2,password=$3,
                     role='patron',is_active=true,updated_at=now()
                 where id=$4
                 returning id,name,email,role,is_active`,
                [branch.id, input.setup.admin.name, input.passwordHash, existingUser.id],
              )).rows[0]
            : (await client.query(
                `insert into users(business_id,branch_id,name,email,password,role,is_active)
                 values($1,$2,$3,$4,$5,'patron',true)
                 returning id,name,email,role,is_active`,
                [
                  existing.id,
                  branch.id,
                  input.setup.admin.name,
                  normalizedEmail,
                  input.passwordHash,
                ],
              )).rows[0];
        }

        if (!patron) {
          throw Object.assign(new Error('Tenant owner bootstrap failed.'), {
            statusCode: 500,
            code: 'TENANT_OWNER_BOOTSTRAP_FAILED',
          });
        }

        await client.query('commit');
        return { ...identifiers, schemaVersion, business: existing, branch, patron, replayed: true };
      }

      if ((await client.query('select 1 from businesses limit 1')).rowCount) {
        throw Object.assign(new Error('Tenant database already contains another business.'), {
          statusCode: 409,
          code: 'TENANT_DATABASE_OCCUPIED',
        });
      }

      const business = (await client.query(
        `insert into businesses(
           name,slug,business_type,logo,currency,locale,timezone,vendor_business_id
         ) values($1,$2,$3,$4,$5,$6,$7,$8)
         returning *`,
        [
          input.setup.business.name,
          identifiers.slug,
          input.setup.business.business_type,
          input.setup.business.logo ?? null,
          input.setup.business.currency.toUpperCase(),
          input.setup.business.locale,
          input.setup.business.timezone,
          input.vendorBusinessId,
        ],
      )).rows[0];

      const branch = (await client.query(
        `insert into branches(business_id,name,code,address,phone)
         values($1,'Principal','MAIN',$2,$3)
         returning *`,
        [business.id, input.setup.business.address ?? null, input.setup.business.phone ?? null],
      )).rows[0];

      for (const feature of [...new Set(input.setup.enabled_features)]) {
        await client.query(
          'insert into business_features(business_id,feature) values($1,$2)',
          [business.id, feature],
        );
      }

      const patron = (await client.query(
        `insert into users(business_id,branch_id,name,email,password,role,is_active)
         values($1,$2,$3,$4,$5,'patron',true)
         returning id,name,email,role,is_active`,
        [
          business.id,
          branch.id,
          input.setup.admin.name,
          input.setup.admin.email.toLowerCase(),
          input.passwordHash,
        ],
      )).rows[0];

      if (!patron) {
        throw Object.assign(new Error('Tenant owner bootstrap failed.'), {
          statusCode: 500,
          code: 'TENANT_OWNER_BOOTSTRAP_FAILED',
        });
      }

      await client.query('commit');
      return { ...identifiers, schemaVersion, business, branch, patron, replayed: false };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
