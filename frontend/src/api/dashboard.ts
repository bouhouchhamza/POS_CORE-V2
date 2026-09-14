import client, { unwrapData } from './client'

export type LowStockProduct = {
  id: number
  name: string
  stock_quantity: number
  min_stock: number
  category_name?: string | null
}

export type DashboardSummary = {
  today_sales: number
  today_tickets: number
  low_stock_count: number
  low_stock_products: LowStockProduct[]
}

export async function getDashboardSummary() {
  const response = await client.get<DashboardSummary>('/dashboard')
  return unwrapData<DashboardSummary>(response)
}
