import axios from 'axios'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getSetupStatus } from '../api/core-v2'
import { useI18n } from '../i18n'
import Loading from './Loading'

type SetupState = {
  configured: boolean
  requires_license_activation?: boolean
  requires_provisioning?: boolean
  requires_tenant_selection?: boolean
  activation_reason?: string
}

function apiErrorCode(error: unknown) {
  if (!axios.isAxiosError(error)) return null
  const data = error.response?.data
  if (!data || typeof data !== 'object') return null
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export default function SetupGate() {
  const { t } = useI18n()
  const location = useLocation()
  const [setup, setSetup] = useState<SetupState | null>(null)

  useEffect(() => {
    if (location.pathname.startsWith('/menu/') || location.pathname.startsWith('/m/')) {
      setSetup({ configured: true })
      return
    }

    setSetup(null)

    void getSetupStatus()
      .then(setSetup)
      .catch((error) => {
        const code = apiErrorCode(error)
        if (
          code === 'TENANT_NOT_FOUND' ||
          code === 'TENANT_NOT_PROVISIONED' ||
          code === 'TENANT_CONTEXT_REQUIRED' ||
          code === 'TENANT_CONTEXT_MISMATCH' ||
          code === 'TENANT_SUSPENDED' ||
          code === 'TENANT_INACTIVE' ||
          code === 'DEVICE_ACTIVATION_REQUIRED' ||
          code === 'DEVICE_REVOKED' ||
          code === 'LICENSE_REVOKED' ||
          code === 'LICENSE_INACTIVE' ||
          code === 'LICENSE_EXPIRED' ||
          code === 'VENDOR_BUSINESS_INACTIVE'
        ) {
          setSetup({
            configured: false,
            requires_tenant_selection: false,
            requires_license_activation: true,
            requires_provisioning: false,
            activation_reason: code ?? undefined,
          })
          return
        }

        // Licensing must fail closed. A transient API failure must never make
        // an already configured Desktop installation bypass activation.
        setSetup({
          configured: false,
          requires_license_activation: true,
          requires_provisioning: false,
          requires_tenant_selection: false,
        })
      })
  }, [location.pathname])

  if (setup === null) {
    return (
      <main className="auth-page">
        <Loading label={t('app.initializing')} />
      </main>
    )
  }

  const configured = setup.configured

  if (
    !configured &&
    setup.requires_provisioning &&
    location.pathname !== '/provision'
  ) {
    return <Navigate to="/provision" replace />
  }

  // Licence enforcement applies even to an already configured Desktop
  // business. Existing local data must never bypass activation.
  if (
    setup.requires_license_activation &&
    location.pathname !== '/activation'
  ) {
    return <Navigate to="/activation" replace state={{ activationReason: setup.activation_reason }} />
  }

  if (
    location.pathname === '/activation' &&
    !setup.requires_license_activation
  ) {
    return (
      <Navigate
        to={configured ? '/login' : '/setup'}
        replace
      />
    )
  }

  if (
    !configured &&
    !setup.requires_license_activation &&
    location.pathname !== '/setup'
  ) {
    return <Navigate to="/setup" replace />
  }

  if (configured && location.pathname === '/setup') {
    return <Navigate to="/login" replace />
  }

  return (
    <Outlet
      context={{
        refreshSetup: () =>
          setSetup((current) => ({
            ...(current ?? {}),
            configured: true,
            requires_tenant_selection: false,
          })),
      }}
    />
  )
}
