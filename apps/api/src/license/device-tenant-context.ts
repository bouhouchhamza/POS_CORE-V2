import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from '../config.js';
import type { TenantRecord } from '../saas/tenant-context.js';

export const ACTIVATED_DEVICE_COOKIE = 'corepos_activated_device';
const COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;

type DeviceCookie = { deviceId: string; expiresAt: number };

function signature(payload: string) {
  return crypto.createHmac('sha256', config.JWT_SECRET).update(payload).digest('base64url');
}

function encodeCookie(value: DeviceCookie) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function decodeCookie(raw: string | undefined): DeviceCookie | null {
  if (!raw) return null;
  const [payload, supplied, extra] = raw.split('.');
  if (!payload || !supplied || extra) return null;
  const expected = signature(payload);
  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) return null;

  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeviceCookie;
    if (
      typeof value.deviceId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(value.deviceId) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now()
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export function setActivatedDeviceCookie(reply: FastifyReply, deviceId: string) {
  reply.setCookie(
    ACTIVATED_DEVICE_COOKIE,
    encodeCookie({ deviceId, expiresAt: Date.now() + COOKIE_TTL_SECONDS * 1000 }),
    {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: config.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: COOKIE_TTL_SECONDS,
    },
  );
}

export function clearActivatedDeviceCookie(reply: FastifyReply) {
  reply.clearCookie(ACTIVATED_DEVICE_COOKIE, { path: '/' });
}

function rowToTenant(row: any): TenantRecord {
  return {
    id: String(row.id),
    vendorBusinessId: String(row.vendor_business_id),
    controlBusinessId: row.control_business_id == null ? null : Number(row.control_business_id),
    slug: String(row.slug),
    databaseName: String(row.database_name),
    status: String(row.status) as TenantRecord['status'],
  };
}

/**
 * Resolves the tenant only from a server-signed cookie previously issued
 * after a cryptographically verified device activation/validation. The
 * cookie contains no tenant identifier or database configuration.
 */
export async function resolveActivatedDeviceTenant(
  controlPool: pg.Pool,
  request: FastifyRequest,
  reply?: FastifyReply,
) {
  const value = decodeCookie(request.cookies?.[ACTIVATED_DEVICE_COOKIE]);
  if (!value) return null;

  const row = (await controlPool.query(
    `select t.id,t.vendor_business_id,t.control_business_id,t.slug,t.database_name,t.status
       from license_devices d
       join licenses l on l.id=d.license_id
       join vendor_businesses vb on vb.id=l.vendor_business_id
       join saas_tenants t on t.vendor_business_id=vb.id
      where d.id=$1
        and d.status='active'
        and l.status='active'
        and (l.expires_at is null or l.expires_at>now())
        and vb.status='active'
        and t.status='active'
      limit 1`,
    [value.deviceId],
  )).rows[0];

  if (!row) {
    if (reply) clearActivatedDeviceCookie(reply);
    return null;
  }

  return rowToTenant(row);
}
