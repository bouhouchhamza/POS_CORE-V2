import api, { refreshAccessToken, unwrapData } from './client'
import type { ApiAuthResponse, LoginProfile, User } from '../types'

export async function login(email: string, password: string) {
  const response = await api.post<ApiAuthResponse>('/login', {
    email,
    password,
  })

  return unwrapData<ApiAuthResponse>(response)
}

export type LoginContext = {
  mode: 'cloud' | 'local'
  profile_picker: boolean
  requires_workspace?: boolean
  business: {
    id: number
    name: string
    slug?: string
    logo?: string | null
    business_type?: string
  } | null
}

export async function getLoginContext(): Promise<LoginContext> {
  const response = await api.get('/auth/login-context')
  return unwrapData<LoginContext>(response)
}

export async function forgetBusinessContext() {
  await api.post('/auth/business-context/forget')
}

export async function getLoginProfiles(): Promise<LoginProfile[]> {
  const response = await api.get('/login-profiles')
  const raw = response.data as Record<string, unknown> | unknown[]
  const nested = !Array.isArray(raw) && raw.data && typeof raw.data === 'object'
    ? raw.data as Record<string, unknown>
    : null

  const profiles = Array.isArray(raw)
    ? raw
    : !Array.isArray(raw) && Array.isArray(raw.data)
      ? raw.data
      : !Array.isArray(raw) && Array.isArray(raw.profiles)
        ? raw.profiles
        : !Array.isArray(raw) && Array.isArray(raw.users)
          ? raw.users
          : Array.isArray(nested?.profiles)
            ? nested.profiles
            : Array.isArray(nested?.users)
              ? nested.users
              : null

  if (!Array.isArray(profiles)) {
    throw new Error('Format des profils invalide.')
  }

  return profiles
}

export async function register(payload: {
  name: string
  email: string
  password: string
  role: string
}) {
  const response = await api.post<ApiAuthResponse>('/register', payload)

  return unwrapData<ApiAuthResponse>(response)
}

export async function getCurrentUser() {
  const response = await api.get<{ data: User }>('/user')

  return unwrapData<User>(response)
}

export async function logout() {
  await api.post('/logout')
}

export async function refreshSession() {
  return { access_token: await refreshAccessToken() }
}
