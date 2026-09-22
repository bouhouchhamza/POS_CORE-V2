import assert from 'node:assert/strict';
import test from 'node:test';
import { commercialLifecycle, type CommercialLifecycleRow } from './lifecycle.js';

const readyRow = (): CommercialLifecycleRow => ({
  vendor_business_status: 'active',
  license_id: 'lic-1',
  license_status: 'active',
  license_expires_at: new Date(Date.now() + 60_000).toISOString(),
  max_devices: 2,
  max_desktop_devices: 2,
  max_web_devices: null,
  max_mobile_devices: null,
  tenant_status: 'active',
  runtime_business_id: 1,
  provisioning_error_code: null,
});

test('a customer activation code is eligible only when the Business is fully ready', () => {
  assert.deepEqual(commercialLifecycle(readyRow(), 'database_per_tenant'), {
    state: 'READY_FOR_ACTIVATION',
    reason: null,
  });
  assert.equal(
    commercialLifecycle({ ...readyRow(), runtime_business_id: null }, 'database_per_tenant').state,
    'PROVISIONING',
  );
  assert.equal(
    commercialLifecycle({ ...readyRow(), license_id: null }, 'database_per_tenant').state,
    'PROVISIONING',
  );
});

test('internal preparation failures and commercial blocks remain distinct', () => {
  assert.deepEqual(commercialLifecycle({ ...readyRow(), provisioning_error_code: 'TENANT_PROVISIONING_FAILED' }, 'database_per_tenant'), {
    state: 'PROVISIONING_FAILED',
    reason: 'TENANT_PROVISIONING_FAILED',
  });
  assert.deepEqual(commercialLifecycle({ ...readyRow(), license_status: 'suspended' }, 'database_per_tenant'), {
    state: 'BLOCKED',
    reason: 'LICENSE_DISABLED',
  });
  assert.deepEqual(commercialLifecycle({ ...readyRow(), max_devices: 0 }, 'database_per_tenant'), {
    state: 'BLOCKED',
    reason: 'LICENSE_DEVICE_QUOTA_INVALID',
  });
  assert.deepEqual(commercialLifecycle({ ...readyRow(), vendor_business_status: 'suspended' }, 'database_per_tenant'), {
    state: 'BLOCKED',
    reason: 'VENDOR_BUSINESS_INACTIVE',
  });
  assert.deepEqual(commercialLifecycle({ ...readyRow(), license_expires_at: new Date(Date.now() - 60_000).toISOString() }, 'database_per_tenant'), {
    state: 'BLOCKED',
    reason: 'LICENSE_EXPIRED',
  });
});

test('a legacy business without a provisioning recipe remains activation-ready when its commercial runtime is valid', () => {
  const legacy = readyRow();
  delete legacy.provisioning_error_code;
  assert.deepEqual(commercialLifecycle(legacy, 'database_per_tenant'), {
    state: 'READY_FOR_ACTIVATION',
    reason: null,
  });
});
