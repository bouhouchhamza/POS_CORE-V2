import type { LicenseCertificate } from './crypto.js'

export function businessTypeAllowed(
  licensedType: string | null | undefined,
  businessType: string,
) {
  return !licensedType || licensedType === businessType
}

export function effectiveFeatures(
  licensed: readonly string[],
  enabled: readonly string[],
) {
  const enabledSet = new Set(enabled)
  return licensed.filter((feature) => enabledSet.has(feature))
}

export function certificateDeadline(certificate: LicenseCertificate) {
  const commercial = certificate.expires_at
    ? Date.parse(certificate.expires_at)
    : Number.POSITIVE_INFINITY
  const offline = certificate.offline_validity_days
    ? Date.parse(certificate.issued_at) + certificate.offline_validity_days * 86_400_000
    : Number.POSITIVE_INFINITY
  return Math.min(commercial, offline)
}

export function certificateIsCurrent(
  certificate: LicenseCertificate,
  at = Date.now(),
) {
  return Number.isFinite(Date.parse(certificate.issued_at)) &&
    certificateDeadline(certificate) > at
}

export type LocalLicenseStatus =
  | 'active'
  | 'expired'
  | 'offline_validity_exceeded'

export function certificateStatus(
  certificate: LicenseCertificate,
  at = Date.now(),
): LocalLicenseStatus {
  const issuedAt = Date.parse(certificate.issued_at)
  const commercialDeadline = certificate.expires_at
    ? Date.parse(certificate.expires_at)
    : Number.POSITIVE_INFINITY
  const offlineDeadline = certificate.offline_validity_days
    ? issuedAt + certificate.offline_validity_days * 86_400_000
    : Number.POSITIVE_INFINITY

  if (!Number.isFinite(issuedAt) || commercialDeadline <= at) return 'expired'
  if (offlineDeadline <= at) return 'offline_validity_exceeded'
  return 'active'
}

export function activationRequestIsFresh(
  requestedAt: string,
  windowMs = 600_000,
  at = Date.now(),
) {
  const delta = at - Date.parse(requestedAt)
  return Number.isFinite(delta) &&
    delta <= windowMs &&
    delta >= -Math.min(windowMs, 300_000)
}
