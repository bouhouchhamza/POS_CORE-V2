import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'error' | 'closed';

export type TenantRecord = {
  id: string;
  vendorBusinessId: string;
  controlBusinessId: number | null;
  slug: string;
  databaseName: string;
  status: TenantStatus;
};

type TenantRuntime = {
  pool: pg.Pool;
  db: ReturnType<typeof drizzle>;
  lastUsedAt: number;
};

type TenantContext = TenantRecord & TenantRuntime;

const storage = new AsyncLocalStorage<TenantContext>();
const tenantPools = new Map<string, TenantRuntime>();

function tenantDatabaseUrl(databaseName: string) {
  const template = config.SAAS_TENANT_DATABASE_URL_TEMPLATE;
  if (!template?.includes('{database}')) {
    throw Object.assign(new Error('Tenant database URL template is not configured.'), {
      statusCode: 503,
      code: 'TENANT_DATABASE_TEMPLATE_MISSING',
    });
  }

  return template.replace('{database}', encodeURIComponent(databaseName));
}

function evictExpiredIdlePools(now: number) {
  const ttlMs = config.SAAS_TENANT_POOL_CACHE_TTL_MINUTES * 60_000;

  for (const [tenantId, runtime] of tenantPools) {
    if (now - runtime.lastUsedAt < ttlMs) continue;

    // Never close a pool that currently has a checked-out connection. A pool
    // with only idle clients is safe to retire; pg.Pool.end() closes them.
    if (runtime.pool.totalCount !== runtime.pool.idleCount) continue;

    tenantPools.delete(tenantId);
    void runtime.pool.end().catch((error) => {
      console.error(`Unable to retire idle tenant pool ${tenantId}:`, error.message);
    });
  }
}

export function tenantRuntime(record: TenantRecord): TenantContext {
  const now = Date.now();
  evictExpiredIdlePools(now);

  let runtime = tenantPools.get(record.id);

  if (!runtime) {
    const pool = new pg.Pool({
      connectionString: tenantDatabaseUrl(record.databaseName),
      max: config.SAAS_TENANT_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: `bimik-tenant-${record.slug}`,
    });

    pool.on('error', (error) => {
      // Do not include connection strings or credentials in logs.
      console.error(`Tenant pool error (${record.slug}):`, error.message);
    });

    runtime = { pool, db: drizzle(pool), lastUsedAt: now };
    tenantPools.set(record.id, runtime);
  } else {
    runtime.lastUsedAt = now;
  }

  return { ...record, ...runtime };
}

export function runWithTenant<T>(record: TenantRecord, callback: () => T): T {
  return storage.run(tenantRuntime(record), callback);
}

export function currentTenant() {
  return storage.getStore() ?? null;
}

export function currentOperationalPool(sharedPool: pg.Pool) {
  if (config.SAAS_TENANCY_MODE === 'shared') return sharedPool;

  const tenant = currentTenant();
  if (!tenant) {
    throw Object.assign(new Error('Tenant context is required.'), {
      statusCode: 400,
      code: 'TENANT_CONTEXT_REQUIRED',
    });
  }

  tenant.lastUsedAt = Date.now();
  return tenant.pool;
}

export function currentOperationalDb(sharedDb: ReturnType<typeof drizzle>) {
  if (config.SAAS_TENANCY_MODE === 'shared') return sharedDb;

  const tenant = currentTenant();
  if (!tenant) {
    throw Object.assign(new Error('Tenant context is required.'), {
      statusCode: 400,
      code: 'TENANT_CONTEXT_REQUIRED',
    });
  }

  tenant.lastUsedAt = Date.now();
  return tenant.db;
}

export async function closeTenantPools() {
  const pools = [...tenantPools.values()].map(({ pool }) => pool);
  tenantPools.clear();
  await Promise.allSettled(pools.map((pool) => pool.end()));
}
