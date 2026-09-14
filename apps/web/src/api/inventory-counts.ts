import client,{unwrapData} from './client'

export type InventoryCount={id:number;status:'draft'|'confirmed';reason?:string|null;created_at:string;confirmed_at?:string|null;item_count?:number;counted_count?:number;items?:InventoryCountItem[]}
export type InventoryCountItem={id:number;product_id:number;name:string;sku?:string|null;barcode?:string|null;unit:string;expected_stock:number;counted_stock:number|null}

export async function getInventoryCounts(){return unwrapData<InventoryCount[]>((await client.get('/inventory-counts')))}
export async function createInventoryCount(reason:string){return unwrapData<InventoryCount>((await client.post('/inventory-counts',{reason:reason||null})))}
export async function getInventoryCount(id:number){return unwrapData<InventoryCount>((await client.get(`/inventory-counts/${id}`)))}
export async function saveInventoryCount(id:number,items:{product_id:number;counted_stock:number}[]){return unwrapData((await client.put(`/inventory-counts/${id}/items`,{items})))}
export async function confirmInventoryCount(id:number){return unwrapData((await client.post(`/inventory-counts/${id}/confirm`,{})))}
