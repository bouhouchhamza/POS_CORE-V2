import { offlineProofPayload } from '@corepos/shared-types'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  activateOnline,
  activateDevice,
  createOfflineRequest,
  getLicenseStatus,
  importOfflineLicense,
  type LicenseStatus,
} from '../api/license'
import {
  activationErrorMessage,
  formatActivationCodeWhileTyping,
  normalizeActivationCodeInput,
} from '../utils/activationCode'
import ErrorMessage from '../components/ErrorMessage'
import { getSetupStatus } from '../api/core-v2'
import { useI18n, type Language } from '../i18n'

type DeviceIdentity = {
  installation_id: string
  public_key: string
}

type DeviceMaterial = DeviceIdentity & {
  private_key: string
}

const LEGACY_DEVICE_KEY = 'pos-device-identity'
const BROWSER_DEVICE_KEY = 'pos-browser-license-identity'
let browserDeviceMaterial: DeviceMaterial | null = null

const isTauriRuntime = () =>
  '__TAURI_INTERNALS__' in window

const usesLocalDesktopApi = () =>
  /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api(?:\/|$)/i.test(
    String(import.meta.env.VITE_API_URL ?? ''),
  )


async function signDevicePayload(payload: string, desktopOnlyMessage: string) {
  if (!isTauriRuntime()) {
    throw new Error(desktopOnlyMessage)
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('sign_license_device_payload', { payload })
}


const onlineProofPayload = (input: {
  license_key: string
  installation_id: string
  device_public_key: string
  device_name: string
  app_version: string
  nonce: string
  requested_at: string
}) =>
  [
    'device-activate-v1',
    input.license_key.trim(),
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.nonce,
    input.requested_at,
  ].join('\n')
const importProofPayload = (
  certificateId: string,
  installationId: string,
) => ['poslic-import-v1', certificateId, installationId].join('\n')
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    }),
  )

  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function generateDeviceMaterial(): Promise<DeviceMaterial> {
  const keys = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )

  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey)

  return {
    installation_id: crypto.randomUUID(),
    public_key: JSON.stringify(publicKey),
    private_key: JSON.stringify(privateKey),
  }
}

function validPublicIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.installation_id === 'string' &&
    candidate.installation_id.length > 0 &&
    typeof candidate.public_key === 'string' &&
    candidate.public_key.length >= 40
  )
}

async function deviceIdentity(): Promise<DeviceIdentity> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')

    const existing = await invoke<DeviceIdentity | null>(
      'load_license_device_identity',
    )

    if (existing) {
      // Remove the old insecure browser copy if it exists.
      localStorage.removeItem(LEGACY_DEVICE_KEY)
      return existing
    }

    // One-time migration from the previous implementation.
    const legacyRaw = localStorage.getItem(LEGACY_DEVICE_KEY)

    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw) as Record<string, unknown>

        const legacyPrivateKey = legacy.private_key

        if (
          validPublicIdentity(legacy) &&
          legacyPrivateKey !== null &&
          typeof legacyPrivateKey === 'object'
        ) {
          const saved = await invoke<DeviceIdentity>(
            'save_license_device_identity',
            {
              installationId: legacy.installation_id,
              publicKey: legacy.public_key,
              privateKey: JSON.stringify(legacyPrivateKey),
            },
          )

          localStorage.removeItem(LEGACY_DEVICE_KEY)
          return saved
        }

        if (
          validPublicIdentity(legacy) &&
          typeof legacyPrivateKey === 'string'
        ) {
          const saved = await invoke<DeviceIdentity>(
            'save_license_device_identity',
            {
              installationId: legacy.installation_id,
              publicKey: legacy.public_key,
              privateKey: legacyPrivateKey,
            },
          )

          localStorage.removeItem(LEGACY_DEVICE_KEY)
          return saved
        }
      } catch {
        // Invalid legacy data is discarded below.
      }

      localStorage.removeItem(LEGACY_DEVICE_KEY)
    }

    const generated = await generateDeviceMaterial()

    return invoke<DeviceIdentity>('save_license_device_identity', {
      installationId: generated.installation_id,
      publicKey: generated.public_key,
      privateKey: generated.private_key,
    })
  }

  // Browser activation keeps the private key in memory only. The durable
  // association is the server-issued HttpOnly cookie; no tenant or licence
  // secret is written to localStorage.
  const generated = browserDeviceMaterial ?? await generateDeviceMaterial()
  browserDeviceMaterial = generated

  const identity: DeviceIdentity = {
    installation_id: generated.installation_id,
    public_key: generated.public_key,
  }

  localStorage.setItem(
    BROWSER_DEVICE_KEY,
    JSON.stringify(identity),
  )

  return identity
}

