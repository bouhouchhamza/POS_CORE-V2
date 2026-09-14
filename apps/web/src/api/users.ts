import { api, unwrapData } from './client'
import type { AppUser, UserPayload, UserUpdatePayload } from '../types'
import { normalizeRole } from '../auth/roles'

function canonicalRole(role: unknown) {
  const normalized = normalizeRole(role)
  if (!normalized) throw new Error('Le rôle utilisateur est invalide.')
  return normalized
}

function normalizeUser(value: unknown): AppUser {
  if (!value || typeof value !== 'object') throw new Error('Réponse utilisateur invalide.')
  const user = value as Record<string, unknown>
  const role = canonicalRole(user.role)
  if (typeof user.id !== 'number' || typeof user.name !== 'string' || typeof user.email !== 'string' || typeof user.is_active !== 'boolean') {
    throw new Error('Réponse utilisateur invalide.')
  }
  return {
    id: user.id, name: user.name, email: user.email, role, is_active: user.is_active,
    created_at: typeof user.created_at === 'string' ? user.created_at : undefined,
    updated_at: typeof user.updated_at === 'string' ? user.updated_at : undefined,
  }
}

function canonicalPayload<T extends UserUpdatePayload>(payload: T): T {
  return payload.role === undefined
    ? payload
    : { ...payload, role: canonicalRole(payload.role) }
}

export async function getUsers() {
  const response = await api.get('/users')
  const users = unwrapData<unknown>(response)
  if (!Array.isArray(users)) throw new Error('Réponse utilisateurs invalide.')
  return users.map(normalizeUser)
}

export async function createUser(payload: UserPayload) {
  const response = await api.post('/users', canonicalPayload(payload))
  return normalizeUser(unwrapData<unknown>(response))
}

export async function updateUser(id: number, payload: UserUpdatePayload) {
  const response = await api.put(`/users/${id}`, canonicalPayload(payload))
  return normalizeUser(unwrapData<unknown>(response))
}

export async function deleteUser(id: number) {
  const response = await api.delete(`/users/${id}`)
  return response.data
}
