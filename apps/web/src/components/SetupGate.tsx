import axios from 'axios'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getSetupStatus } from '../api/core-v2'
import { clearWorkspaceSlug } from '../api/tenant'
import { useI18n } from '../i18n'
import Loading from './Loading'

type SetupState = {
  configured: boolean
  requires_license_activation?: boolean
  requires_provisioning?: boolean
  requires_tenant_selection?: boolean
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
    if (location.pathname.startsWith('/menu/')) {
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
          code === 'TENANT_CONTEXT_REQUIRED' ||
          code === 'TENANT_CONTEXT_MISMATCH'
        ) {
          clearWorkspaceSlug()
          setSetup({
            configured: false,
            requires_tenant_selection: true,
            requires_license_activation: false,
            requires_provisioning: false,
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

  // Cloud database-per-tenant mode needs a workspace before any operational
  // route can be resolved. LoginPage owns workspace selection.
  if (
    setup.requires_tenant_selection &&
    location.pathname !== '/login'
  ) {
    return <Navigate to="/login" replace />
  }

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
    !setup.requires_tenant_selection &&
    setup.requires_license_activation &&
    location.pathname !== '/activation'
  ) {
    return <Navigate to="/activation" replace />
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
    !setup.requires_tenant_selection &&
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
