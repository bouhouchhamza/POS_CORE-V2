import { useEffect, useMemo, useState } from 'react'
import { Building2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { getBusiness, updateBusiness, updateFeatures } from '../api/core-v2'
import { getLicenseStatus, type LicenseStatus } from '../api/license'
import type { Business, FeatureKey } from '../types'
import { getApiErrorMessage } from '../utils/format'
import { useI18n } from '../i18n'

const moduleKeys: FeatureKey[]=['pos','inventory','barcode','suppliers','purchases','customers','tables','qr_menu','kitchen','takeaway','delivery','reservations','product_variants','modifiers','weighted_products','expiry_tracking']

export default function CoreV2BusinessSettings() {
  const { t } = useI18n()
  const [business, setBusiness] = useState<Business | null>(null)
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getBusiness()
      .then(setBusiness)
      .catch((cause) => setError(getApiErrorMessage(cause)))

    void getLicenseStatus()
      .then(setLicense)
      .catch((cause) => setLicenseError(getApiErrorMessage(cause)))
  }, [])

  const entitledFeatures = useMemo<FeatureKey[]>(() => {
    if (!business) return []

    if (license?.features === 'all') return moduleKeys

    if (Array.isArray(license?.features)) {
      const licensed = new Set(license.features)
      return moduleKeys.filter((feature) => licensed.has(feature))
    }

    return business.enabled_features.filter((feature) =>
      moduleKeys.includes(feature),
    )
  }, [business, license])

  if (!business) {
    return error ? (
      <section className="settings-card business-settings">
        <div className="error-message">{error}</div>
      </section>
    ) : null
  }

  const entitled = new Set(entitledFeatures)
  const activeLicensed = business.enabled_features.filter((feature) =>
    entitled.has(feature),
  )
  const staleFeatures = business.enabled_features.filter(
    (feature) => !entitled.has(feature),
  )

  function toggle(feature: FeatureKey) {
    if (!entitled.has(feature) || feature === 'pos') return

    const disabling = business.enabled_features.includes(feature)

    if (
      disabling &&
      ['tables', 'kitchen'].includes(feature) &&
      !window.confirm(
        t('businessSettings.disableConfirm',{module:t(`module.${feature}.label`)}),
      )
    ) {
      return
    }

    setBusiness((current) =>
      current && {
        ...current,
        enabled_features: current.enabled_features.includes(feature)
          ? current.enabled_features.filter((item) => item !== feature)
          : [...current.enabled_features, feature],
      },
    )

    setSaved(false)
  }

  async function save() {
    if (saving) return

    setSaving(true)
    setSaved(false)
    setError(null)

    try {
      const updated = await updateBusiness({
        name: business.name,
        business_type: business.business_type,
        currency: business.currency,
        locale: business.locale,
        timezone: business.timezone,
      })

      const requestedFeatures = Array.from(
        new Set(
          business.enabled_features.filter((feature) =>
            entitled.has(feature),
          ),
        ),
      )

      if (entitled.has('pos') && !requestedFeatures.includes('pos')) {
        requestedFeatures.unshift('pos')
      }

      const features = await updateFeatures(requestedFeatures)

      setBusiness({
        ...updated,
        enabled_features: features.enabled_features,
      })
      setSaved(true)
    } catch (cause) {
      setError(getApiErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const activationRequired =
    license &&
    license.status !== 'active' &&
    license.status !== 'development'

  return (
    <section className="settings-card business-settings">
      <div className="settings-card-head">
        <span className="settings-icon">
          <Building2 size={20} />
        </span>
        <div>
          {business.logo ? (
            <img
              alt=""
              className="settings-business-logo"
              src={business.logo}
            />
          ) : null}
          <h3>{t('businessSettings.title')}</h3>
          <p>{t('businessSettings.subtitle')}</p>
        </div>
      </div>

      {error ? <div className="error-message">{error}</div> : null}

      <div className="settings-subsection">
        <h4>{t('businessSettings.general')}</h4>
        <div className="form-grid settings-grid">
          <label>
            {t('common.name')}
            <input
              value={business.name}
              onChange={(event) => {
                setBusiness({ ...business, name: event.target.value })
                setSaved(false)
              }}
            />
          </label>

          <label>
            {t('businessSettings.currency')}
            <input
              maxLength={3}
              value={business.currency}
              onChange={(event) => {
                setBusiness({
                  ...business,
                  currency: event.target.value.toUpperCase(),
                })
                setSaved(false)
              }}
            />
          </label>

          <label>
            {t('businessSettings.language')}
            <input
              value={business.locale}
              onChange={(event) => {
                setBusiness({ ...business, locale: event.target.value })
                setSaved(false)
              }}
            />
          </label>

          <label>
            {t('businessSettings.timezone')}
            <input
              value={business.timezone}
              onChange={(event) => {
                setBusiness({ ...business, timezone: event.target.value })
                setSaved(false)
              }}
            />
          </label>
        </div>
      </div>

      <div className="settings-subsection commerce-type-summary">
        <div>
          <small>{t('businessSettings.type')}</small>
          <strong>{t(`businessType.${business.business_type}.title`)}</strong>
          <span className="settings-inline-helper">
            {t('businessSettings.typeLocked')}
          </span>
        </div>
      </div>

      <div className="settings-subsection commercial-license-overview">
        <div className="commercial-license-head">
          <span className="settings-icon">
            <ShieldCheck size={19} />
          </span>

          <div>
            <small>{t('businessSettings.license')}</small>
            <strong>{t(`license.status.${license?.status??'loading'}`)}</strong>
            <p>
              {t('businessSettings.licenseHelp')}
            </p>
          </div>

          <span
            className={`license-status-pill license-status-${license?.status ?? 'loading'}`}
          >
            {t(`license.status.${license?.status??'loading'}`)}
          </span>
        </div>

        {licenseError ? (
          <div className="error-message">{licenseError}</div>
        ) : null}

        <div className="commercial-license-metrics">
          <span>
            <small>{t('businessSettings.included')}</small>
            <strong>{entitledFeatures.length}</strong>
          </span>

          <span>
            <small>{t('businessSettings.active')}</small>
            <strong>{activeLicensed.length}</strong>
          </span>

          <span>
            <small>{t('businessSettings.expiration')}</small>
            <strong>
              {license?.expires_at
                ? new Date(license.expires_at).toLocaleDateString()
                : license?.status === 'active'
                  ? t('license.lifetime')
                  : '—'}
            </strong>
          </span>
        </div>

        {entitledFeatures.length ? (
          <details className="commercial-license-details">
            <summary>{t('businessSettings.showIncluded')}</summary>
            <div className="commercial-license-chips">
              {entitledFeatures.map((feature) => (
                <span key={feature}>{t(`module.${feature}.label`)}</span>
              ))}
            </div>
          </details>
        ) : null}

        {activationRequired ? (
          <button
            className="button secondary commercial-license-action"
            onClick={() => location.assign('/activation')}
            type="button"
          >
            {t('businessSettings.openActivation')}
          </button>
        ) : null}
      </div>

      <div className="settings-subsection">
        <div className="settings-section-title">
          <span className="settings-icon">
            <SlidersHorizontal size={18} />
          </span>
          <div>
            <h4>{t('businessSettings.tools')}</h4>
            <p>
              {t('businessSettings.toolsHelp')}
            </p>
          </div>
        </div>

        {entitledFeatures.length ? (
          <div className="module-grid commercial-module-grid">
            {entitledFeatures.map((feature) => {
              const required = feature === 'pos'
              const enabled = business.enabled_features.includes(feature)

              return (
                <label
                  className={`module-option${required ? ' required' : ''}`}
                  key={feature}
                >
                  <input
                    checked={required || enabled}
                    disabled={required}
                    onChange={() => toggle(feature)}
                    type="checkbox"
                  />

                  <span>
                    <strong>
                      {t(`module.${feature}.label`)}
                      {required ? (
                        <em className="module-required-badge">{t('businessSettings.required')}</em>
                      ) : null}
                    </strong>

                    <small>{t(`module.${feature}.description`)}</small>
                  </span>
                </label>
              )
            })}
          </div>
        ) : licenseError ? null : (
          <div className="empty-state">
            {t('businessSettings.empty')}
          </div>
        )}

        <p className="commercial-module-note">
          {t('businessSettings.note')}
        </p>

        {staleFeatures.length ? (
          <p className="commercial-module-cleanup">
            {t('businessSettings.cleanup',{count:staleFeatures.length})}
          </p>
        ) : null}
      </div>

      <div className="settings-save-row">
        <button
          className="button"
          disabled={saving || Boolean(licenseError)}
          onClick={() => void save()}
          type="button"
        >
          {saving
            ? t('settings.saving')
            : saved
              ? t('businessSettings.saved')
              : t('settings.saveSettings')}
        </button>
      </div>
    </section>
  )
}
