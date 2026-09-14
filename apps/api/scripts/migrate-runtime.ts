import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../src/config.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);
const connectionString = config.CONTROL_PLANE_DATABASE_URL ?? config.DATABASE_URL;
const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  application_name: 'bimik-control-plane-migrator',
});

try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  console.log('CONTROL_PLANE_MIGRATIONS=PASS');
} finally {
  await pool.end();
}
