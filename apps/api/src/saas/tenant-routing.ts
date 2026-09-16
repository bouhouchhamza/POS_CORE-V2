import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { config } from '../config.js';
import { runWithTenant, type TenantRecord } from './tenant-context.js';
import { resolveActivatedDeviceTenant } from '../license/device-tenant-context.js';
import { findTenantByPublicTableToken, findTenantBySlug, normalizeTenantSlug } from './tenant-registry.js';

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

function publicMenuToken(pathname: string) {
  const match = pathname.match(/^\/api\/public\/menu\/table\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
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
    const token = publicMenuToken(pathname);
    const publicTokenContext = token
      ? await findTenantByPublicTableToken(controlPool, token)
      : null;
    const deviceTenant = !publicSlug && !token
      ? await resolveActivatedDeviceTenant(controlPool, request, reply)
      : null;

    // Legacy slug URLs remain readable while printed QRs age out, but normal
    // employee routing never trusts X-Bimik-Tenant. An authenticated JWT may
    // still carry a matching tenant id during a rolling deployment.
    let authenticatedTenant: TenantRecord | null = null;
    if (explicitSlug && request.headers.authorization) {
      try {
        await request.jwtVerify();
        const candidate = await findTenantBySlug(controlPool, explicitSlug);
        if (candidate && (request.user as any).tid === candidate.id) authenticatedTenant = candidate;
      } catch {
        authenticatedTenant = null;
      }
    }

    const tenant = publicTokenContext?.tenant
      ?? deviceTenant
      ?? authenticatedTenant
      ?? (publicSlug ? await findTenantBySlug(controlPool, publicSlug) : null);

    if (!tenant) {
      if (tenantOptionalRoutes.has(pathname)) return;
      if (token) {
        return reply.code(404).send({ message: 'Menu not found.', code: 'PUBLIC_MENU_NOT_FOUND' });
      }
      return reply.code(400).send({
        message: 'Device activation is required.',
        code: 'DEVICE_ACTIVATION_REQUIRED',
      });
    }

    if (explicitSlug && publicSlug && explicitSlug !== publicSlug) {
      return reply.code(409).send({
        message: 'Workspace does not match the public menu.',
        code: 'TENANT_CONTEXT_MISMATCH',
      });
    }

    if (tenant.status !== 'active') return inactiveTenantReply(reply, tenant);

    (request as any).bimikTenant = tenant;
    if (publicTokenContext) (request as any).bimikPublicTableId = publicTokenContext.tableId;
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
