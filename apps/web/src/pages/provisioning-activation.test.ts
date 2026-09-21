import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activationRecoveryMessageKey,
  createProvisioningActivationFlow,
  provisioningPageAction,
  provisioningGrantRecoveryAction,
} from './provisioning-activation.ts'
import { routeForLifecycle } from '../lifecycle-routing.ts'

test('provisioning success activates the device without a duplicate provisioning request', async () => {
  const flow = createProvisioningActivationFlow()
  let provisions = 0
  let activations = 0

  const result = await flow.run({
    provision: async () => {
      provisions += 1
    },
    activate: async () => {
      activations += 1
    },
  })

  assert.deepEqual(result, { kind: 'activated' })
  assert.equal(provisions, 1)
  assert.equal(activations, 1)
  assert.equal(flow.isProvisioningCompleted(), true)
})

test('a transient activation failure retries activation without re-provisioning', async () => {
  const flow = createProvisioningActivationFlow()
  let provisions = 0
  let activations = 0
  const unavailable = Object.assign(
    new Error('temporarily unavailable'),
    { response: { status: 503 } },
  )

  const first = await flow.run({
    provision: async () => {
      provisions += 1
    },
    activate: async () => {
      activations += 1
      throw unavailable
    },
  })

  assert.deepEqual(first, { kind: 'activation-failed', error: unavailable })
  assert.equal(flow.isProvisioningCompleted(), true)
  assert.equal(activationRecoveryMessageKey(unavailable), 'license.error.serverUnavailable')

  const retry = await flow.run({
    provision: async () => {
      provisions += 1
    },
    activate: async () => {
      activations += 1
    },
  })

  assert.deepEqual(retry, { kind: 'activated' })
  assert.equal(provisions, 1)
  assert.equal(activations, 2)
})

test('a configured workspace recovers a valid pending provisioning grant', async () => {
  const flow = createProvisioningActivationFlow()
  let activations = 0

  assert.equal(
    provisioningPageAction({ configured: true }),
    'recover-activation',
  )

  flow.markProvisioningCompleted()
  const result = await flow.run({
    activate: async () => {
      activations += 1
    },
  })

  assert.deepEqual(result, { kind: 'activated' })
  assert.equal(activations, 1)
})

test('a configured workspace redirects to activation only for a grant-specific replay error', () => {
  assert.equal(
    provisioningPageAction({ configured: true }),
    'recover-activation',
  )

  assert.equal(
    provisioningGrantRecoveryAction({
      response: {
        status: 409,
        data: { code: 'PROVISIONING_ACTIVATION_GRANT_REPLAY' },
      },
    }),
    'activation',
  )
})

test('device and tenant conflicts remain on the recovery screen', () => {
  const invalidActivationCode = {
    response: {
      status: 409,
      data: { code: 'ACTIVATION_CODE_INVALID' },
    },
  }
  const deviceLimit = {
    response: {
      status: 409,
      data: { code: 'DEVICE_LIMIT_REACHED' },
    },
  }
  const tenantSuspended = {
    response: {
      status: 409,
      data: { code: 'TENANT_SUSPENDED' },
    },
  }

  assert.equal(provisioningGrantRecoveryAction(invalidActivationCode), 'retry')
  assert.equal(provisioningGrantRecoveryAction(deviceLimit), 'retry')
  assert.equal(provisioningGrantRecoveryAction(tenantSuspended), 'retry')
  assert.equal(activationRecoveryMessageKey(deviceLimit), 'license.error.deviceLimit')
  assert.equal(activationRecoveryMessageKey(tenantSuspended), 'license.error.disabled')
})

test('server failures remain retryable', () => {
  assert.equal(
    provisioningGrantRecoveryAction({ response: { status: 503 } }),
    'retry',
  )
})

test('normal routing consumes only the authoritative lifecycle state', () => {
  assert.deepEqual(
    routeForLifecycle('READY_FOR_ACTIVATION', '/login'),
    { kind: 'redirect', to: '/activation' },
  )
  assert.deepEqual(
    routeForLifecycle('DEVICE_ACTIVATED', '/activation'),
    { kind: 'redirect', to: '/login' },
  )
  assert.deepEqual(
    routeForLifecycle('READY', '/login'),
    { kind: 'redirect', to: '/dashboard' },
  )
  assert.deepEqual(routeForLifecycle('PROVISIONING', '/activation'), { kind: 'notice' })
  assert.deepEqual(routeForLifecycle('PROVISIONING_FAILED', '/login'), { kind: 'notice' })
  assert.deepEqual(routeForLifecycle('BLOCKED', '/activation'), { kind: 'notice' })
})
