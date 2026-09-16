import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const candidate of [
  path.join(packageRoot, '.env'),
  path.resolve(packageRoot, '../..', '.env'),
]) {
  if (existsSync(candidate)) loadEnvFile(candidate);
}

export const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CONTROL_PLANE_DATABASE_URL: z.string().min(1).optional(),
  SAAS_TENANCY_MODE: z.enum(['shared', 'database_per_tenant']).default('shared'),
  SAAS_TENANT_DATABASE_URL_TEMPLATE: z.string().min(1).optional(),
  SAAS_DATABASE_ADMIN_URL: z.string().min(1).optional(),
  SAAS_TENANT_DB_OWNER: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  SAAS_TENANT_HEADER: z.string().regex(/^[a-z0-9-]+$/).default('x-bimik-tenant'),
  SAAS_TENANT_POOL_MAX: z.coerce.number().int().min(1).max(10).default(2),
  SAAS_TENANT_POOL_CACHE_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_DIR: z.string().default('/app/uploads'),
  TZ: z.string().default('Africa/Casablanca'),
  ALLOW_PUBLIC_REGISTRATION: z.string().default('false').transform((value) => value === 'true'),
}).superRefine((value, context) => {
  if (value.SAAS_TENANCY_MODE !== 'database_per_tenant') return;

  if (!value.SAAS_TENANT_DATABASE_URL_TEMPLATE?.includes('{database}')) {
    context.addIssue({
      code: 'custom',
      path: ['SAAS_TENANT_DATABASE_URL_TEMPLATE'],
      message: 'database_per_tenant mode requires a URL template containing {database}.',
    });
  }

  if (!value.CONTROL_PLANE_DATABASE_URL) {
    context.addIssue({
      code: 'custom',
      path: ['CONTROL_PLANE_DATABASE_URL'],
      message: 'database_per_tenant mode requires CONTROL_PLANE_DATABASE_URL.',
    });
  }

  if (!value.SAAS_DATABASE_ADMIN_URL) {
    context.addIssue({
      code: 'custom',
      path: ['SAAS_DATABASE_ADMIN_URL'],
      message: 'database_per_tenant mode requires SAAS_DATABASE_ADMIN_URL for automated tenant provisioning.',
    });
  }
}).parse(process.env);

process.env.TZ = config.TZ;

export const allowedOrigins = config.CORS_ORIGINS
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .concat(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'])
  .filter((value, index, values) => values.indexOf(value) === index);
