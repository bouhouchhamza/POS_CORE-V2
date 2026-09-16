import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1/unused_test'
process.env.JWT_SECRET ??= 'device-context-test-secret-at-least-32-characters'
process.env.NODE_ENV = 'test'

test('activated device cookie restores exactly its server-owned tenant and rejects tampering', async () => {
  const {
    ACTIVATED_DEVICE_COOKIE,
    resolveActivatedDeviceTenant,
    setActivatedDeviceCookie,
  } = await import('./device-tenant-context.js')

  let deviceActive = true
  const expected = {
    id: '00000000-0000-4000-8000-0000000000aa',
    vendor_business_id: '00000000-0000-4000-8000-0000000000bb',
    control_business_id: 42,
    slug: 'internal-not-client-input',
    database_name: 'corepos_device_test',
    status: 'active',
  }
  const controlPool = {
    async query(_sql: string, values: unknown[]) {
      assert.deepEqual(values, ['00000000-0000-4000-8000-0000000000dd'])
      return { rows: deviceActive ? [expected] : [] }
    },
  }

  const app = Fastify()
  await app.register(cookie)
  app.get('/issue', async (_request, reply) => {
    setActivatedDeviceCookie(reply, '00000000-0000-4000-8000-0000000000dd')
    return { ok: true }
  })
  app.get('/resolve', async (request, reply) => ({
    tenant: await resolveActivatedDeviceTenant(controlPool as never, request, reply),
  }))
  await app.ready()

  const issued = await app.inject('/issue')
  const raw = String(issued.headers['set-cookie']).split(';')[0]
  assert.match(raw, new RegExp(`^${ACTIVATED_DEVICE_COOKIE}=`))

  const restored = await app.inject({ url: '/resolve', headers: { cookie: raw } })
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().tenant.id, expected.id)
  assert.equal(restored.json().tenant.databaseName, expected.database_name)

  const last = raw.slice(-1)
  const tampered = raw.slice(0, -1) + (last === 'a' ? 'b' : 'a')
  assert.equal((await app.inject({ url: '/resolve', headers: { cookie: tampered } })).json().tenant, null)

  deviceActive = false
  const revoked = await app.inject({ url: '/resolve', headers: { cookie: raw } })
  assert.equal(revoked.json().tenant, null)
  assert.match(String(revoked.headers['set-cookie']), new RegExp(`^${ACTIVATED_DEVICE_COOKIE}=`))

  await app.close()
})

test('public QR token lookup uses only its hash and cannot switch tenant by input', async () => {
  const { findTenantByPublicTableToken } = await import('../saas/tenant-registry.js')
  const token = 'Q'.repeat(43)
  const expectedHash = crypto.createHash('sha256').update(token).digest('hex')
  const tenantRow = {
    id: '00000000-0000-4000-8000-0000000000aa',
    vendor_business_id: '00000000-0000-4000-8000-0000000000bb',
    control_business_id: 42,
    slug: 'internal-tenant-a',
    database_name: 'corepos_tenant_a',
    status: 'active',
    table_id: 7,
  }
  const pool = {
    async query(_sql: string, values: unknown[]) {
      return { rows: values[0] === expectedHash ? [tenantRow] : [] }
    },
  }

  const resolved = await findTenantByPublicTableToken(pool as never, token)
  assert.equal(resolved?.tenant.id, tenantRow.id)
  assert.equal(resolved?.tableId, 7)
  assert.equal(await findTenantByPublicTableToken(pool as never, `${token.slice(0, -1)}X`), null)
})
