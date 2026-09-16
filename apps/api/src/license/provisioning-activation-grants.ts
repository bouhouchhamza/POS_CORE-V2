import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from '../config.js';
import { licenseKeyHash } from './crypto.js';

export const PROVISIONING_ACTIVATION_GRANT_COOKIE = 'corepos_provision_activation_grant';
const GRANT_TTL_SECONDS = 10 * 60;
const GRANT_COOKIE_PATH = '/api/provision/activate-device';

export async function issueProvisioningActivationGrant(input: {
  client: pg.PoolClient;
  provisioningKeyId: string;
  licenseId: string;
  vendorBusinessId: string;
  tenantId: string;
  licenseExpiresAt?: string | Date | null;
}) {
  const plaintext = `pact_${crypto.randomBytes(32).toString('base64url')}`;
  const normalExpiry = Date.now() + GRANT_TTL_SECONDS * 1000;
  const licenseExpiry = input.licenseExpiresAt
    ? new Date(input.licenseExpiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  const expiresAtMs = Math.min(normalExpiry, licenseExpiry);

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw Object.assign(new Error('Provisioning activation grant expiration is invalid.'), {
      statusCode: 422,
      code: 'PROVISIONING_ACTIVATION_GRANT_EXPIRY_INVALID',
    });
  }

  const expiresAt = new Date(expiresAtMs);
  await input.client.query(
    `insert into provisioning_activation_grants(
       provisioning_key_id,license_id,vendor_business_id,tenant_id,grant_hash,expires_at
     ) values($1,$2,$3,$4,$5,$6)`,
    [
      input.provisioningKeyId,
      input.licenseId,
      input.vendorBusinessId,
      input.tenantId,
      licenseKeyHash(plaintext),
      expiresAt.toISOString(),
    ],
  );

  return { plaintext, expiresAt };
}

export function setProvisioningActivationGrantCookie(
  reply: FastifyReply,
  plaintext: string,
  expiresAt: Date,
) {
  const maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.setCookie(PROVISIONING_ACTIVATION_GRANT_COOKIE, plaintext, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
    path: GRANT_COOKIE_PATH,
    maxAge,
  });
}

export function clearProvisioningActivationGrantCookie(reply: FastifyReply) {
  reply.clearCookie(PROVISIONING_ACTIVATION_GRANT_COOKIE, { path: GRANT_COOKIE_PATH });
}

export function readProvisioningActivationGrantCookie(request: FastifyRequest) {
  const value = request.cookies?.[PROVISIONING_ACTIVATION_GRANT_COOKIE];
  return typeof value === 'string' && value.startsWith('pact_') ? value : null;
}

export async function lockProvisioningActivationGrant(
  client: pg.PoolClient,
  plaintext: string,
) {
  return (await client.query(
    `select
       g.id grant_id,
       g.provisioning_key_id,
       g.license_id grant_license_id,
       g.vendor_business_id grant_vendor_business_id,
       g.tenant_id grant_tenant_id,
       g.expires_at grant_expires_at,
       g.consumed_at grant_consumed_at,
       g.consumed_device_id grant_consumed_device_id,
       g.revoked_at grant_revoked_at,
       k.consumed_at provisioning_consumed_at,
       k.consumed_business_id,
       l.*,
       vb.status vendor_business_status,
       t.id resolved_tenant_id,
       t.vendor_business_id tenant_vendor_business_id,
       t.control_business_id tenant_control_business_id,
       t.status tenant_status
     from provisioning_activation_grants g
     join license_provisioning_keys k on k.id=g.provisioning_key_id
     join licenses l on l.id=g.license_id
     join vendor_businesses vb on vb.id=g.vendor_business_id
     join saas_tenants t on t.id=g.tenant_id
     where g.grant_hash=$1
     limit 1
     for update of g,k,l,vb,t`,
    [licenseKeyHash(plaintext)],
  )).rows[0] ?? null;
}

export function validateProvisioningActivationGrant(grant: any) {
  if (!grant) {
    throw Object.assign(new Error('The provisioning activation grant is invalid.'), {
      statusCode: 401,
      code: 'PROVISIONING_ACTIVATION_GRANT_INVALID',
    });
  }
  if (grant.grant_consumed_at) {
    throw Object.assign(new Error('The provisioning activation grant has already been used.'), {
      statusCode: 409,
      code: 'PROVISIONING_ACTIVATION_GRANT_ALREADY_CONSUMED',
    });
  }
  if (grant.grant_revoked_at) {
    throw Object.assign(new Error('The provisioning activation grant has been revoked.'), {
      statusCode: 410,
      code: 'PROVISIONING_ACTIVATION_GRANT_REVOKED',
    });
  }
  if (Date.parse(grant.grant_expires_at) <= Date.now()) {
    throw Object.assign(new Error('The provisioning activation grant has expired.'), {
      statusCode: 410,
      code: 'PROVISIONING_ACTIVATION_GRANT_EXPIRED',
    });
  }
  if (
    String(grant.grant_license_id) !== String(grant.id) ||
    String(grant.grant_vendor_business_id) !== String(grant.vendor_business_id) ||
    String(grant.grant_tenant_id) !== String(grant.resolved_tenant_id) ||
    String(grant.tenant_vendor_business_id) !== String(grant.vendor_business_id) ||
    !grant.provisioning_consumed_at ||
    Number(grant.consumed_business_id) !== Number(grant.tenant_control_business_id)
  ) {
    throw Object.assign(new Error('The provisioning activation grant is not bound to this tenant.'), {
      statusCode: 409,
      code: 'PROVISIONING_ACTIVATION_GRANT_CONTEXT_MISMATCH',
    });
  }
  if (grant.tenant_status !== 'active') {
    throw Object.assign(new Error('The provisioned tenant is not active.'), {
      statusCode: 409,
      code: grant.tenant_status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_INACTIVE',
    });
  }
  if (grant.vendor_business_status !== 'active') {
    throw Object.assign(new Error('Vendor Business is not active.'), {
      statusCode: 403,
      code: 'VENDOR_BUSINESS_INACTIVE',
    });
  }
  if (grant.status !== 'active') {
    throw Object.assign(new Error('License is not active.'), {
      statusCode: 403,
      code: grant.status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INACTIVE',
    });
  }
  if (grant.expires_at && Date.parse(grant.expires_at) <= Date.now()) {
    throw Object.assign(new Error('License has expired.'), {
      statusCode: 403,
      code: 'LICENSE_EXPIRED',
    });
  }
}
