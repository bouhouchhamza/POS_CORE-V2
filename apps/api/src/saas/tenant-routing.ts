import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from '../config.js';
import { runWithTenant, type TenantRecord } from './tenant-context.js';
import { findTenantBySlug, normalizeTenantSlug } from './tenant-registry.js';

const tenantOptionalRoutes = new Set([
  '/api/auth/login-context',
  '/api/auth/business-context/forget',
  '/api/setup/status',
]);

function isControlPlaneRoute(pathname: string) {
  return (
    pathname.startsWith('/api/vendor/') ||
    pathname === '/api/vendor' ||
    pathname.startsWith('/api/provision') ||
    pathname === '/api/license/device-activate' ||
    pathname === '/api/license/device-validate' ||
    pathname === '/health' ||
    pathname === '/ready'
  );
}

function publicMenuTenantSlug(pathname: string) {
  const match = pathname.match(/^\/api\/public\/menu\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  try {
    return normalizeTenantSlug(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function headerTenantSlug(request: FastifyRequest) {
  const raw = request.headers[config.SAAS_TENANT_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? normalizeTenantSlug(value) : null;
}

function inactiveTenantReply(reply: FastifyReply, tenant: TenantRecord) {
  const code = tenant.status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_INACTIVE';
  return reply.code(403).send({
    message: 'This workspace is not active.',
    code,
  });
}

export async function registerTenantRouting(app: FastifyInstance, controlPool: pg.Pool) {
  if (config.SAAS_TENANCY_MODE !== 'database_per_tenant') return;

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (isControlPlaneRoute(pathname)) return;

    const explicitSlug = headerTenantSlug(request);
    const publicSlug = publicMenuTenantSlug(pathname);
    const slug = explicitSlug ?? publicSlug;

    if (!slug) {
      if (tenantOptionalRoutes.has(pathname)) return;
      return reply.code(400).send({
        message: 'Workspace is required.',
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }

    if (explicitSlug && publicSlug && explicitSlug !== publicSlug) {
      return reply.code(409).send({
        message: 'Workspace does not match the public menu.',
        code: 'TENANT_CONTEXT_MISMATCH',
      });
    }

    const tenant = await findTenantBySlug(controlPool, slug);
    if (!tenant) {
      return reply.code(404).send({
        message: 'Workspace not found.',
        code: 'TENANT_NOT_FOUND',
      });
    }

    if (tenant.status !== 'active') return inactiveTenantReply(reply, tenant);

    (request as any).bimikTenant = tenant;
  });

  // Enter the AsyncLocalStorage context before all route-specific preHandlers
  // and handlers. This is what makes the existing operational DB calls select
  // exactly one tenant database without trusting business_id from the client.
  app.addHook('preHandler', (request, _reply, done) => {
    const tenant = (request as any).bimikTenant as TenantRecord | undefined;
    if (!tenant) return done();
    return runWithTenant(tenant, done);
  });
}
