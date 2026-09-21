export const lifecycleStates = [
  'PROVISIONING',
  'PROVISIONING_FAILED',
  'READY_FOR_ACTIVATION',
  'DEVICE_ACTIVATED',
  'READY',
  'BLOCKED',
  // Development-only local setup remains supported without becoming part of
  // the commercial customer journey.
  'SETUP_REQUIRED',
] as const;

export type LifecycleState = (typeof lifecycleStates)[number];

export type CommercialLifecycle = {
  state: LifecycleState;
  reason: string | null;
};

export type CommercialLifecycleRow = Record<string, unknown>;

function positiveInteger(value: unknown) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

/**
 * The control plane owns the only answer to whether a business may receive a
 * device activation code. UI code intentionally receives this compact result
 * instead of reconstructing readiness from tenant/licence booleans.
 */
export function commercialLifecycle(
  row: CommercialLifecycleRow | null | undefined,
  tenancyMode: 'shared' | 'database_per_tenant',
): CommercialLifecycle {
  if (!row) return { state: 'PROVISIONING', reason: 'BUSINESS_NOT_FOUND' };

  if (row.vendor_business_status !== 'active') {
    return { state: 'BLOCKED', reason: 'VENDOR_BUSINESS_INACTIVE' };
  }

  if (row.provisioning_error_code) {
    return { state: 'PROVISIONING_FAILED', reason: String(row.provisioning_error_code) };
  }

  if (!row.license_id) {
    return { state: 'PROVISIONING', reason: 'LICENSE_PENDING' };
  }

  if (row.license_status !== 'active') {
    return {
      state: 'BLOCKED',
      reason: row.license_status === 'revoked' ? 'LICENSE_REVOKED' : 'LICENSE_DISABLED',
    };
  }

  if (row.license_expires_at && Date.parse(String(row.license_expires_at)) <= Date.now()) {
    return { state: 'BLOCKED', reason: 'LICENSE_EXPIRED' };
  }

  if (!positiveInteger(row.max_devices)) {
    return { state: 'BLOCKED', reason: 'LICENSE_DEVICE_QUOTA_INVALID' };
  }

  for (const key of ['max_desktop_devices', 'max_web_devices', 'max_mobile_devices']) {
    const value = row[key];
    if (value != null && (!Number.isInteger(Number(value)) || Number(value) < 0)) {
      return { state: 'BLOCKED', reason: 'LICENSE_DEVICE_QUOTA_INVALID' };
    }
  }

  if (tenancyMode === 'database_per_tenant') {
    if (row.tenant_status === 'error') {
      return { state: 'PROVISIONING_FAILED', reason: 'TENANT_PROVISIONING_FAILED' };
    }
    if (row.tenant_status !== 'active' || !row.runtime_business_id) {
      return { state: 'PROVISIONING', reason: 'TENANT_PROVISIONING' };
    }
  } else if (!row.runtime_business_id) {
    return { state: 'PROVISIONING', reason: 'RUNTIME_BUSINESS_PENDING' };
  }

  return { state: 'READY_FOR_ACTIVATION', reason: null };
}
