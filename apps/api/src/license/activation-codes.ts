import crypto from 'node:crypto';
import type pg from 'pg';
import { licenseKeyHash } from './crypto.js';
import type { DeviceChannel } from './device-quota.js';

export const DEFAULT_ACTIVATION_CODE_TTL_HOURS = 24;

export function activationCodeExpiry(licenseExpiresAt?: string | Date | null, ttlHours = DEFAULT_ACTIVATION_CODE_TTL_HOURS) {
  const now = Date.now();
  const requested = now + Math.max(1, Math.min(168, Math.trunc(ttlHours))) * 60 * 60 * 1000;
  const licenseExpiry = licenseExpiresAt ? new Date(licenseExpiresAt).getTime() : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(requested, licenseExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw Object.assign(new Error('Activation code expiration is invalid.'), {
      statusCode: 422,
      code: 'ACTIVATION_CODE_EXPIRY_INVALID',
    });
  }
  return new Date(expiresAt);
}

export async function issueActivationCode(input: {
  client: pg.PoolClient;
  licenseId: string;
  channel: DeviceChannel;
  licenseExpiresAt?: string | Date | null;
  ttlHours?: number;
  notes?: string | null;
}) {
  const plaintext = `act_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = activationCodeExpiry(input.licenseExpiresAt, input.ttlHours);
  const row = (await input.client.query(
    `insert into license_activation_codes(
       license_id,key_hash,key_hint,channel,expires_at,notes
     ) values($1,$2,$3,$4,$5,$6)
     returning id,license_id,key_hint,channel,expires_at,consumed_at,consumed_device_id,revoked_at,notes,created_at,updated_at`,
    [
      input.licenseId,
      licenseKeyHash(plaintext),
      plaintext.slice(-8),
      input.channel,
      expiresAt.toISOString(),
      input.notes ?? null,
    ],
  )).rows[0];
  return { row, plaintext };
}

export async function lockActivationCode(client: pg.PoolClient, plaintext: string, channel: DeviceChannel) {
  return (await client.query(
    `select
       c.id activation_code_id,
       c.channel activation_code_channel,
       c.expires_at activation_code_expires_at,
       c.consumed_at activation_code_consumed_at,
       c.consumed_device_id,
       c.revoked_at activation_code_revoked_at,
       l.*,
       p.code plan_code,
       vb.status vendor_business_status
     from license_activation_codes c
     join licenses l on l.id=c.license_id
     join vendor_businesses vb on vb.id=l.vendor_business_id
     left join license_plans p on p.id=l.plan_id
     where c.key_hash=$1 and c.channel=$2
     for update of c,l,vb`,
    [licenseKeyHash(plaintext), channel],
  )).rows[0] ?? null;
}

export function validateActivationCode(code: any) {
  if (!code) {
    throw Object.assign(new Error('Activation code is invalid.'), {
      statusCode: 422,
      code: 'ACTIVATION_CODE_INVALID',
    });
  }
  if (code.activation_code_consumed_at) {
    throw Object.assign(new Error('This activation code has already been used.'), {
      statusCode: 409,
      code: 'ACTIVATION_CODE_ALREADY_CONSUMED',
    });
  }
  if (code.activation_code_revoked_at) {
    throw Object.assign(new Error('This activation code has been revoked.'), {
      statusCode: 410,
      code: 'ACTIVATION_CODE_REVOKED',
    });
  }
  if (Date.parse(code.activation_code_expires_at) <= Date.now()) {
    throw Object.assign(new Error('This activation code has expired.'), {
      statusCode: 410,
      code: 'ACTIVATION_CODE_EXPIRED',
    });
  }
  if (code.vendor_business_status !== 'active') {
    throw Object.assign(new Error('Vendor Business is not active.'), {
      statusCode: 403,
      code: 'VENDOR_BUSINESS_INACTIVE',
    });
  }
  if (code.status !== 'active') {
    throw Object.assign(new Error('License is not active.'), {
      statusCode: 403,
      code: code.status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INACTIVE',
    });
  }
  if (code.expires_at && Date.parse(code.expires_at) <= Date.now()) {
    throw Object.assign(new Error('License has expired.'), {
      statusCode: 403,
      code: 'LICENSE_EXPIRED',
    });
  }
}
