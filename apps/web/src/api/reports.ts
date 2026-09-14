import { api, unwrapData } from './client'
import type { SalesReport, User } from '../types'

export async function getTodayReport(workerId?: number | null) {
  const response = await api.get('/reports/today', {
    params: workerId ? { worker_id: workerId } : undefined,
  })
  return unwrapData<SalesReport>(response)
}

export async function getMonthlyReport(month?: string) {
  const response = await api.get('/reports/monthly', {
    params: month ? { month } : undefined,
  })

  return unwrapData<SalesReport>(response)
}

export type WorkerInfo = Pick<User, 'id' | 'name' | 'email'>

export async function getWorkers() {
  const response = await api.get<{ data: WorkerInfo[] }>('/workers')
  const workers = unwrapData<WorkerInfo[]>(response)
  // Ensure we always return an array
  if (!Array.isArray(workers)) {
    console.warn('[getWorkers] API returned non-array response:', workers)
    return []
  }
  return workers
}

export async function getCashRegisterReport(
  sessionId?: number | null,
  workerId?: number | null,
) {
  const response = await api.get('/reports/cash-register', {
    params: {
      session_id: sessionId || undefined,
      worker_id: workerId || undefined,
    },
  })

  return unwrapData<SalesReport>(response)
}