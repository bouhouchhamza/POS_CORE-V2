export type FeatureKey='pos'|'inventory'|'barcode'|'suppliers'|'purchases'|'customers'|'tables'|'qr_menu'|'kitchen'|'takeaway'|'delivery'|'reservations'|'product_variants'|'modifiers'|'weighted_products'|'expiry_tracking'
export type BusinessType='cafe'|'restaurant'|'library'|'grocery'|'drugstore'|'retail'|'custom'
export type Role = 'patron'|'worker'|'owner'|'admin'|'manager'|'cashier'|'seller'|'waiter'|'kitchen'|'stock_manager'
export type Business={id:number;name:string;slug:string;business_type:BusinessType;currency:string;locale:string;timezone:string;logo:string|null;enabled_features:FeatureKey[];branch:{id:number;name:string;code:string}|null}

export interface User {
  id: number
  name: string
  email: string
  role: Role
  is_active: boolean
  created_at: string
  updated_at: string
  business?:Business|null
}

export type LoginProfile = {
  id: number
  name: string
  email: string
  role: Role
}

export type AppUser = {
  id: number
  name: string
  email: string
  role: Role
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface Category {
  id: number
  name: string
  image?: string | null
  image_url?: string | null
  is_public?: boolean
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  category_id: number | null
  category: Category | null
  name: string
  sku?:string|null
  barcode?:string|null
  unit?:string
  tax_rate?:number
  purchase_price?:number
  is_public?:boolean
  available?:boolean
  sale_price: number
  stock: number
  min_stock: number
  track_stock: boolean
  image?: string | null
  image_url?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}
export type UniversalOrder={id:number;sale_id?:number|null;client_id:string;order_number:string;source:string;type:string;table_id:number|null;table_name?:string|null;table_number?:string|null;status:string;subtotal:number;discount:number;tax:number;total:number;payment_status:string;sync_status:string;notes:string|null;created_at:string;items:Array<{id:number;product_id:number;product_name:string;quantity:number;unit_price:number;total:number;notes:string|null;preparation_status:string|null;modifiers:Array<{id:number;name:string;price:number}>}>}
export type Room={id:number;name:string;sort_order:number;active:boolean}
export type RestaurantTable={id:number;room_id:number;room_name?:string;table_number:string;name:string;capacity:number;status:string;qr_token_hint:string;qr_token?:string;active:boolean}
export type Supplier={id:number;name:string;contact:string|null;phone:string|null;email:string|null;address:string|null;notes:string|null;active:boolean}
export type Customer={id:number;name:string;phone:string|null;email:string|null;address:string|null;notes:string|null;active:boolean}
export type Purchase={id:number;supplier_id:number;supplier_name?:string;reference:string;status:string;subtotal:number;tax:number;total:number;payment_status:string;created_at:string}
export type PurchaseItem={id:number;product_id:number;product_name:string;quantity:number;received_quantity:number;returned_quantity:number;purchase_price:number;tax:number;total:number}
export type PurchaseDetail=Purchase&{items:PurchaseItem[]}
export type PurchaseReturn={id:number;purchase_id:number;purchase_item_id:number;product_id:number;quantity:number;reason:string;total:number;created_at:string}

export interface Sale {
  id: number
  user_id: number | null
  cash_register_session_id: number | null
  user: User | null
  total: number
  profit: number
  payment_method: string
  note: string | null
  items: SaleItem[]
  created_at: string
  updated_at: string
}
export type CashRegisterStatus='open'|'closed'
export interface CashRegisterSession {id:number;business_date:string;status:CashRegisterStatus;opened_at:string;opened_by:User;opening_cash:number;opening_note:string|null;closed_at:string|null;closed_by:User|null;expected_cash:number;actual_cash:number|null;difference:number|null;closing_note:string|null;sales_total:number;cash_sales_total:number;non_cash_totals:Record<string,number>;total_orders:number;total_products_sold:number;sales_by_worker:Array<{user_id:number;name:string;total:number;orders:number}>;provisional:boolean}

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
  session_id?: number | null
  status?: CashRegisterStatus
  provisional?: boolean
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
  session?: CashRegisterSession | null
}

export interface ApiAuthResponse {
  user: User
  access_token: string
  token_type: string
}

export type UserPayload = {
  name: string
  email: string
  role: Role
  is_active: boolean
  password?: string | null
}
export type UserUpdatePayload = Partial<UserPayload>

export type ProductPayload = {
  category_id: number | null
  name: string
  sku?:string|null
  barcode?:string|null
  unit?:string
  tax_rate?:number
  sale_price: number
  stock: number
  min_stock: number
  track_stock: boolean
  image?: string | null
  is_active: boolean
  is_public?:boolean
  available?:boolean
}

export type CategoryPayload = {
  name: string
  image?: string | null
  is_public?:boolean
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

export type DuplicateKind = 'none' | 'exact' | 'probable'
export type MenuProductPreview = { client_id:string; name:string; sale_price:string|null; description?:string|null; variant?:string|null; currency:'MAD'; requires_review:boolean; confidence:'high'|'medium'|'low'; review_reasons:string[]; decision:'create'|'update_existing'|'skip'; existing_product_id:number|null; duplicate_kind:DuplicateKind; initial_stock?:number; track_stock:boolean }
export type MenuCategoryPreview = { client_id:string; name:string; decision:'create'|'use_existing'|'skip'; existing_category_id:number|null; duplicate_kind:DuplicateKind; products:MenuProductPreview[] }
export type IgnoredMenuItem = { client_id:string; page:number; text:string; reason:string; confidence:'low' }
export type ExtractedMenu = { session_id:string; page_count:number; currency:'MAD'; categories:MenuCategoryPreview[]; ignored_items:IgnoredMenuItem[]; warnings:string[] }
export type MenuImportResult = { session_id:string; replayed:boolean; categories:{created:number;reused:number;ignored:number}; products:{created:number;updated:number;ignored:number;failed:number} }
