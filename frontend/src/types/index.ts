export interface User {
  id: number
  name: string
  email: string
  role: 'patron' | 'worker' | string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type LoginProfile = {
  id: number
  name: string
  email: string
  role: 'patron' | 'worker'
}

export type AppUser = {
  id: number
  name: string
  email: string
  role: 'patron' | 'worker'
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface Category {
  id: number
  name: string
  image?: string | null
  image_url?: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  category_id: number | null
  category: Category | null
  name: string
  sale_price: number
  stock: number
  min_stock: number
  image?: string | null
  image_url?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Sale {
  id: number
  user_id: number | null
  user: User | null
  total: number
  profit: number
  payment_method: string
  note: string | null
  items: SaleItem[]
  created_at: string
  updated_at: string
}

export interface SaleItem {
  id: number
  sale_id: number
  product_id: number
  product: Product | null
  quantity: number
  unit_price: number
  total: number
  profit: number
  created_at: string
  updated_at: string
}

export interface StockMovement {
  id: number
  product_id: number
  product: Product | null
  user_id: number | null
  user: User | null
  type: string
  quantity: number
  before_stock: number
  after_stock: number
  note: string | null
  created_at: string
  updated_at: string
}

export interface BestSellingProduct {
  product: Product | null
  quantity_sold: number
  sales_total: number
}

export interface DashboardStats {
  products_count: number
  categories_count: number
  low_stock_count: number
  today_sales_total: number
  today_profit: number
  today_sales_count: number
  month_sales_total: number
  month_profit: number
  total_stock_value: number
  best_selling_products: BestSellingProduct[]
}

export interface ReportPeriod {
  type: string
  date?: string
  month?: string
  start: string
  end: string
  worker_id?: number | null
  worker_name?: string | null
}

export interface ReportBestProduct {
  product_id: number
  name: string
  quantity: number
  total: number
}

export interface SalesReport {
  period: ReportPeriod
  total_sales: number
  total_orders: number
  total_products_sold: number
  best_products: ReportBestProduct[]
  commandes: Sale[]
}

export interface ApiAuthResponse {
  user: User
  token: string
  token_type: string
}

export type UserPayload = {
  name: string
  email: string
  role: 'patron' | 'worker'
  is_active: boolean
  password?: string | null
}

export type ProductPayload = {
  category_id: number | null
  name: string
  sale_price: number
  stock: number
  min_stock: number
  image?: string | null
  is_active: boolean
}

export type CategoryPayload = {
  name: string
  image?: string | null
}

export type SalePayload = {
  payment_method: string
  note: string | null
  items: Array<{
    product_id: number
    quantity: number
  }>
}

export type StockQuantityPayload = {
  quantity: number
  note?: string | null
}

export type StockCorrectionPayload = {
  stock: number
  note?: string | null
}
