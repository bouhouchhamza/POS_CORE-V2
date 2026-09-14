import { createContext } from 'react'
import type { User } from '../types'

export type AuthContextValue = {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
  defaultPath: string
  loginWithCredentials: (email: string, password: string) => Promise<User>
  logoutUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
