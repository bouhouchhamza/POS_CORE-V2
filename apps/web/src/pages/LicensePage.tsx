import { offlineProofPayload } from '@bimik/shared-types'
import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import QRCode from 'qrcode'
import {
  activateOnline,
  createOfflineRequest,
  getLicenseStatus,
  importOfflineLicense,
  revalidateLicense,
  type LicenseStatus,
} from '../api/license'
import { getApiErrorMessage } from '../utils/format'
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

const isTauriRuntime = () =>
  '__TAURI_INTERNALS__' in window


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
const validationProofPayload = (input: Record<string, string>) => [
  'device-validate-v1', input.license_id, input.certificate_id,
  input.installation_id, input.device_public_key, input.device_name,
  input.app_version, input.nonce, input.requested_at,
].join('\n')
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

  // Browser/cloud mode never persists the private key.
  const storedRaw = localStorage.getItem(BROWSER_DEVICE_KEY)

  if (storedRaw) {
    try {
      const stored = JSON.parse(storedRaw)

      if (validPublicIdentity(stored)) return stored
    } catch {
      localStorage.removeItem(BROWSER_DEVICE_KEY)
    }
  }

  // Migrate only the non-secret portion of the old browser identity.
  const legacyRaw = localStorage.getItem(LEGACY_DEVICE_KEY)

  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw)

      if (validPublicIdentity(legacy)) {
        const identity: DeviceIdentity = {
          installation_id: legacy.installation_id,
          public_key: legacy.public_key,
        }

        localStorage.setItem(
          BROWSER_DEVICE_KEY,
          JSON.stringify(identity),
        )
        localStorage.removeItem(LEGACY_DEVICE_KEY)

        return identity
      }
    } catch {
      // Invalid legacy data is discarded below.
    }

    localStorage.removeItem(LEGACY_DEVICE_KEY)
  }

  const generated = await generateDeviceMaterial()

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

