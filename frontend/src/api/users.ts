import { api, unwrapData } from './client'
import type { AppUser, UserPayload } from '../types'

export async function getUsers() {
  const response = await api.get('/users')
  return unwrapData<AppUser[]>(response)
}

export async function createUser(payload: UserPayload) {
  const response = await api.post('/users', payload)
  return unwrapData<AppUser>(response)
}

export async function updateUser(id: number, payload: UserPayload) {
  const response = await api.put(`/users/${id}`, payload)
  return unwrapData<AppUser>(response)
}

export async function deleteUser(id: number) {
  const response = await api.delete(`/users/${id}`)
  return response.data
}
