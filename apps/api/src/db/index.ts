import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import {
  currentOperationalDb,
  currentOperationalPool,
} from '../saas/tenant-context.js';

const controlConnectionString = config.CONTROL_PLANE_DATABASE_URL ?? config.DATABASE_URL;

export const controlPool = new pg.Pool({
  connectionString: controlConnectionString,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'bimik-control-plane',
});

// Shared mode intentionally reuses the control-plane pool. In
// database-per-tenant mode this object is only the safe fallback used by the
// dynamic proxy when the mode is shared.
const sharedPool = controlPool;
const sharedDb = drizzle(sharedPool);

function bindPoolMember(property: PropertyKey) {
  const active = currentOperationalPool(sharedPool) as unknown as Record<PropertyKey, unknown>;
  const value = active[property];
  return typeof value === 'function' ? value.bind(active) : value;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, property) {
    return bindPoolMember(property);
  },
});

export const db = new Proxy(sharedDb, {
  get(_target, property) {
    const active = currentOperationalDb(sharedDb) as unknown as Record<PropertyKey, unknown>;
    const value = active[property];
    return typeof value === 'function' ? value.bind(active) : value;
  },
});
