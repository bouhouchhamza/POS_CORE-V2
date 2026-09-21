import axios from 'axios'
import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getSetupStatus, type LifecycleState, type SetupStatus } from '../api/core-v2'
import { useI18n } from '../i18n'
import { routeForLifecycle } from '../lifecycle-routing'
import Loading from './Loading'

function apiErrorCode(error: unknown) {
  if (!axios.isAxiosError(error)) return null
  const data = error.response?.data
  if (!data || typeof data !== 'object') return null
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function fallbackStatus(error: unknown): SetupStatus {
  const code = apiErrorCode(error)
  if (code === 'DEVICE_ACTIVATION_REQUIRED') {
    return { state: 'READY_FOR_ACTIVATION', configured: false, business: null }
  }
  if (code) {
    return { state: 'BLOCKED', configured: false, business: null, reason: code }
  }
  return { state: 'BLOCKED', configured: false, business: null, reason: 'STATUS_UNAVAILABLE' }
}

function LifecycleNotice({ state }: { state: LifecycleState }) {
  const { t } = useI18n()
  const key = state === 'PROVISIONING'
    ? 'provisioning'
    : state === 'PROVISIONING_FAILED'
      ? 'failed'
      : state === 'BLOCKED'
        ? 'blocked'
        : 'unavailable'

  return (
    <main className="auth-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark">CP</span>
          <div><strong>CorePOS</strong></div>
        </div>
        <div className="login-copy">
          <h1>{t(`lifecycle.${key}.title`)}</h1>
          <p>{t(`lifecycle.${key}.message`)}</p>
        </div>
      </section>
    </main>
  )
}

export default function SetupGate() {
  const { t } = useI18n()
  const location = useLocation()
  const [setup, setSetup] = useState<SetupStatus | null>(null)

  useEffect(() => {
    if (location.pathname.startsWith('/menu/') || location.pathname.startsWith('/m/')) {
      setSetup({ state: 'READY', configured: true, business: null })
      return
    }

    let active = true
    setSetup(null)
    void getSetupStatus()
      .then((status) => { if (active) setSetup(status) })
      .catch((error) => { if (active) setSetup(fallbackStatus(error)) })
    return () => { active = false }
  }, [location.pathname])

  function refreshSetup() {
    setSetup(null)
    void getSetupStatus()
      .then(setSetup)
      .catch((error) => setSetup(fallbackStatus(error)))
  }

  if (setup === null) {
    return <main className="auth-page"><Loading label={t('app.initializing')} /></main>
  }

  const route = routeForLifecycle(setup.state, location.pathname)
  if (route.kind === 'redirect') return <Navigate to={route.to} replace />
  if (route.kind === 'notice') return <LifecycleNotice state={setup.state} />
  return <Outlet context={{ refreshSetup }} />
}
