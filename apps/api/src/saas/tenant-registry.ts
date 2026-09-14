import type pg from 'pg';
import type { TenantRecord, TenantStatus } from './tenant-context.js';

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function rowToTenant(row: any): TenantRecord {
  return {
    id: String(row.id),
    vendorBusinessId: String(row.vendor_business_id),
    controlBusinessId: row.control_business_id == null ? null : Number(row.control_business_id),
    slug: String(row.slug),
    databaseName: String(row.database_name),
    status: String(row.status) as TenantStatus,
  };
}

export function normalizeTenantSlug(value: string) {
  const slug = value.trim().toLowerCase();
  return tenantSlugPattern.test(slug) ? slug : null;
}

export async function findTenantBySlug(controlPool: pg.Pool, rawSlug: string) {
  const slug = normalizeTenantSlug(rawSlug);
  if (!slug) return null;

  const row = (await controlPool.query(
    `select id,vendor_business_id,control_business_id,slug,database_name,status
     from saas_tenants
     where slug=$1
     limit 1`,
    [slug],
  )).rows[0];

  return row ? rowToTenant(row) : null;
}

export async function findTenantByVendorBusinessId(controlPool: pg.Pool, vendorBusinessId: string) {
  const row = (await controlPool.query(
    `select id,vendor_business_id,control_business_id,slug,database_name,status
     from saas_tenants
     where vendor_business_id=$1
     limit 1`,
    [vendorBusinessId],
  )).rows[0];

  return row ? rowToTenant(row) : null;
}
