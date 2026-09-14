import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getCurrentUser, login as apiLogin, logout as apiLogout, refreshSession } from '../api/auth'
import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_TOKEN_REFRESHED_EVENT,
  setAccessToken,
  USER_KEY,
} from '../api/client'
import axios from 'axios'
import type { User } from '../types'
import { AuthContext, type AuthContextValue } from './auth-context'
import { getDefaultPath } from './roles'
import { getBusiness } from '../api/core-v2'

function readStoredUser() {
  const storedUser = localStorage.getItem(USER_KEY)

  if (!storedUser) return null

  try {
    return JSON.parse(storedUser) as User
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}
function clearStoredAuth() {
  setAccessToken(null)
  localStorage.removeItem(USER_KEY)
}

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [isLoading, setIsLoading] = useState(true)

  const clearAuth = useCallback(() => {
    clearStoredAuth()
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    const handleAuthSessionExpired = () => {
      clearAuth()
    }

    const handleAuthTokenRefreshed = (event: Event) => {
      const nextToken =
        (event as CustomEvent<string>).detail

      if (nextToken) {
        setToken(nextToken)
      }
    }

    window.addEventListener(
      AUTH_SESSION_EXPIRED_EVENT,
      handleAuthSessionExpired,
    )

    window.addEventListener(
      AUTH_TOKEN_REFRESHED_EVENT,
      handleAuthTokenRefreshed,
    )

    return () => {
      window.removeEventListener(
        AUTH_SESSION_EXPIRED_EVENT,
        handleAuthSessionExpired,
      )

      window.removeEventListener(
        AUTH_TOKEN_REFRESHED_EVENT,
        handleAuthTokenRefreshed,
      )
    }
  }, [clearAuth])

  useEffect(() => {
    let mounted = true

    async function refreshUser() {
      try {
        const session = await refreshSession()
        setAccessToken(session.access_token)
        const currentUser = await getCurrentUser()
        currentUser.business = await getBusiness()
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser))

        if (mounted) {
          setToken(session.access_token)
          setUser(currentUser)
        }
      } catch (error) {
        if (
          mounted &&
          axios.isAxiosError(error) &&
          (error.response?.status === 401 || error.response?.status === 403)
        ) {
          clearAuth()
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    if (readStoredUser()) refreshUser()
    else setIsLoading(false)

    return () => {
      mounted = false
    }
  }, [clearAuth])

  const loginWithCredentials = useCallback(
    async (email: string, password: string) => {
      const authResponse = await apiLogin(email, password)
      setAccessToken(authResponse.access_token)
      setToken(authResponse.access_token)

      const currentUser = await getCurrentUser()
      currentUser.business = await getBusiness()
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser))
      setUser(currentUser)

      return currentUser
    },
    [],
  )

  const logoutUser = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      clearAuth()
    }
  }, [clearAuth])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      // The visible desktop session follows the locally stored profile.
      // Access tokens remain memory-only and are renewed transparently.
      isAuthenticated: Boolean(user),
      defaultPath: getDefaultPath(user?.role, user?.business?.enabled_features),
      loginWithCredentials,
      logoutUser,
    }),
    [isLoading, loginWithCredentials, logoutUser, token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