async function signBrowserDevicePayload(payload: string) {
  if (!browserDeviceMaterial) throw new Error('Device identity is unavailable.')
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(browserDeviceMaterial.private_key),
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(payload),
  )
  const bytes = new Uint8Array(signature)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export default function LicensePage() {
  const { t, language, setLanguage } = useI18n()
  const location = useLocation()
  const activationReason = (location.state as { activationReason?: string } | null)?.activationReason
  const reasonStatus:LicenseStatus['status'] =
    activationReason === 'DEVICE_REVOKED' ? 'device_revoked' :
    activationReason === 'LICENSE_REVOKED' ? 'revoked' :
    activationReason === 'LICENSE_EXPIRED' ? 'expired' :
    activationReason === 'VENDOR_BUSINESS_INACTIVE' ? 'vendor_business_inactive' :
    activationReason === 'LICENSE_INACTIVE' || activationReason === 'TENANT_SUSPENDED' || activationReason === 'TENANT_INACTIVE' ? 'suspended' :
    'activation_required'
  const [status, setStatus] = useState<LicenseStatus | null>({ status: reasonStatus, features: [] })
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [request, setRequest] = useState<unknown>(null)
  const [qr, setQr] = useState('')
  const [configured, setConfigured] = useState(false)
  const [activating, setActivating] = useState(false)
  const [redirect, setRedirect] = useState<string | null>(null)
  const activationInFlight = useRef(false)

  const load = async () => {
    const next = await getLicenseStatus()
    setStatus(next)
    return next
  }

  const refreshActivatedState = async (deferRedirect = false) => {
    if (!usesLocalDesktopApi()) {
      const setup = await getSetupStatus()
      setStatus({ status: 'active', features: [] })
      setConfigured(setup.configured)
      const target = setup.state === 'SETUP_REQUIRED' ? '/setup' : '/login'
      if (deferRedirect) window.setTimeout(() => setRedirect(target), 900)
      else setRedirect(target)
      return
    }
    const [nextStatus, setup] = await Promise.all([
      getLicenseStatus(),
      getSetupStatus(),
    ])
    setStatus(nextStatus)
    setConfigured(setup.configured)
    if (nextStatus.status === 'active' || nextStatus.status === 'development') {
      const target = setup.state === 'SETUP_REQUIRED' ? '/setup' : '/login'
      if (deferRedirect) window.setTimeout(() => setRedirect(target), 900)
      else setRedirect(target)
    }
  }

  useEffect(() => {
    // Legacy provisioning recovery, when explicitly enabled, performs its
    // own one-time grant exchange. Normal customer activation must never
    // probe that internal endpoint: most visits have no grant cookie, and a
    // probe would create a competing activation path and misleading 401/409s.
    if (!usesLocalDesktopApi()) return

    void load().catch((value) => setError(activationErrorMessage(value, t)))
    void getSetupStatus()
      .then((setup) => setConfigured(setup.configured))
      .catch(() => undefined)
  }, [])

  async function online() {
    if (activationInFlight.current) return
    activationInFlight.current = true
    setActivating(true)
    try {
      setError(null)
      setSuccess(null)

      const activationCode = normalizeActivationCodeInput(key)

      const identity = await deviceIdentity()
      const device_name = navigator.platform || 'CorePOS Desktop'
      const app_version = '2.0.8'

      if (isTauriRuntime()) {
        const nonce =
          crypto.randomUUID().replaceAll('-', '') +
          crypto.randomUUID().replaceAll('-', '')

        const requested_at = new Date().toISOString()

        const activationPayload = {
          license_key: activationCode,
          installation_id: identity.installation_id,
          device_public_key: identity.public_key,
          device_name,
          app_version,
          nonce,
          requested_at,
        }

        const device_proof = await signDevicePayload(
          onlineProofPayload(activationPayload),
          t('license.desktopOnly'),
        )

        const activate = usesLocalDesktopApi() ? activateOnline : activateDevice
        await activate({
          ...activationPayload,
          device_proof,
        })
      } else {
        const nonce =
          crypto.randomUUID().replaceAll('-', '') +
          crypto.randomUUID().replaceAll('-', '')
        const requested_at = new Date().toISOString()
        const activationPayload = {
          license_key: activationCode,
          installation_id: identity.installation_id,
          device_public_key: identity.public_key,
          device_name,
          app_version,
          nonce,
          requested_at,
        }
        await activateDevice({
          ...activationPayload,
          device_proof: await signBrowserDevicePayload(
            onlineProofPayload(activationPayload),
          ),
        })
      }

      setKey('')
      setSuccess(t('license.activationSuccess'))
      await refreshActivatedState(true)
    } catch (value) {
      setError(activationErrorMessage(value, t))
    } finally {
      activationInFlight.current = false
      setActivating(false)
    }
  }
  async function offline() {
    if (activationInFlight.current) return
    activationInFlight.current = true
    setActivating(true)
    try {
      setError(null)
      setSuccess(null)
      setRequest(null)
      setQr('')

      const identity = await deviceIdentity()
      const device_name = navigator.platform || 'CorePOS Desktop'
      const app_version = '2.0.8'
      const nonce =
        crypto.randomUUID().replaceAll('-', '') +
        crypto.randomUUID().replaceAll('-', '')
      const requested_at = new Date().toISOString()

      const requestPayload = {
        version:2 as const,
        platform:'win32',
        installation_id: identity.installation_id,
        device_public_key: identity.public_key,
        device_name,
        app_version,
        nonce,
        requested_at,
      }

      const device_proof = await signDevicePayload(
        offlineProofPayload(requestPayload),
        t('license.desktopOnly'),
      )

      const value = await createOfflineRequest({
        ...requestPayload,
        device_proof,
      })

      setRequest(value)

      setQr(
        await QRCode.toDataURL(JSON.stringify(value), {
          width: 360,
          margin: 1,
          errorCorrectionLevel: 'L',
        }),
      )
    } catch (value) {
      setError(activationErrorMessage(value, t))
    } finally {
      activationInFlight.current = false
      setActivating(false)
    }
  }
  async function imported(file: File) {
    if (activationInFlight.current) return
    activationInFlight.current = true
    setActivating(true)
    try {
      setError(null)

      const license = JSON.parse(await file.text())

      if (!license?.certificate?.certificate_id) {
        throw new Error(t('license.invalidFile'))
      }

      const identity = await deviceIdentity()

      const device_proof = await signDevicePayload(
        importProofPayload(
          license.certificate.certificate_id,
          identity.installation_id,
        ),
        t('license.desktopOnly'),
      )

      await importOfflineLicense({
        ...license,
        installation_id: identity.installation_id,
        device_public_key: identity.public_key,
        device_proof,
      })

      setSuccess(t('license.activationSuccess'))
      await refreshActivatedState(true)
    } catch (value) {
      setError(activationErrorMessage(value, t))
    } finally {
      activationInFlight.current = false
      setActivating(false)
    }
  }
  const isOperational =
    status?.status === 'active' ||
    status?.status === 'development'

  if (redirect) {
    return <Navigate to={redirect} replace />
  }

  if (configured && isOperational) {
    return <Navigate to="/login" replace />
  }

  return (
    <main className="license-page auth-page">
      <section className="license-shell">
        <header className="license-topbar">
          <div className="login-brand license-brand">
            <span className="brand-mark">CP</span>
            <div>
              <strong>CorePOS</strong>
              <small>{t('license.brand')}</small>
            </div>
          </div>

          <label className="language-selector"><span className="sr-only">{t('language.label')}</span><select aria-label={t('language.label')} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select></label>
          <span className={`license-status-pill license-status-${status?.status ?? 'loading'}`}>{t(`license.status.${status?.status??'loading'}`)}</span>
        </header>

        <div className="license-intro">
          <span className="license-kicker">{t('license.secureActivation')}</span>
          <h1>{t('license.title')}</h1>
          <p>
            {t('license.help')}
          </p>
        </div>

        <ErrorMessage message={error} />
        {success ? <div className="success-message license-success" role="status">{success}</div> : null}

        <div className="license-activation-grid">
          <form className="license-method-card license-online-card" onSubmit={(event)=>{event.preventDefault();void online()}}>
            <div className="license-method-head">
              <span className="license-method-index">01</span>
              <div>
                <div className="license-method-title-row">
                  <h2>{t('license.onlineTitle')}</h2>
                  <span className="license-online-badge">{t('license.recommended')}</span>
                </div>
                <p>
                  {t('license.onlineHelp')}
                </p>
              </div>
            </div>

            <label className="license-field license-code-field">
              <span>{t('license.key')}</span>
              <span className="license-code-control">
                <input
                  aria-invalid={Boolean(error)}
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  dir="ltr"
                  inputMode="text"
                  placeholder={t('license.keyPlaceholder')}
                  spellCheck={false}
                  value={key}
                  onBlur={() => setKey(current => normalizeActivationCodeInput(current))}
                  onChange={(event) => setKey(formatActivationCodeWhileTyping(event.target.value))}
                />
                <button
                  className="license-paste-button"
                  onClick={() => void navigator.clipboard.readText()
                    .then(value => setKey(formatActivationCodeWhileTyping(value)))
                    .catch(() => undefined)}
                  type="button"
                >
                  {t('license.paste')}
                </button>
              </span>
              <small className="license-helper">{t('license.codeHelp')}</small>
            </label>

            <button
              className="button license-primary-action"
              disabled={!key.trim() || activating}
              type="submit"
            >
              {t(activating?'license.activating':'license.activate')}
            </button>
          </form>

          <details className="license-method-card license-offline-card">
            <summary>
              <span className="license-method-index">02</span>
              <span>
                <strong>{t('license.offlineTitle')}</strong>
                <small>
                  {t('license.offlineHelp')}
                </small>
              </span>
              <span className="license-details-hint" data-hide-label={t('license.hide')}>{t('license.show')}</span>
            </summary>

            <div className="license-offline-content">
              <div className="license-offline-actions">
                <button
                  className="button secondary"
                  disabled={activating}
                  onClick={() => void offline()}
                  type="button"
                >
                  {t('license.generateRequest')}
                </button>

                {request ? (
                    <button
                      className="button"
                      disabled={activating}
                    onClick={() =>
                      download('activation-request.posreq', request)
                    }
                    type="button"
                  >
                    {t('license.exportRequest')}
                  </button>
                ) : null}
              </div>

              {qr ? (
                <div className="license-qr-wrap">
                  <img
                    alt={t('license.requestQrAlt')}
                    className="activation-qr"
                    src={qr}
                  />
                </div>
              ) : null}

              <label className="license-file-field">
                <span>{t('license.importFile')}</span>
                <input
                  accept=".poslic,application/json"
                  disabled={activating}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void imported(file)
                    event.target.value = ''
                  }}
                  type="file"
                />
              </label>
            </div>
          </details>
        </div>
      </section>
    </main>
  )
}
