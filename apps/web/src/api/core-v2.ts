import api,{unwrapData} from './client'
import type {Business,BusinessType,Customer,FeatureKey,Purchase,PurchaseDetail,PurchaseReturn,RestaurantTable,Room,Supplier,UniversalOrder} from '../types'
export type LifecycleState='PROVISIONING'|'PROVISIONING_FAILED'|'READY_FOR_ACTIVATION'|'DEVICE_ACTIVATED'|'READY'|'BLOCKED'|'SETUP_REQUIRED'
export type SetupStatus={state:LifecycleState;reason?:string|null;configured:boolean;requires_license_activation?:boolean;requires_provisioning?:boolean;requires_tenant_selection?:boolean;business:Pick<Business,'id'|'name'|'slug'|'logo'|'business_type'>|null}
export type ProvisionResolution={vendor_business_name:string;business_type:BusinessType;plan:string|null;allowed_features:FeatureKey[];provisioning_expires_at:string|null;license_expires_at:string|null}
export type PublicMenuChoice={id:number;name:string;price:number}
export type PublicMenuProduct={id:number;category_id:number|null;name:string;sale_price:number;image:string|null;available:boolean;variants:PublicMenuChoice[];modifiers:PublicMenuChoice[]}
export type PublicMenu={business:{name:string;currency:string};table:{id:number;name:string;number:string;room:string};categories:Array<{id:number;name:string;image?:string|null}>;products:PublicMenuProduct[]}
export const getSetupStatus=async()=>unwrapData<SetupStatus>(await api.get('/setup/status'))
export const completeSetup=async(payload:unknown)=>unwrapData<unknown>(await api.post('/setup',payload))
export type ProvisionResult={business?:Business;tenant?:{id:string;slug:string;database_name:string;status:string};replayed?:boolean}
export const provisionBusiness=async(payload:unknown)=>unwrapData<ProvisionResult>(await api.post('/provision',payload))
export const resolveProvisioningKey=async(provisioning_key:string)=>unwrapData<ProvisionResolution>(await api.post('/provision/resolve',{provisioning_key}))
export const getBusiness=async()=>unwrapData<Business>(await api.get('/business/current'))
export const updateBusiness=async(payload:Partial<Business>)=>unwrapData<Business>(await api.put('/business/current',payload))
export const updateFeatures=async(enabled_features:FeatureKey[])=>unwrapData<Business>(await api.put('/business/current/features',{enabled_features}))
export const getOrders=async()=>unwrapData<UniversalOrder[]>(await api.get('/orders'))
export const createOrder=async(payload:unknown)=>unwrapData<UniversalOrder>(await api.post('/orders',payload))
export const appendOrderItems=async(id:number,payload:unknown)=>unwrapData<UniversalOrder>(await api.post(`/orders/${id}/items`,payload))
export const updateOrderStatus=async(id:number,status:string)=>unwrapData<UniversalOrder>(await api.patch(`/orders/${id}/status`,{status}))
export const payOrder=async(id:number,payment_method:'cash'|'card'|'other')=>unwrapData<{order:UniversalOrder;sale_id:number;replayed:boolean}>(await api.post(`/orders/${id}/pay`,{payment_method}))
export const getRooms=async()=>unwrapData<Room[]>(await api.get('/rooms'))
export const createRoom=async(payload:Pick<Room,'name'|'sort_order'|'active'>)=>unwrapData<Room>(await api.post('/rooms',payload))
export const getTables=async()=>unwrapData<RestaurantTable[]>(await api.get('/tables'))
export const createTable=async(payload:Omit<RestaurantTable,'id'|'qr_token_hint'|'qr_token'|'room_name'>)=>unwrapData<RestaurantTable>(await api.post('/tables',payload))
export const rotateTableQr=async(id:number)=>unwrapData<RestaurantTable>(await api.post(`/tables/${id}/qr-token`,{}))
export type TableEvent={id:number;table_id:number;type:'call_waiter'|'request_bill';status:string;table_name:string;table_number:string;created_at:string;resolved_at?:string|null;resolved_by_user_id?:number|null}
export const getTableEvents=async()=>unwrapData<TableEvent[]>(await api.get('/table-events'))
export const resolveTableEvent=async(id:number)=>unwrapData<TableEvent>(await api.patch(`/table-events/${id}/resolve`))
export const getKitchenOrders=async()=>unwrapData<UniversalOrder[]>(await api.get('/kitchen/orders'))
export const updateKitchenItem=async(id:number,status:string)=>unwrapData<UniversalOrder['items'][number]>(await api.patch(`/kitchen/items/${id}`,{status}))
export const getSuppliers=async()=>unwrapData<Supplier[]>(await api.get('/suppliers'))
export const createSupplier=async(payload:Partial<Supplier>)=>unwrapData<Supplier>(await api.post('/suppliers',payload))
export const getCustomers=async()=>unwrapData<Customer[]>(await api.get('/customers'))
export const createCustomer=async(payload:Partial<Customer>)=>unwrapData<Customer>(await api.post('/customers',payload))
export const getPurchases=async()=>unwrapData<Purchase[]>(await api.get('/purchases'))
export const createPurchase=async(payload:unknown)=>unwrapData<Purchase>(await api.post('/purchases',payload))
export const receivePurchase=async(id:number)=>unwrapData<Purchase>(await api.post(`/purchases/${id}/receive`))
export const getPurchase=async(id:number)=>unwrapData<PurchaseDetail>(await api.get(`/purchases/${id}`))
export const returnPurchase=async(id:number,payload:{purchase_item_id:number;quantity:number;reason:string})=>unwrapData<PurchaseReturn>(await api.post(`/purchases/${id}/returns`,payload))
export const getPublicMenu=async(token:string)=>unwrapData<PublicMenu>(await api.get(`/public/menu/table/${encodeURIComponent(token)}`))
export const createQrOrder=async(token:string,payload:unknown)=>unwrapData<UniversalOrder>(await api.post(`/public/menu/table/${encodeURIComponent(token)}/orders`,payload))
export const createTableEvent=async(token:string,type:'call_waiter'|'request_bill')=>api.post(`/public/menu/table/${encodeURIComponent(token)}/events`,{type})
