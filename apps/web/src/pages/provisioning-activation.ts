type SetupState = {
  configured: boolean
  requires_provisioning?: boolean
}

type HttpFailure = {
  response?: {
    status?: unknown
    data?: {
      code?: unknown
    }
  }
}

const unusableProvisioningGrantCodes = new Set([
  'PROVISIONING_ACTIVATION_GRANT_REQUIRED',
  'PROVISIONING_ACTIVATION_GRANT_INVALID',
  'PROVISIONING_ACTIVATION_GRANT_ALREADY_CONSUMED',
  'PROVISIONING_ACTIVATION_GRANT_REPLAY',
  'PROVISIONING_ACTIVATION_GRANT_REVOKED',
  'PROVISIONING_ACTIVATION_GRANT_EXPIRED',
  'PROVISIONING_ACTIVATION_GRANT_CONTEXT_MISMATCH',
])

const activationErrorKeys: Record<string, string> = {
  DEVICE_LIMIT_REACHED: 'license.error.deviceLimit',
  LICENSE_DEVICE_LIMIT_REACHED: 'license.error.deviceLimit',
  LICENSE_DEVICE_CHANNEL_LIMIT_REACHED: 'license.error.deviceLimit',
  TENANT_SUSPENDED: 'license.error.disabled',
  TENANT_INACTIVE: 'license.error.disabled',
  VENDOR_BUSINESS_INACTIVE: 'license.error.disabled',
  LICENSE_INACTIVE: 'license.error.disabled',
  LICENSE_REVOKED: 'license.error.disabled',
  LICENSE_EXPIRED: 'license.error.licenseExpired',
}

export type ProvisioningPageAction =
  | 'provision'
  | 'recover-activation'
  | 'activation'

export type ProvisioningActivationOutcome =
  | { kind: 'activated' }
  | { kind: 'provisioning-failed'; error: unknown }
  | { kind: 'activation-failed'; error: unknown }
  | { kind: 'provisioning-required' }
  | { kind: 'in-flight' }

type ProvisioningActivationOperations = {
  provision?: () => Promise<unknown>
  activate: () => Promise<unknown>
}

export function provisioningPageAction(
  setup: SetupState,
): ProvisioningPageAction {
  if (setup.requires_provisioning) return 'provision'
  return setup.configured ? 'recover-activation' : 'activation'
}

export function isUnavailableProvisioningGrant(value: unknown) {
  const code = (value as HttpFailure)?.response?.data?.code
  return typeof code === 'string' && unusableProvisioningGrantCodes.has(code)
}

export function provisioningGrantRecoveryAction(value: unknown) {
  return isUnavailableProvisioningGrant(value) ? 'activation' : 'retry'
}

export function activationRecoveryMessageKey(value: unknown) {
  const response = (value as HttpFailure)?.response
  const code = response?.data?.code
  const status = response?.status

  if (typeof code === 'string' && activationErrorKeys[code]) {
    return activationErrorKeys[code]
  }

  return typeof status !== 'number' || status >= 500
    ? 'license.error.serverUnavailable'
    : 'license.error.generic'
}

export function createProvisioningActivationFlow() {
  let provisioningCompleted = false
  let inFlight = false

  return {
    markProvisioningCompleted() {
      provisioningCompleted = true
    },

    isProvisioningCompleted() {
      return provisioningCompleted
    },

    async run(
      operations: ProvisioningActivationOperations,
    ): Promise<ProvisioningActivationOutcome> {
      if (inFlight) return { kind: 'in-flight' }

      inFlight = true

      try {
        if (!provisioningCompleted) {
          if (!operations.provision) {
            return { kind: 'provisioning-required' }
          }

          try {
            await operations.provision()
            provisioningCompleted = true
          } catch (error) {
            return { kind: 'provisioning-failed', error }
          }
        }

        try {
          await operations.activate()
          return { kind: 'activated' }
        } catch (error) {
          return { kind: 'activation-failed', error }
        }
      } finally {
        inFlight = false
      }
    },
  }
}
