import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from '../config.js';
import { fingerprint } from './crypto.js';
import { assertDeviceSlotAvailable, type DeviceChannel } from './device-quota.js';
import { resolveRuntimeBusinessIdentity } from './control-plane.js';

export type SessionChannel = Extract<DeviceChannel, 'web' | 'mobile'>;
export type SessionMerchant = {
  id: number;
  businessId: number;
  role: string;
};

export type SessionDevice = {
  id: string;
  installationId: string;
  channel: SessionChannel;
  licenseId: string;
};

const DEVICE_COOKIE = 'bimik_session_device';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 86400;

type DeviceCookiePayload = {
  v: 1;
  installationId: string;
  channel: SessionChannel;
  expiresAt: number;
};

function cookieSignature(payload: string) {
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`bimik-session-device-v1:${payload}`)
    .digest('base64url');
}

function encodeDeviceCookie(installationId: string, channel: SessionChannel) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    installationId,
    channel,
    expiresAt: Date.now() + DEVICE_COOKIE_MAX_AGE_SECONDS * 1000,
  } satisfies DeviceCookiePayload)).toString('base64url');
  return `${payload}.${cookieSignature(payload)}`;
}

export function readSessionDeviceCookie(request: FastifyRequest): DeviceCookiePayload | null {
  const raw = request.cookies?.[DEVICE_COOKIE];
  if (!raw) return null;

  try {
    const [payload, suppliedSignature, ...rest] = raw.split('.');
    if (!payload || !suppliedSignature || rest.length) return null;

    const expectedSignature = cookieSignature(payload);
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<DeviceCookiePayload>;
    if (
      decoded.v !== 1 ||
      (decoded.channel !== 'web' && decoded.channel !== 'mobile') ||
      typeof decoded.installationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.installationId) ||
      !Number.isFinite(decoded.expiresAt) ||
      Number(decoded.expiresAt) <= Date.now()
    ) {
      return null;
    }

    return decoded as DeviceCookiePayload;
  } catch {
    return null;
  }
}

