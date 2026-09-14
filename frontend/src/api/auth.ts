import api, { unwrapData } from './client'
import type { ApiAuthResponse, LoginProfile, User } from '../types'

export async function login(email: string, password: string) {
  const response = await api.post<ApiAuthResponse>('/login', {
    email,
    password,
  })

  return unwrapData<ApiAuthResponse>(response)
}

export async function getLoginProfiles(): Promise<LoginProfile[]> {
  const response = await api.get('/login-profiles')
  const raw = response.data as any

  const profiles = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.profiles)
        ? raw.profiles
        : Array.isArray(raw?.users)
          ? raw.users
          : Array.isArray(raw?.data?.profiles)
            ? raw.data.profiles
            : Array.isArray(raw?.data?.users)
              ? raw.data.users
              : null

  if (!Array.isArray(profiles)) {
    console.error('[getLoginProfiles] Invalid profiles response:', raw)
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
