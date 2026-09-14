import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { canAccessPath } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import Loading from './Loading'

export default function ProtectedRoute() {
  const location = useLocation()
  const { defaultPath, isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="auth-page">
        <Loading label="Chargement du compte..." />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!canAccessPath(user?.role, location.pathname)) {
    return <Navigate to={defaultPath} replace />
  }

  return <Outlet />
}
