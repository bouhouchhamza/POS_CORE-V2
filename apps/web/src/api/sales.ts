import client, { unwrapData } from './client'
import type { Sale, SalePayload } from '../types'

export async function getSales() {
  const response = await client.get<{ data: Sale[] }>('/sales')
  return unwrapData<Sale[]>(response)
}

export async function createSale(payload: SalePayload) {
  const response = await client.post<{ data: Sale }>('/sales', payload)
  return unwrapData<Sale>(response)
}

export async function getSale(id: number) {
  const response = await client.get<{ data: Sale }>(`/sales/${id}`)
  return unwrapData<Sale>(response)
}

export async function printSaleTicket(id: number, copies = 2) {
  const response = await client.post<{ printed: boolean; copies: number }>(
    `/sales/${id}/print-ticket`,
    { copies },
  )

  return response.data
}

export async function returnSale(id:number,payload:{reason:string;refund_method:'original'|'cash'|'card'|'other';items:{sale_item_id:number;quantity:number}[]}) {
  const response=await client.post(`/sales/${id}/returns`,payload)
  return unwrapData(response)
}
