export const HUMAN_ACTIVATION_CODE_PAYLOAD_LENGTH = 16

const FRIENDLY_CHARACTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const FRIENDLY_COMPLETE = new RegExp(
  `^CP[${FRIENDLY_CHARACTERS}]{${HUMAN_ACTIVATION_CODE_PAYLOAD_LENGTH}}$`,
)

export function normalizeActivationCodeInput(value: string) {
  const trimmed = value.trim()
  const compact = trimmed.replace(/[\s-]/g, '').toUpperCase()

  if (!FRIENDLY_COMPLETE.test(compact)) return trimmed

  const payload = compact.slice(2)
  return `CP-${payload.match(/.{1,4}/g)!.join('-')}`
}

export function formatActivationCodeWhileTyping(value: string) {
  const compact = value.replace(/[\s-]/g, '').toUpperCase()

  // Never rewrite opaque legacy credentials.
  if (!compact.startsWith('CP')) return value
  if (!/^CP[A-Z0-9]*$/.test(compact)) return value
  if (compact.length > HUMAN_ACTIVATION_CODE_PAYLOAD_LENGTH + 2) return value

  const payload = compact.slice(2)
  return payload ? `CP-${payload.match(/.{1,4}/g)!.join('-')}` : compact
}

export function activationErrorCode(error: unknown) {
  const candidate = error as {
    code?: unknown
    response?: { data?: { code?: unknown } }
  }
  const code = candidate?.response?.data?.code ?? candidate?.code
  return typeof code === 'string' ? code : null
}

export function activationErrorMessage(
  error: unknown,
  translate: (key: string) => string,
) {
  const code = activationErrorCode(error)
  const keys: Record<string, string> = {
    ACTIVATION_CODE_INVALID: 'license.error.invalid',
    ACTIVATION_CODE_ALREADY_CONSUMED: 'license.error.alreadyUsed',
    ACTIVATION_CODE_REPLAY: 'license.error.alreadyUsed',
    ACTIVATION_CODE_REVOKED: 'license.error.revoked',
    ACTIVATION_CODE_EXPIRED: 'license.error.codeExpired',
    LICENSE_DISABLED: 'license.error.disabled',
    LICENSE_INACTIVE: 'license.error.disabled',
    LICENSE_REVOKED: 'license.error.disabled',
    LICENSE_EXPIRED: 'license.error.licenseExpired',
    DEVICE_LIMIT_REACHED: 'license.error.deviceLimit',
    LICENSE_DEVICE_LIMIT_REACHED: 'license.error.deviceLimit',
    LICENSE_DEVICE_CHANNEL_LIMIT_REACHED: 'license.error.deviceLimit',
    DEVICE_ALREADY_ACTIVATED: 'license.error.alreadyActivated',
    DEVICE_REVOKED: 'license.error.deviceRevoked',
    DEVICE_IDENTITY_MISMATCH: 'license.error.deviceIdentity',
    DEVICE_CHANNEL_MISMATCH: 'license.error.deviceIdentity',
    DEVICE_PROOF_INVALID: 'license.error.deviceProof',
    ACTIVATION_REQUEST_STALE: 'license.error.retry',
    ACTIVATION_REPLAY: 'license.error.alreadyActivated',
    TENANT_NOT_PROVISIONED: 'license.error.workspaceUnavailable',
    VENDOR_BUSINESS_INACTIVE: 'license.error.disabled',
    ACTIVATION_SERVER_UNAVAILABLE: 'license.error.serverUnavailable',
    LICENSE_SERVER_UNAVAILABLE: 'license.error.serverUnavailable',
  }

  if (code && keys[code]) return translate(keys[code])

  const responseStatus = (error as { response?: { status?: unknown } })?.response?.status
  const numericStatus = typeof responseStatus === 'number' ? responseStatus : null
  if (!numericStatus || numericStatus === 429 || numericStatus >= 500) return translate('license.error.serverUnavailable')
  return translate('license.error.generic')
}
