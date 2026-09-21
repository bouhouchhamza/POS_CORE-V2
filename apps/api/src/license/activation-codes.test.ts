import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateHumanActivationCode,
  HUMAN_ACTIVATION_CODE_ALPHABET,
  issueActivationCode,
  normalizeActivationCode,
  validateActivationCode,
} from './activation-codes.js';
import { licenseKeyHash } from './crypto.js';
import { assertDeviceSlotAvailable } from './device-quota.js';

const errorCode = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error: unknown) => (error as { code?: string }).code === code);
};

test('customer activation codes use the unambiguous CP format and at least 60 bits of entropy', () => {
  const code = generateHumanActivationCode();
  assert.match(code, /^CP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){3}$/);
  assert.equal(HUMAN_ACTIVATION_CODE_ALPHABET.length, 31);
  assert.ok(16 * Math.log2(HUMAN_ACTIVATION_CODE_ALPHABET.length) >= 60);
});

test('only a complete human code is case-folded and separator-normalized', () => {
  assert.equal(normalizeActivationCode(' cp-abcd efgh- jkmn pqrs '), 'CP-ABCD-EFGH-JKMN-PQRS');
  assert.equal(normalizeActivationCode('CP-ABCD-EFGH-JKMN-PQRS'), 'CP-ABCD-EFGH-JKMN-PQRS');
  assert.equal(normalizeActivationCode('CP-ABCD-EFGH-JKMN-PQRI'), 'CP-ABCD-EFGH-JKMN-PQRI');
});

test('legacy act_ credentials remain byte-compatible except for historical trimming', () => {
  const legacy = 'act_Mv8GfE2k3wPH_legacy-token';
  assert.equal(normalizeActivationCode(`  ${legacy}  `), legacy);
  assert.equal(licenseKeyHash(normalizeActivationCode(`  ${legacy}  `)), licenseKeyHash(legacy));
});

test('issued activation codes persist only their hash and use the database uniqueness guard', async () => {
  let parameters: unknown[] | undefined;
  const client = {
    query: async (_sql: string, values: unknown[]) => {
      parameters = values;
      return { rows: [{ id: 'code-id' }] };
    },
  };
  const issued = await issueActivationCode({
    client: client as never,
    licenseId: 'license-id',
    channel: 'desktop',
  });

  assert.equal(parameters?.[1], licenseKeyHash(issued.plaintext));
  assert.notEqual(parameters?.[1], issued.plaintext);
});

test('invalid, expired, disabled, consumed, and same-device activation states have stable codes', () => {
  errorCode(() => validateActivationCode(null), 'ACTIVATION_CODE_INVALID');
  errorCode(() => validateActivationCode({ activation_code_expires_at: new Date(Date.now() - 1).toISOString() }), 'ACTIVATION_CODE_EXPIRED');
  errorCode(() => validateActivationCode({ activation_code_revoked_at: new Date().toISOString() }), 'ACTIVATION_CODE_REVOKED');
  errorCode(() => validateActivationCode({ activation_code_expires_at: new Date(Date.now() + 60_000).toISOString(), vendor_business_status: 'active', status: 'suspended' }), 'LICENSE_DISABLED');
  errorCode(() => validateActivationCode({ activation_code_expires_at: new Date(Date.now() + 60_000).toISOString(), vendor_business_status: 'active', status: 'active', expires_at: new Date(Date.now() - 1).toISOString() }), 'LICENSE_EXPIRED');
  errorCode(() => validateActivationCode({ activation_code_consumed_at: new Date().toISOString(), activation_code_consumed_installation_id: 'device-a' }, 'device-a'), 'DEVICE_ALREADY_ACTIVATED');
  errorCode(() => validateActivationCode({ activation_code_consumed_at: new Date().toISOString(), activation_code_consumed_installation_id: 'device-a' }, 'device-b'), 'ACTIVATION_CODE_ALREADY_CONSUMED');
});

test('device quotas use the unified limit code for total and channel limits', async () => {
  const client = {
    query: async () => ({ rows: [{ total: 1, channel_total: 1 }] }),
  };
  await assert.rejects(
    () => assertDeviceSlotAvailable(client as never, { id: 'license', max_devices: 1, max_desktop_devices: 2 }, 'desktop'),
    (error: unknown) => (error as { code?: string; limit_scope?: string }).code === 'DEVICE_LIMIT_REACHED' && (error as { limit_scope?: string }).limit_scope === 'total',
  );
  await assert.rejects(
    () => assertDeviceSlotAvailable(client as never, { id: 'license', max_devices: 2, max_desktop_devices: 1 }, 'desktop'),
    (error: unknown) => (error as { code?: string; limit_scope?: string }).code === 'DEVICE_LIMIT_REACHED' && (error as { limit_scope?: string }).limit_scope === 'channel',
  );
});
