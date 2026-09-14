import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { canAccessPath } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n'
import Loading from './Loading'

export default function ProtectedRoute() {
  const location = useLocation()
  const { defaultPath, isAuthenticated, isLoading, user } = useAuth()
  const { t } = useI18n()

  if (isLoading) {
    return (
      <div className="auth-page">
        <Loading label={t('protected.loading')} />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!canAccessPath(user?.role, location.pathname, user?.business?.enabled_features)) {
    return <Navigate to={defaultPath} replace />
  }

  return <Outlet />
}
