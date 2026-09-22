import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const url = process.env.TEST_DATABASE_URL;
if (url && !decodeURIComponent(new URL(url).pathname).endsWith('_test')) throw new Error('Disposable _test database required');
if (process.env.REQUIRE_POSTGRES_INTEGRATION === 'true' && !url) throw new Error('TEST_DATABASE_URL required');
const signing = crypto.generateKeyPairSync('ed25519');
process.env.LICENSE_SIGNING_PRIVATE_KEY = signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
process.env.VENDOR_ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
process.env.DATABASE_URL = url ?? 'postgresql://unused@localhost/unused_test';
process.env.JWT_SECRET = 'isolated-onboarding-tests-secret-32-characters';
process.env.NODE_ENV = 'test';
process.env.SAAS_TENANCY_MODE = 'shared';

const headers = { authorization: `Bearer ${process.env.VENDOR_ADMIN_TOKEN}` };
const pool = new pg.Pool({ connectionString: url });
const app = Fastify();
app.setErrorHandler((err: unknown, _request, reply) => {
  const value = err as { statusCode?: number; code?: string; message?: string };
  return reply.code(value.statusCode ?? 500).send({ message: value.message, code: value.code });
});
test.before(async () => {
  if (!url) return;
  await app.register(cookie);
  const { registerLicenseRoutes } = await import('./routes.js');
  await registerLicenseRoutes(app, { pool, operationalPool: pool, authenticate: async (_r, p) => { p.code(401).send(); }, resolveUser: async () => null });
  await app.ready();
});
test.after(async () => { await app.close(); await pool.end(); });

async function planId() {
  return (await pool.query("select id from license_plans where code='business' and active=true")).rows[0].id as string;
}
function payload(key = crypto.randomUUID()) {
  const suffix = key.slice(0, 8);
  return {
    idempotency_key: key,
    customer: { name: `Commercial customer ${suffix}`, email: `customer-${suffix}@example.test` },
    business: { name: `Business ${suffix}`, business_type: 'cafe', currency: 'MAD', locale: 'fr-MA', timezone: 'Africa/Casablanca' },
    owner: { name: `Owner ${suffix}`, email: `owner-${suffix}@example.test`, password: 'correct-horse-battery-staple' },
    plan_id: '', duration: 'lifetime' as const, offline_validity_days: 30,
  };
}
async function onboard(body: ReturnType<typeof payload>) {
  return app.inject({ method: 'POST', url: '/api/vendor/onboarding', headers, payload: body });
}
async function businessCounts(id: string) {
  const result = await pool.query(
    `select
       (select count(*)::int from license_customers c join vendor_businesses vb on vb.customer_id=c.id where vb.id=$1) customers,
       (select count(*)::int from vendor_businesses where id=$1) businesses,
       (select count(*)::int from vendor_business_provisioning where vendor_business_id=$1) recipes,
       (select count(*)::int from licenses where vendor_business_id=$1) licenses,
       (select count(*)::int from businesses where vendor_business_id=$1) runtimes,
       (select count(*)::int from users u join businesses b on b.id=u.business_id where b.vendor_business_id=$1) owners`,
    [id],
  );
  return result.rows[0];
}

test('Commercial onboarding creates one complete commercial and runtime graph for duplicate retries',{ skip: !url }, async () => {
  const body = payload(); body.plan_id = await planId();
  const first = await onboard(body); assert.equal(first.statusCode, 201, first.body);
  const id = first.json().data.business.id as string;
  const retry = await onboard(body); assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().data.replayed, true); assert.equal(retry.json().data.business.id, id);
  assert.deepEqual(await businessCounts(id), { customers: 1, businesses: 1, recipes: 1, licenses: 1, runtimes: 1, owners: 1 });
});

test('Concurrent commercial onboarding retries share one business and incompatible key reuse fails closed',{ skip: !url }, async () => {
  const body = payload(); body.plan_id = await planId();
  const results = await Promise.all([onboard(body), onboard(body)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 201]);
  const ids = results.map(result => result.json().data.business.id as string); assert.equal(ids[0], ids[1]);
  assert.deepEqual(await businessCounts(ids[0]), { customers: 1, businesses: 1, recipes: 1, licenses: 1, runtimes: 1, owners: 1 });
  const incompatible = { ...body, business: { ...body.business, name: `${body.business.name} changed` } };
  const mismatch = await onboard(incompatible); assert.equal(mismatch.statusCode, 409, mismatch.body);
  assert.equal(mismatch.json().code, 'ONBOARDING_REQUEST_PAYLOAD_MISMATCH');
  const another = payload(); another.plan_id = await planId();
  const separate = await onboard(another); assert.equal(separate.statusCode, 201, separate.body);
  assert.notEqual(separate.json().data.business.id, ids[0]);
});

test('A rejected onboarding transaction rolls back its claim and can be retried without partial data',{ skip: !url }, async () => {
  const body = payload(); body.plan_id = crypto.randomUUID();
  const rejected = await onboard(body); assert.equal(rejected.statusCode, 422, rejected.body);
  assert.equal(rejected.json().code, 'PLAN_NOT_FOUND');
  assert.equal((await pool.query('select count(*)::int n from vendor_business_onboarding_requests where idempotency_key=$1', [body.idempotency_key])).rows[0].n, 0);
  body.plan_id = await planId();
  const retry = await onboard(body); assert.equal(retry.statusCode, 201, retry.body);
  assert.deepEqual(await businessCounts(retry.json().data.business.id), { customers: 1, businesses: 1, recipes: 1, licenses: 1, runtimes: 1, owners: 1 });
});
