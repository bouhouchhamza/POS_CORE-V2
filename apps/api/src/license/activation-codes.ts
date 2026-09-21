import crypto from 'node:crypto';
import type pg from 'pg';
import { licenseKeyHash } from './crypto.js';
import type { DeviceChannel } from './device-quota.js';

export const DEFAULT_ACTIVATION_CODE_TTL_HOURS = 24;
export const HUMAN_ACTIVATION_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const HUMAN_ACTIVATION_CODE_LENGTH = 16;
const ACTIVATION_CODE_INSERT_ATTEMPTS = 5;

/**
 * Generate a customer-facing credential with about 79 bits of entropy
 * (31^16 possibilities). Rejection sampling avoids modulo bias.
 */
export function generateHumanActivationCode() {
  const limit = Math.floor(256 / HUMAN_ACTIVATION_CODE_ALPHABET.length) * HUMAN_ACTIVATION_CODE_ALPHABET.length;
  let payload = '';

  while (payload.length < HUMAN_ACTIVATION_CODE_LENGTH) {
    for (const byte of crypto.randomBytes(HUMAN_ACTIVATION_CODE_LENGTH)) {
      if (byte >= limit) continue;
      payload += HUMAN_ACTIVATION_CODE_ALPHABET[byte % HUMAN_ACTIVATION_CODE_ALPHABET.length];
      if (payload.length === HUMAN_ACTIVATION_CODE_LENGTH) break;
    }
  }

  return `CP-${payload.match(/.{1,4}/g)!.join('-')}`;
}

/**
 * Human codes are case-insensitive and may be entered with or without spaces
 * and hyphens. Legacy opaque act_ credentials are deliberately only trimmed,
 * so already-issued hashes remain valid byte-for-byte.
 */
export function normalizeActivationCode(value: string) {
  const trimmed = value.trim();
  const compact = trimmed.replace(/[\s-]/g, '').toUpperCase();
  const humanPattern = new RegExp(
    `^CP[${HUMAN_ACTIVATION_CODE_ALPHABET}]{${HUMAN_ACTIVATION_CODE_LENGTH}}$`,
  );

  if (!humanPattern.test(compact)) return trimmed;
  const payload = compact.slice(2);
  return `CP-${payload.match(/.{1,4}/g)!.join('-')}`;
}

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
  const expiresAt = activationCodeExpiry(input.licenseExpiresAt, input.ttlHours);

  // The unique hash index is the final uniqueness authority. A collision is
  // extraordinarily unlikely, but retrying makes issuance deterministic even
  // in that case without ever persisting a readable credential.
  for (let attempt = 0; attempt < ACTIVATION_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const plaintext = generateHumanActivationCode();
    const row = (await input.client.query(
      `insert into license_activation_codes(
         license_id,key_hash,key_hint,channel,expires_at,notes
       ) values($1,$2,$3,$4,$5,$6)
       on conflict (key_hash) do nothing
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
    if (row) return { row, plaintext };
  }

  throw Object.assign(new Error('Unable to issue a unique activation code.'), {
    statusCode: 503,
    code: 'ACTIVATION_CODE_ISSUANCE_FAILED',
  });
}

export async function lockActivationCode(client: pg.PoolClient, plaintext: string, channel: DeviceChannel) {
  const normalized = normalizeActivationCode(plaintext);
  return (await client.query(
    `select
       c.id activation_code_id,
       c.channel activation_code_channel,
       c.expires_at activation_code_expires_at,
       c.consumed_at activation_code_consumed_at,
       c.consumed_device_id,
       consumed_device.installation_id activation_code_consumed_installation_id,
       c.revoked_at activation_code_revoked_at,
       l.*,
       p.code plan_code,
       vb.status vendor_business_status
     from license_activation_codes c
     join licenses l on l.id=c.license_id
     join vendor_businesses vb on vb.id=l.vendor_business_id
     left join license_devices consumed_device on consumed_device.id=c.consumed_device_id
     left join license_plans p on p.id=l.plan_id
     where c.key_hash=$1 and c.channel=$2
     for update of c,l,vb`,
    [licenseKeyHash(normalized), channel],
  )).rows[0] ?? null;
}

export function validateActivationCode(code: any, installationId?: string) {
  if (!code) {
    throw Object.assign(new Error('Activation code is invalid.'), {
      statusCode: 422,
      code: 'ACTIVATION_CODE_INVALID',
    });
  }
  if (code.activation_code_consumed_at) {
    if (installationId && code.activation_code_consumed_installation_id === installationId) {
      throw Object.assign(new Error('This device is already activated.'), {
        statusCode: 409,
        code: 'DEVICE_ALREADY_ACTIVATED',
      });
    }
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
      code:
        code.status === 'revoked'
          ? 'LICENSE_REVOKED'
          : code.status === 'expired'
            ? 'LICENSE_EXPIRED'
            : 'LICENSE_DISABLED',
    });
  }
  if (code.expires_at && Date.parse(code.expires_at) <= Date.now()) {
    throw Object.assign(new Error('License has expired.'), {
      statusCode: 403,
      code: 'LICENSE_EXPIRED',
    });
  }
}
