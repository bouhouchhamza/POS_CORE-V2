import axios from 'axios'
import { getWorkspaceSlug } from './tenant'

export const TOKEN_KEY = 'bimik_cafe_token'
export const USER_KEY = 'bimik_cafe_user'

export const AUTH_SESSION_EXPIRED_EVENT = 'bimik:auth-session-expired'
export const AUTH_TOKEN_REFRESHED_EVENT = 'bimik:auth-token-refreshed'

let accessToken: string | null = null

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

type RetryableRequestConfig = {
  _bimikAuthRetried?: boolean
  url?: string
}

let refreshPromise: Promise<string> | null = null

function extractAccessToken(data: unknown): string | null {
  let payload = data

  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload
  ) {
    payload = (payload as { data: unknown }).data
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>

  const token =
    typeof record.access_token === 'string'
      ? record.access_token
      : typeof record.token === 'string'
        ? record.token
        : null

  return token && token.trim() ? token : null
}

function notifySessionExpired() {
  setAccessToken(null)

  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(USER_KEY)
  } catch {
    // Ignore unavailable storage.
  }

  window.dispatchEvent(
    new Event(AUTH_SESSION_EXPIRED_EVENT),
  )
}

function notifyTokenRefreshed(token: string) {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new CustomEvent<string>(
      AUTH_TOKEN_REFRESHED_EVENT,
      { detail: token },
    ),
  )
}

const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export function resolveAssetUrl(value: string | null | undefined) {
  if (!value || /^(data:|blob:|https?:\/\/)/i.test(value)) return value || ''
  if (!value.startsWith('/uploads/')) return value

  if (!apiBaseUrl.startsWith('/')) {
    return `${new URL(apiBaseUrl).origin}${value}`
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase()

    if (
      host === 'tauri.localhost' ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return `http://127.0.0.1:32145${value}`
    }
  }

  return value
}

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
})

function shouldAttachWorkspace(url: string) {
  const path = url.split('?')[0]
  if (path.includes('/public/menu/')) return false
  if (/(?:^|\/)vendor(?:\/|$)/.test(path)) return false
  if (/(?:^|\/)provision(?:\/|$)/.test(path)) return false
  if (/(?:^|\/)license\/(?:device-activate|device-validate)(?:$|\/)/.test(path)) return false

  // The Tauri Desktop talks to its own loopback API and must never inherit a
  // cloud workspace selected by a browser session.
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api/i.test(apiBaseUrl)) {
    return false
  }

  return true
}

api.interceptors.request.use((config) => {
  const token = accessToken

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  const url = String(config.url ?? '')
  const workspace = getWorkspaceSlug()
  if (workspace && shouldAttachWorkspace(url)) {
    config.headers['X-Bimik-Tenant'] = workspace
  } else {
    config.headers.delete('X-Bimik-Tenant')
  }

  if (config.data instanceof FormData) config.headers.delete('Content-Type')

  return config
})

export async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .then((response) => {
        const token = extractAccessToken(response.data)

        if (!token) {
          throw new Error(
            'Refresh response did not contain an access token.',
          )
        }

        setAccessToken(token)
        notifyTokenRefreshed(token)

        return token
      })
      .catch((error) => {
        if (
          axios.isAxiosError(error) &&
          (error.response?.status === 401 || error.response?.status === 403)
        ) {
          notifySessionExpired()
        }
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      !axios.isAxiosError(error) ||
      error.response?.status !== 401 ||
      !error.config
    ) {
      return Promise.reject(error)
    }

    const originalRequest =
      error.config as typeof error.config & RetryableRequestConfig

    const url = String(originalRequest.url ?? '')

    // These routes are intentionally usable before a business access token
    // exists. A 401 here must be surfaced as-is instead of being replaced by
    // a failed /auth/refresh (the old behaviour produced "Session absente"
    // during licence activation and Vendor login).
    const skipsBusinessRefresh =
      /(?:^|\/)(?:login|logout|auth\/refresh|auth\/login-context|auth\/mobile\/login)(?:$|[?#])/.test(url) ||
      /(?:^|\/)vendor(?:\/|$)/.test(url) ||
      /(?:^|\/)license(?:\/|$)/.test(url) ||
      /(?:^|\/)setup\/status(?:$|[?#])/.test(url) ||
      /(?:^|\/)provision(?:\/|$)/.test(url)

    if (
      skipsBusinessRefresh ||
      originalRequest._bimikAuthRetried
    ) {
      return Promise.reject(error)
    }

    originalRequest._bimikAuthRetried = true

    try {
      await refreshAccessToken()

      // api.request passes through the request interceptor again,
      // which attaches the freshly rotated access token.
      return api.request(originalRequest)
    } catch (refreshError) {
      return Promise.reject(refreshError)
    }
  },
)

export function unwrapData<T>(response: { data: unknown }): T {
  const data = response.data

  if (data && typeof data === 'object' && 'data' in data) {
    return (data as { data: unknown }).data as T
  }

  return data as T
}

export default api
