export const featureKeys = ['pos','inventory','barcode','suppliers','purchases','customers','tables','qr_menu','kitchen','takeaway','delivery','reservations','product_variants','modifiers','weighted_products','expiry_tracking'] as const;
export type FeatureKey = typeof featureKeys[number];
export const businessTypes = ['cafe','restaurant','library','grocery','drugstore','retail','custom'] as const;
export type BusinessType = typeof businessTypes[number];
export type OfflineDeviceFacts = { installation_id:string; device_public_key:string; device_name:string; app_version:string; nonce:string; requested_at:string };
export type OfflineRequest = OfflineDeviceFacts & {device_proof:string} & ({version:1;business_type:BusinessType}|{version:2;platform:string});
/** v1 is frozen for deployed clients; v2 signs a JSON array of device facts only. */
export function offlineProofPayload(input: OfflineDeviceFacts & ({version:1;business_type:BusinessType}|{version:2;platform:string})):string {
  const facts=[input.installation_id,input.device_public_key,input.device_name,input.app_version];
  return input.version===1
    ? ['posreq-v1',...facts,input.business_type,input.nonce,input.requested_at].join('\n')
    : JSON.stringify(['posreq-v2',...facts,input.platform,input.nonce,input.requested_at]);
}
export const roleKeys = ['patron','worker','owner','admin','manager','cashier','seller','waiter','kitchen','stock_manager'] as const;
export type Role = typeof roleKeys[number];
export type Permission = 'business.manage'|'users.manage'|'products.read'|'products.write'|'pos.use'|'cash.manage'|'orders.read'|'orders.write'|'tables.manage'|'kitchen.use'|'inventory.read'|'inventory.write'|'purchases.manage'|'suppliers.manage'|'customers.manage'|'reports.read';
export const recommendedFeatures: Record<BusinessType, FeatureKey[]> = {
  cafe:['pos','inventory','tables','kitchen','qr_menu','takeaway'], restaurant:['pos','inventory','tables','kitchen','qr_menu','takeaway','delivery','reservations'],
  library:['pos','inventory','barcode','suppliers','purchases','customers'], grocery:['pos','inventory','barcode','suppliers','purchases','weighted_products'],
  drugstore:['pos','inventory','barcode','suppliers','purchases','expiry_tracking'], retail:['pos','inventory','barcode','suppliers','purchases','customers','product_variants'], custom:['pos'],
};
export type Business = { id:number; name:string; slug:string; business_type:BusinessType; currency:string; locale:string; timezone:string; logo:string|null; enabled_features:FeatureKey[]; branch:{id:number;name:string;code:string}|null; created_at?:string; updated_at?:string };
export type User = { id: number; business_id?:number; branch_id?:number|null; name: string; email: string; role: Role; permissions?:Permission[]; business?:Business|null; is_active: boolean; created_at?: string; updated_at?: string };
export type Category = { id: number; name: string; image: string | null; created_at?: string; updated_at?: string };
export type Product = { id: number; category_id: number | null; name: string; purchase_price: number; sale_price: number; stock: number; min_stock: number; track_stock: boolean; image: string | null; is_active: boolean; category?: Category | null; created_at?: string; updated_at?: string };
export type SaleItem = { id: number; sale_id: number; product_id: number; quantity: number; unit_price: number; purchase_price: number; total: number; profit: number; product?: Product };
export type Sale = { id: number; user_id: number; cash_register_session_id:number|null; payment_method: string; note: string | null; total: number; profit: number; user?: User; items?: SaleItem[]; created_at: string; updated_at: string };
export type CashRegisterStatus='open'|'closed';
export type CashRegisterSession={id:number;business_date:string;status:CashRegisterStatus;opened_at:string;opened_by:User;opening_cash:number;opening_note:string|null;closed_at:string|null;closed_by:User|null;expected_cash:number;actual_cash:number|null;difference:number|null;closing_note:string|null;sales_total:number;cash_sales_total:number;non_cash_totals:Record<string,number>;total_orders:number;total_products_sold:number;sales_by_worker:Array<{user_id:number;name:string;total:number;orders:number}>;provisional:boolean};
export type CashRegisterOpenPayload={opening_cash:string;opening_note?:string|null};
export type CashRegisterClosePayload={actual_cash:string;closing_note?:string|null};
export type CashRegisterReportPeriod={type:'cash_register_session';date:string;start:string;end:string;session_id:number|null;status:'open'|'closed';provisional:boolean;worker_id?:number|null;worker_name?:string|null};
export type CashRegisterDailyReport={period:CashRegisterReportPeriod;session:CashRegisterSession|null;total_sales:number;total_orders:number;total_products_sold:number;best_products:Array<{product_id:number;name:string;quantity:number;total:number}>;commandes:Sale[]};
export type DuplicateKind = 'none' | 'exact' | 'probable';
export type MenuCategoryDecision = 'create' | 'use_existing' | 'skip';
export type MenuProductDecision = 'create' | 'update_existing' | 'skip';
export type MenuProductPreview = { client_id:string; name:string; sale_price:string|null; description?:string|null; variant?:string|null; currency:'MAD'; requires_review:boolean; confidence:'high'|'medium'|'low'; review_reasons:string[]; decision:MenuProductDecision; existing_product_id:number|null; duplicate_kind:DuplicateKind; initial_stock?:number; track_stock:boolean };
export type MenuCategoryPreview = { client_id:string; name:string; decision:MenuCategoryDecision; existing_category_id:number|null; duplicate_kind:DuplicateKind; products:MenuProductPreview[] };
export type IgnoredMenuItem = { client_id:string; page:number; text:string; reason:string; confidence:'low' };
export type ExtractedMenu = { session_id:string; page_count:number; currency:'MAD'; categories:MenuCategoryPreview[]; ignored_items:IgnoredMenuItem[]; warnings:string[] };
export type MenuImportRequest = { session_id:string; categories:MenuCategoryPreview[] };
export type MenuImportResult = { session_id:string; replayed:boolean; categories:{created:number;reused:number;ignored:number}; products:{created:number;updated:number;ignored:number;failed:number} };
