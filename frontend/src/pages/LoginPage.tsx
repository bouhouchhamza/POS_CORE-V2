import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { getLoginProfiles } from '../api/auth'
import { canAccessPath, getDefaultPath } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import type { LoginProfile } from '../types'
import { getApiErrorMessage } from '../utils/format'

type LocationState = {
  from?: {
    pathname?: string
  }
}

const LAST_PROFILE_KEY = 'last_login_profile_id'

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function getRoleLabel(role: LoginProfile['role']) {
  return role === 'patron' ? 'Patron/Admin' : 'Worker'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { defaultPath, isAuthenticated, isLoading, loginWithCredentials } =
    useAuth()
  const state = location.state as LocationState | null
  const from = state?.from?.pathname || '/dashboard'
  const passwordInputRef = useRef<HTMLInputElement | null>(null)

  const [profiles, setProfiles] = useState<LoginProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<LoginProfile | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isProfilesLoading, setIsProfilesLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadProfiles() {
      try {
        setError(null)
        const data = await getLoginProfiles()

        if (!mounted) return

        // Ensure data is always an array
        const safeProfiles = Array.isArray(data) ? data : []

        if (safeProfiles.length === 0) {
          setError('Aucun profil disponible. Veuillez contacter l\'administrateur.')
          setProfiles([])
          setIsProfilesLoading(false)
          return
        }

        setProfiles(safeProfiles)

        // Try to restore last used profile
        const lastProfileId = Number(localStorage.getItem(LAST_PROFILE_KEY) || 0)
        const lastProfile = safeProfiles.find((profile) => profile.id === lastProfileId)
        if (lastProfile) {
          setSelectedProfile(lastProfile)
        }
      } catch (err) {
        if (mounted) {
          console.error('Error loading profiles:', err)
          setError('Erreur lors du chargement des profils. Veuillez rafraîchir la page.')
          setProfiles([])
        }
      } finally {
        if (mounted) setIsProfilesLoading(false)
      }
    }

    loadProfiles()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (selectedProfile) {
      window.setTimeout(() => passwordInputRef.current?.focus(), 0)
    }
  }, [selectedProfile])

  if (isLoading) {
    return (
      <div className="auth-page">
        <Loading label="Chargement du compte..." />
      </div>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={defaultPath} replace />
  }

  function selectProfile(profile: LoginProfile) {
    localStorage.setItem(LAST_PROFILE_KEY, String(profile.id))
    setSelectedProfile(profile)
    setPassword('')
    setError(null)
  }

  function changeProfile() {
    setSelectedProfile(null)
    setPassword('')
    setError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedProfile) {
      setError('Choisissez un profil.')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const currentUser = await loginWithCredentials(
        selectedProfile.email,
        password,
      )
      const redirectTo = canAccessPath(currentUser.role, from)
        ? from
        : getDefaultPath(currentUser.role)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="login-card profile-login-card">
        <div className="login-brand">
          <span className="brand-mark">BC</span>
          <div>
            <strong>Bimik_Cafe</strong>
            <small>Caisse, stock et ventes</small>
          </div>
        </div>

        <div className="login-copy">
          <h1>Connexion</h1>
          <p>Choisissez votre profil puis entrez le mot de passe.</p>
        </div>

        {isProfilesLoading ? <Loading label="Chargement des profils..." /> : null}
        <ErrorMessage message={error} />

        {!isProfilesLoading && !profiles.length ? (
          <div className="empty-state">Aucun utilisateur disponible.</div>
        ) : null}

        {!isProfilesLoading && profiles.length && !selectedProfile ? (
          <div className="profile-grid">
            {Array.isArray(profiles) && profiles.map((profile) => (
              <button
                className="profile-card"
                key={profile.id}
                onClick={() => selectProfile(profile)}
                type="button"
              >
                <span className="profile-avatar">{getInitials(profile.name)}</span>
                <span>
                  <strong>{profile.name}</strong>
                  <small>{getRoleLabel(profile.role)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {selectedProfile ? (
          <form className="form-grid login-form password-login-form" onSubmit={handleSubmit}>
            <div className="selected-profile-card">
              <span className="profile-avatar">
                {getInitials(selectedProfile.name)}
              </span>
              <span>
                <strong>{selectedProfile.name}</strong>
                <small>{getRoleLabel(selectedProfile.role)}</small>
              </span>
            </div>

            <label>
              Mot de passe
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                ref={passwordInputRef}
                required
                type="password"
                value={password}
              />
            </label>

            <button className="button login-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Connexion...' : 'Se connecter'}
            </button>

            <button
              className="button secondary login-button"
              disabled={isSubmitting}
              onClick={changeProfile}
              type="button"
            >
              Changer de profil
            </button>
          </form>
        ) : null}
      </section>
    </main>
  )
}