export default function LicensePage() {
  const { t, language, setLanguage } = useI18n()
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<unknown>(null)
  const [qr, setQr] = useState('')
  const [configured, setConfigured] = useState(false)
  const [activating, setActivating] = useState(false)
  const [redirect, setRedirect] = useState<string | null>(null)
  const activationInFlight = useRef(false)
  const certificate = status?.certificate as Record<string, unknown> | undefined
  const licensedBusinessType=typeof certificate?.business_type==='string'?certificate.business_type:null
  const hasCommercialDuration = Boolean(certificate && 'expires_at' in certificate)
  const lifetime = hasCommercialDuration && certificate?.expires_at == null
  const hasOfflinePolicy = Boolean(certificate && 'offline_validity_days' in certificate)
  const offlineDays = typeof certificate?.offline_validity_days === 'number' ? certificate.offline_validity_days : null
  const permanentOffline = hasOfflinePolicy && certificate?.offline_validity_days == null

  const load = async () => {
    const next = await getLicenseStatus()
    setStatus(next)
    return next
  }

  const refreshActivatedState = async () => {
    const [nextStatus, setup] = await Promise.all([
      getLicenseStatus(),
      getSetupStatus(),
    ])
    setStatus(nextStatus)
    setConfigured(setup.configured)
    if (nextStatus.status === 'active' || nextStatus.status === 'development') {
      setRedirect(setup.configured ? '/login' : '/setup')
    }
  }

  useEffect(() => {
    void load().catch((value) => setError(getApiErrorMessage(value)))
    void getSetupStatus()
      .then((setup) => {
        setConfigured(setup.configured)

      })
      .catch(() => undefined)
  }, [])

  async function online() {
    if (activationInFlight.current) return
    activationInFlight.current = true
    setActivating(true)
    try {
      setError(null)

      const identity = await deviceIdentity()
      const device_name = navigator.platform || 'CorePOS Desktop'
      const app_version = '2.0.8'

      if (isTauriRuntime()) {
        const nonce =
          crypto.randomUUID().replaceAll('-', '') +
          crypto.randomUUID().replaceAll('-', '')

        const requested_at = new Date().toISOString()

        const activationPayload = {
          license_key: key,
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

        await activateOnline({
          ...activationPayload,
          device_proof,
        })
      } else {
        // Web/cloud mode keeps the authenticated merchant flow.
        await activateOnline({
          license_key: key,
          installation_id: identity.installation_id,
          device_public_key: identity.public_key,
          device_name,
          app_version,
        })
      }

      setKey('')
      await refreshActivatedState()
    } catch (value) {
      setError(getApiErrorMessage(value))
    } finally {
      activationInFlight.current = false
      setActivating(false)
    }
  }
  async function offline() {
    try {
      setError(null)
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
      setError(getApiErrorMessage(value))
    }
  }
  async function revalidate(){
    try{
      setError(null)
      const certificate=status?.certificate as Record<string,unknown>|undefined
      if(!certificate?.license_id||!certificate?.certificate_id)throw new Error(t('license.noCertificate'))
      const identity=await deviceIdentity(),nonce=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),requested_at=new Date().toISOString()
      const validationPayload={license_id:String(certificate.license_id),certificate_id:String(certificate.certificate_id),installation_id:identity.installation_id,device_public_key:identity.public_key,device_name:navigator.platform||'CorePOS Desktop',app_version:'2.0.8',nonce,requested_at}
      const device_proof=await signDevicePayload(validationProofPayload(validationPayload),t('license.desktopOnly'))
      await revalidateLicense({
        installation_id:validationPayload.installation_id,
        device_public_key:validationPayload.device_public_key,
        device_name:validationPayload.device_name,
        app_version:validationPayload.app_version,
        nonce:validationPayload.nonce,
        requested_at:validationPayload.requested_at,
        device_proof,
      })
      await load()
    }catch(value){setError(getApiErrorMessage(value))}
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

      await refreshActivatedState()
    } catch (value) {
      setError(getApiErrorMessage(value))
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

        <article className="license-status-card">
          <div>
            <span className="license-section-label">{t('license.currentState')}</span>
            <strong>{t(`license.status.${status?.status??'loading'}`)}</strong>
            <p>{t(`license.message.${status?.status??'activation_required'}`)}</p>
          </div>

          <div className="license-status-meta">
            {hasCommercialDuration ? (
              <span>
                <small>{t('license.expirationLabel')}</small>
                <strong>
                  {lifetime ? t('license.lifetime') : new Date(String(certificate?.expires_at)).toLocaleDateString()}
                </strong>
              </span>
            ) : null}

            {hasOfflinePolicy ? (
              <span>
                <small>{t('license.offlinePolicy')}</small>
                <strong>{permanentOffline ? t('license.offlinePermanent') : t('license.offlineDays', { days: offlineDays ?? '-' })}</strong>
              </span>
            ) : null}

            {status?.development ? (
              <span>
                <small>{t('license.mode')}</small>
                <strong>{t('license.status.development')}</strong>
              </span>
            ) : null}
          </div>

          {permanentOffline ? <p className="license-helper">{t('license.offlinePermanentHelp')}</p> : null}

          {isTauriRuntime() && status?.certificate ? (
            <button
              className="button secondary license-revalidate"
              onClick={() => void revalidate()}
              type="button"
            >
              {t('license.validateNow')}
            </button>
          ) : null}
        </article>

        <div className="license-activation-grid">
          <form className="license-method-card license-online-card" onSubmit={(event)=>{event.preventDefault();void online()}}>
            <div className="license-method-head">
              <span className="license-method-index">01</span>
              <div>
                <h2>{t('license.onlineTitle')}</h2>
                <p>
                  {t('license.onlineHelp')}
                </p>
              </div>
            </div>

            <label className="license-field">
              <span>{t('license.key')}</span>
              <input
                autoComplete="off"
                placeholder={t('license.keyPlaceholder')}
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
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
              <span className="license-details-hint">{t('license.show')}</span>
            </summary>

            <div className="license-offline-content">
              <label className="license-field">
                <span>{t('license.businessType')}</span>
                <input readOnly value={licensedBusinessType?t(`businessType.${licensedBusinessType}.title`):t('license.typeDetermined')} />
              </label>
              <small className="license-helper">{t(licensedBusinessType?'license.typeBound':'license.typeAutomatic')}</small>

              <div className="license-offline-actions">
                <button
                  className="button secondary"
                  onClick={() => void offline()}
                  type="button"
                >
                  {t('license.generateRequest')}
                </button>

                {request ? (
                  <button
                    className="button"
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
