import type pg from 'pg';

export type RuntimeBusinessIdentity = {
  businessId: number;
  vendorBusinessId: string;
  businessType: string;
};

export async function resolveRuntimeBusinessIdentity(
  operationalPool: pg.Pool,
  businessId: number,
): Promise<RuntimeBusinessIdentity | null> {
  const row = (await operationalPool.query(
    `select id,business_type,vendor_business_id
     from businesses
     where id=$1
     limit 1`,
    [businessId],
  )).rows[0];

  if (!row?.vendor_business_id) return null;

  return {
    businessId: Number(row.id),
    vendorBusinessId: String(row.vendor_business_id),
    businessType: String(row.business_type),
  };
}

export async function readCommercialLicenseState(
  controlPool: pg.Pool,
  vendorBusinessId: string,
) {
  return (await controlPool.query(
    `select
       l.id license_id,
       l.status license_status,
       l.expires_at,
       l.allowed_features,
       l.max_devices,
       l.max_desktop_devices,
       l.max_web_devices,
       l.max_mobile_devices,
       vb.status vendor_business_status,
       p.code plan_code
     from licenses l
     join vendor_businesses vb on vb.id=l.vendor_business_id
     left join license_plans p on p.id=l.plan_id
     where l.vendor_business_id=$1
     order by l.issued_at desc,l.created_at desc
     limit 1`,
    [vendorBusinessId],
  )).rows[0] ?? null;
}

export function effectiveLicenseStatus(state: any) {
  if (!state) return 'activation_required';
  if (state.vendor_business_status !== 'active') return 'vendor_business_inactive';
  if (state.license_status !== 'active') return String(state.license_status ?? 'inactive');
  if (state.expires_at && new Date(state.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function hasFeatureEntitlement(
  controlPool: pg.Pool,
  vendorBusinessId: string,
  feature: string,
) {
  const row = (await controlPool.query(
    `select 1
     from licenses l
     join vendor_businesses vb on vb.id=l.vendor_business_id
     where l.vendor_business_id=$1
       and vb.status='active'
       and l.status='active'
       and (l.expires_at is null or l.expires_at>now())
       and l.allowed_features ? $2
     order by l.issued_at desc,l.created_at desc
     limit 1`,
    [vendorBusinessId, feature],
  )).rows[0];

  return Boolean(row);
}
