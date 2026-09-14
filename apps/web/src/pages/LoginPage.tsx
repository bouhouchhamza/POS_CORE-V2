import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  forgetBusinessContext,
  getLoginContext,
  getLoginProfiles,
  type LoginContext,
} from '../api/auth'
import { canAccessPath, getDefaultPath, getRoleLabel } from '../auth/roles'
import { useAuth } from '../auth/useAuth'
import ErrorMessage from '../components/ErrorMessage'
import Loading from '../components/Loading'
import type { LoginProfile } from '../types'
import { getApiErrorMessage } from '../utils/format'
import {
  clearWorkspaceSlug,
  getWorkspaceSlug,
  normalizeWorkspaceSlug,
  setWorkspaceSlug,
} from '../api/tenant'
import { useI18n, type Language } from '../i18n'

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

export default function LoginPage() {
  const { language, setLanguage, t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { defaultPath, isAuthenticated, isLoading, loginWithCredentials } =
    useAuth()
  const state = location.state as LocationState | null
  const from = state?.from?.pathname || '/dashboard'
  const passwordInputRef = useRef<HTMLInputElement | null>(null)

  const [loginContext, setLoginContext] = useState<LoginContext | null>(null)
  const [profiles, setProfiles] = useState<LoginProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<LoginProfile | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isContextLoading, setIsContextLoading] = useState(true)
  const [isProfilesLoading, setIsProfilesLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isForgettingBusiness, setIsForgettingBusiness] = useState(false)
  const [workspaceInput, setWorkspaceInput] = useState(() => getWorkspaceSlug() ?? '')
  const [isWorkspaceSelecting, setIsWorkspaceSelecting] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadLoginContext() {
      try {
        setError(null)

        // Deep links such as /login?workspace=atlas-cafe-a31f7c82 are safe:
        // the slug is only a routing hint; the server still owns tenant lookup
        // and all authentication/authorization decisions.
        if (typeof window !== 'undefined') {
          const queryWorkspace = new URLSearchParams(window.location.search).get('workspace')
          const normalized = normalizeWorkspaceSlug(queryWorkspace)
          if (normalized) {
            setWorkspaceSlug(normalized)
            setWorkspaceInput(normalized)
          }
        }

        const context = await getLoginContext()
        if (!mounted) return

        setLoginContext(context)

        if (context.requires_workspace || !context.profile_picker) {
          // No workspace or fresh/private cloud browser: never enumerate users.
          localStorage.removeItem(LAST_PROFILE_KEY)
          setProfiles([])
          setSelectedProfile(null)
          return
        }

        setIsProfilesLoading(true)
        const data = await getLoginProfiles()
        if (!mounted) return

        const safeProfiles = Array.isArray(data) ? data : []
        if (safeProfiles.length === 0) {
          setError(t('login.noActiveProfiles'))
          setProfiles([])
          return
        }

        const lastProfileId = Number(localStorage.getItem(LAST_PROFILE_KEY) || 0)
        const lastProfile = safeProfiles.find((profile) => profile.id === lastProfileId)
        setProfiles(lastProfile
          ? [lastProfile, ...safeProfiles.filter((profile) => profile.id !== lastProfile.id)]
          : safeProfiles)
      } catch (err) {
        if (mounted) {
          console.error('Error loading login context:', err)
          clearWorkspaceSlug()
          setLoginContext({
            mode: 'cloud',
            profile_picker: false,
            requires_workspace: true,
            business: null,
          })
          setError(t('login.contextError'))
          setProfiles([])
        }
      } finally {
        if (mounted) {
          setIsContextLoading(false)
          setIsProfilesLoading(false)
        }
      }
    }

    void loadLoginContext()

    return () => {
      mounted = false
    }
  }, [t])

  const requiresWorkspace = Boolean(loginContext?.requires_workspace)
  const profilePickerMode = !requiresWorkspace && Boolean(loginContext?.profile_picker)
  const rememberedCloudBusiness =
    loginContext?.mode === 'cloud' && profilePickerMode

  useEffect(() => {
    if (
      (profilePickerMode && selectedProfile) ||
      (loginContext?.mode === 'cloud' && !profilePickerMode && !requiresWorkspace)
    ) {
      window.setTimeout(() => passwordInputRef.current?.focus(), 0)
    }
  }, [loginContext?.mode, profilePickerMode, requiresWorkspace, selectedProfile])

  if (isLoading || isContextLoading) {
    return (
      <div className="auth-page">
        <Loading label={t('login.loadingAccount')} />
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

  async function changeBusiness() {
    setIsForgettingBusiness(true)
    setError(null)

    try {
      // Forget while the current tenant header is still present, then clear
      // the browser routing hint.
      await forgetBusinessContext()
      clearWorkspaceSlug()
      localStorage.removeItem(LAST_PROFILE_KEY)
      setWorkspaceInput('')
      setLoginContext({
        mode: 'cloud',
        profile_picker: false,
        requires_workspace: true,
        business: null,
      })
      setProfiles([])
      setSelectedProfile(null)
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(getApiErrorMessage(err))
    } finally {
      setIsForgettingBusiness(false)
    }
  }

  async function chooseWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const slug = normalizeWorkspaceSlug(workspaceInput)
    if (!slug) {
      setError(t('login.workspaceInvalid'))
      return
    }

    setIsWorkspaceSelecting(true)
    setError(null)
    try {
      setWorkspaceSlug(slug)
      const context = await getLoginContext()
      if (context.requires_workspace) {
        throw new Error(t('login.workspaceNotFound'))
      }
      setWorkspaceInput(slug)
      setLoginContext(context)
      setProfiles([])
      setSelectedProfile(null)
      localStorage.removeItem(LAST_PROFILE_KEY)

      if (context.profile_picker) {
        setIsProfilesLoading(true)
        const data = await getLoginProfiles()
        const safeProfiles = Array.isArray(data) ? data : []
        setProfiles(safeProfiles)
        if (!safeProfiles.length) setError(t('login.noActiveProfiles'))
      }
    } catch (err) {
      clearWorkspaceSlug()
      setLoginContext({
        mode: 'cloud',
        profile_picker: false,
        requires_workspace: true,
        business: null,
      })
      setError(getApiErrorMessage(err) || t('login.workspaceNotFound'))
    } finally {
      setIsProfilesLoading(false)
      setIsWorkspaceSelecting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const loginEmail = profilePickerMode
      ? selectedProfile?.email ?? ''
      : email.trim().toLowerCase()

    if (profilePickerMode && !selectedProfile) {
      setError(t('login.chooseProfileError'))
      return
    }

    if (!loginEmail) {
      setError(t('login.emailRequired'))
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const currentUser = await loginWithCredentials(loginEmail, password)
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
          <span className="brand-mark">CP</span>
          <div>
            <strong>CorePOS</strong>
            <small>{t('brand.subtitle')}</small>
          </div>
        </div>

        <div className="login-copy">
          {profilePickerMode && loginContext?.business?.logo
            ? <img className="login-business-logo" src={loginContext.business.logo} alt="" />
            : null}
          <h1>
            {profilePickerMode
              ? (loginContext?.business?.name ?? t('login.title'))
              : t('login.title')}
          </h1>
          <p>
            {requiresWorkspace
              ? t('login.workspaceChooseSubtitle')
              : rememberedCloudBusiness
                ? t('login.rememberedSubtitle')
                : t('login.workspaceSubtitle')}
          </p>
          <div aria-label={t('language.label')} className="login-language" role="group">
            {(['fr','ar','en'] as Language[]).map(item => (
              <button
                aria-pressed={language === item}
                className={language === item ? 'active' : ''}
                key={item}
                onClick={() => setLanguage(item)}
                type="button"
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <ErrorMessage message={error} />

        {requiresWorkspace ? (
          <form className="form-grid login-form password-login-form" onSubmit={chooseWorkspace}>
            <label>
              {t('login.workspace')}
              <input
                autoCapitalize="none"
                autoComplete="organization"
                onChange={(event) => setWorkspaceInput(event.target.value.toLowerCase())}
                placeholder={t('login.workspacePlaceholder')}
                required
                spellCheck={false}
                type="text"
                value={workspaceInput}
              />
            </label>
            <button className="button login-button" disabled={isWorkspaceSelecting} type="submit">
              {isWorkspaceSelecting ? t('login.workspaceChecking') : t('login.workspaceContinue')}
            </button>
          </form>
        ) : null}

        {profilePickerMode && isProfilesLoading
          ? <Loading label={t('login.loadingProfiles')} />
          : null}

        {profilePickerMode && !isProfilesLoading && !profiles.length ? (
          <div className="empty-state">{t('login.noUsers')}</div>
        ) : null}

        {profilePickerMode && !isProfilesLoading && profiles.length > 0 && !selectedProfile ? (
          <div className="profile-grid">
            {profiles.map((profile) => (
              <button
                className="profile-card"
                key={profile.id}
                onClick={() => selectProfile(profile)}
                type="button"
              >
                <span className="profile-avatar">{getInitials(profile.name)}</span>
                <span>
                  <strong>{profile.name}</strong>
                  <small>{getRoleLabel(profile.role, language)}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {!requiresWorkspace && !profilePickerMode ? (
          <form className="form-grid login-form password-login-form" onSubmit={handleSubmit}>
            <label>
              {t('login.email')}
              <input
                autoComplete="username"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label>
              {t('login.password')}
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
              {isSubmitting ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>
        ) : null}

        {profilePickerMode && selectedProfile ? (
          <form className="form-grid login-form password-login-form" onSubmit={handleSubmit}>
            <div className="selected-profile-card">
              <span className="profile-avatar">
                {getInitials(selectedProfile.name)}
              </span>
              <span>
                <strong>{selectedProfile.name}</strong>
                <small>{getRoleLabel(selectedProfile.role, language)}</small>
              </span>
            </div>

            <label>
              {t('login.password')}
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
              {isSubmitting ? t('login.signingIn') : t('login.signIn')}
            </button>

            <button
              className="button secondary login-button"
              disabled={isSubmitting}
              onClick={changeProfile}
              type="button"
            >
              {t('login.changeProfile')}
            </button>
          </form>
        ) : null}

        {rememberedCloudBusiness ? (
          <button
            className="button secondary login-button"
            disabled={isForgettingBusiness || isSubmitting}
            onClick={() => void changeBusiness()}
            type="button"
          >
            {isForgettingBusiness ? t('login.changingBusiness') : t('login.changeBusiness')}
          </button>
        ) : null}
      </section>
    </main>
  )
}
