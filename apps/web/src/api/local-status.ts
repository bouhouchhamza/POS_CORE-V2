import api, { unwrapData } from './client'

export type LocalStatus = {
  mode: 'local'
  internet: 'available' | 'unavailable'
  backup: 'pending' | 'success' | 'error'
  last_backup_at: string | null
}

export async function getLocalStatus() {
  const response = await api.get('/local/status', { timeout: 2500 })
  return unwrapData<LocalStatus>(response)
}
