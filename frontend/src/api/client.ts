import axios from 'axios'

export const TOKEN_KEY = 'bimik_cafe_token'
export const USER_KEY = 'bimik_cafe_user'

export const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

export function unwrapData<T>(response: { data: unknown }): T {
  const data = response.data as any

  if (data && typeof data === 'object' && 'data' in data) {
    return data.data as T
  }

  return data as T
}

export default api
