import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getCurrentUser, login as apiLogin, logout as apiLogout } from '../api/auth'
import { TOKEN_KEY, USER_KEY } from '../api/client'
import type { User } from '../types'
import { AuthContext, type AuthContextValue } from './auth-context'
import { getDefaultPath } from './roles'

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
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(() => readStoredUser())
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(localStorage.getItem(TOKEN_KEY)),
  )

  const clearAuth = useCallback(() => {
    clearStoredAuth()
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    let mounted = true

    async function refreshUser() {
      const storedToken = localStorage.getItem(TOKEN_KEY)

      if (!storedToken) {
        if (mounted) {
          setToken(null)
          setUser(null)
          setIsLoading(false)
        }
        return
      }

      try {
        const currentUser = await getCurrentUser()
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser))

        if (mounted) {
          setToken(storedToken)
          setUser(currentUser)
        }
      } catch {
        if (mounted) clearAuth()
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    refreshUser()

    return () => {
      mounted = false
    }
  }, [clearAuth])

  const loginWithCredentials = useCallback(
    async (email: string, password: string) => {
      const authResponse = await apiLogin(email, password)
      localStorage.setItem(TOKEN_KEY, authResponse.token)
      setToken(authResponse.token)

      const currentUser = await getCurrentUser()
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
      isAuthenticated: Boolean(token && user),
      defaultPath: getDefaultPath(user?.role),
      loginWithCredentials,
      logoutUser,
    }),
    [isLoading, loginWithCredentials, logoutUser, token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