function setSessionDeviceCookie(
  reply: FastifyReply,
  installationId: string,
  channel: SessionChannel,
) {
  reply.setCookie(DEVICE_COOKIE, encodeDeviceCookie(installationId, channel), {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}

function validateCommercialLicense(license: any) {
  if (!license) {
    throw Object.assign(new Error('License activation is required.'), {
      statusCode: 403,
      code: 'LICENSE_INACTIVE',
    });
  }
  if (license.vendor_business_status !== 'active') {
    throw Object.assign(new Error('Vendor Business is not active.'), {
      statusCode: 403,
      code: 'VENDOR_BUSINESS_INACTIVE',
    });
  }
  if (license.status !== 'active') {
    throw Object.assign(new Error('License is not active.'), {
      statusCode: 403,
      code: license.status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_INACTIVE',
    });
  }
  if (license.expires_at && Date.parse(license.expires_at) <= Date.now()) {
    throw Object.assign(new Error('License has expired.'), {
      statusCode: 403,
      code: 'LICENSE_EXPIRED',
    });
  }
}

async function latestLicenseForUpdate(client: pg.PoolClient, vendorBusinessId: string) {
  const license = (await client.query(
    `select l.*,vb.status vendor_business_status
     from licenses l
     join vendor_businesses vb on vb.id=l.vendor_business_id
     where l.vendor_business_id=$1
     order by l.issued_at desc,l.created_at desc
     limit 1
     for update of l,vb`,
    [vendorBusinessId],
  )).rows[0];
  validateCommercialLicense(license);
  return license;
}

async function vendorIdentity(operationalPool: pg.Pool, merchant: SessionMerchant) {
  if (process.env.LICENSE_MODE === 'development' && process.env.NODE_ENV !== 'production') {
    return null;
  }

  const identity = await resolveRuntimeBusinessIdentity(operationalPool, merchant.businessId);
  if (!identity) {
    throw Object.assign(new Error('This workspace is not linked to the Vendor control plane.'), {
      statusCode: 409,
      code: 'BUSINESS_VENDOR_IDENTITY_REQUIRED',
    });
  }
  return identity;
}

export async function registerSessionDevice(input: {
  controlPool: pg.Pool;
  operationalPool: pg.Pool;
  merchant: SessionMerchant;
  reply: FastifyReply;
  installationId: string;
  channel: SessionChannel;
  devicePublicKey: string;
  deviceName: string;
  appVersion: string;
  platform: string | null;
  bindCookie?: boolean;
}) : Promise<SessionDevice | null> {
  const identity = await vendorIdentity(input.operationalPool, input.merchant);
  if (!identity) return null;

  const client = await input.controlPool.connect();
  try {
    await client.query('begin');
    const license = await latestLicenseForUpdate(client, identity.vendorBusinessId);
    const requestedFingerprint = fingerprint(input.devicePublicKey);

    let device = (await client.query(
      `select * from license_devices
       where license_id=$1 and installation_id=$2
       for update`,
      [license.id, input.installationId],
    )).rows[0];

    if (device && device.status !== 'active') {
      throw Object.assign(new Error('This device has been revoked.'), {
        statusCode: 403,
        code: 'DEVICE_REVOKED',
      });
    }
    if (device && device.channel !== input.channel) {
      throw Object.assign(new Error('Device channel mismatch.'), {
        statusCode: 409,
        code: 'DEVICE_CHANNEL_MISMATCH',
      });
    }
    if (device && device.device_fingerprint !== requestedFingerprint) {
      throw Object.assign(new Error('Device identity mismatch.'), {
        statusCode: 403,
        code: 'DEVICE_IDENTITY_MISMATCH',
      });
    }

    if (!device) {
      await assertDeviceSlotAvailable(client, license, input.channel);
      device = (await client.query(
        `insert into license_devices(
           license_id,installation_id,device_public_key,device_fingerprint,
           device_name,app_version,channel,platform,last_validated_at,last_seen_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
         returning *`,
        [
          license.id,
          input.installationId,
          input.devicePublicKey,
          requestedFingerprint,
          input.deviceName,
          input.appVersion,
          input.channel,
          input.platform,
        ],
      )).rows[0];

      await client.query(
        `insert into license_audit_logs(actor,action,entity_type,entity_id,description)
         values('merchant',$1,'device',$2,$3)`,
        [
          `${input.channel}_device.register`,
          device.id,
          `${input.channel} device registered for Vendor Business ${identity.vendorBusinessId}`,
        ],
      );
    } else {
      device = (await client.query(
        `update license_devices
         set device_name=$1,app_version=$2,platform=$3,
             last_validated_at=now(),last_seen_at=now()
         where id=$4 returning *`,
        [input.deviceName, input.appVersion, input.platform, device.id],
      )).rows[0];
    }

    await client.query('commit');

    if (input.bindCookie !== false) {
      setSessionDeviceCookie(input.reply, input.installationId, input.channel);
    }

    return {
      id: String(device.id),
      installationId: String(device.installation_id),
      channel: input.channel,
      licenseId: String(license.id),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function sessionChannelForRequest(request: FastifyRequest): SessionChannel {
  const existing = readSessionDeviceCookie(request)
  if (existing) return existing.channel

  const hinted = String(request.headers['x-bimik-device-channel'] ?? '').trim().toLowerCase()
  if (hinted === 'mobile') return 'mobile'
  if (hinted === 'web') return 'web'

  const userAgent = String(request.headers['user-agent'] ?? '').toLowerCase()
  return /android|iphone|ipad|ipod|mobile/.test(userAgent) ? 'mobile' : 'web'
}

export async function ensureWebSessionDevice(input: {
  controlPool: pg.Pool;
  operationalPool: pg.Pool;
  merchant: SessionMerchant;
  request: FastifyRequest;
  reply: FastifyReply;
}) {
  const existing = readSessionDeviceCookie(input.request);
  const channel = sessionChannelForRequest(input.request);
  const installationId = existing?.installationId ?? crypto.randomUUID();
  const userAgent = String(input.request.headers['user-agent'] ?? 'Web browser').slice(0, 200);
  const publicIdentity = `${channel}-cookie-v1:${installationId}`;

  return registerSessionDevice({
    controlPool: input.controlPool,
    operationalPool: input.operationalPool,
    merchant: input.merchant,
    reply: input.reply,
    installationId,
    channel,
    devicePublicKey: publicIdentity,
    deviceName: userAgent || (channel === 'mobile' ? 'Mobile web / PWA' : 'Web browser'),
    appVersion: String(input.request.headers['x-bimik-app-version'] ?? (channel === 'mobile' ? 'pwa' : 'web')).slice(0, 100),
    platform: channel === 'mobile' ? 'mobile-web' : 'web',
  });
}

export async function touchSessionDevice(input: {
  controlPool: pg.Pool;
  operationalPool: pg.Pool;
  merchant: SessionMerchant;
  request: FastifyRequest;
}) : Promise<SessionDevice | null> {
  const identity = await vendorIdentity(input.operationalPool, input.merchant);
  if (!identity) return null;

  const cookie = readSessionDeviceCookie(input.request);
  if (!cookie) {
    throw Object.assign(new Error('This session is not bound to a registered device.'), {
      statusCode: 401,
      code: 'SESSION_DEVICE_REQUIRED',
    });
  }

  const client = await input.controlPool.connect();
  try {
    await client.query('begin');
    const license = await latestLicenseForUpdate(client, identity.vendorBusinessId);
    const device = (await client.query(
      `select * from license_devices
       where license_id=$1 and installation_id=$2
       for update`,
      [license.id, cookie.installationId],
    )).rows[0];

    if (!device || device.status !== 'active') {
      throw Object.assign(new Error('This session device is revoked or unknown.'), {
        statusCode: 403,
        code: 'DEVICE_REVOKED',
      });
    }
    if (device.channel !== cookie.channel) {
      throw Object.assign(new Error('Session device channel mismatch.'), {
        statusCode: 409,
        code: 'DEVICE_CHANNEL_MISMATCH',
      });
    }

    await client.query(
      'update license_devices set last_validated_at=now(),last_seen_at=now() where id=$1',
      [device.id],
    );
    await client.query('commit');

    return {
      id: String(device.id),
      installationId: String(device.installation_id),
      channel: cookie.channel,
      licenseId: String(license.id),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function mobileLoginProofPayload(input: {
  email: string;
  installation_id: string;
  device_public_key: string;
  device_name: string;
  app_version: string;
  nonce: string;
  requested_at: string;
}) {
  return [
    'mobile-login-v1',
    input.email.trim().toLowerCase(),
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.nonce,
    input.requested_at,
  ].join('\n');
}

export function verifySessionDeviceProof(publicKey: string, payload: string, signature: string) {
  try {
    const key = crypto.createPublicKey({ key: JSON.parse(publicKey), format: 'jwk' });
    return crypto.verify(
      null,
      Buffer.from(payload, 'utf8'),
      key,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}
