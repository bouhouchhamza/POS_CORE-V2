import api,{unwrapData} from '../api/client'

type Certificate={license_id:string;certificate_id:string;installation_id:string}
type Identity={installation_id:string;public_key:string}
type Device={license_id:string;certificate_id:string;installation_id:string;device_public_key:string;nonce:string;requested_at:string;device_proof:string}
const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v as object).sort().map(k=>`${JSON.stringify(k)}:${stable((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v)
const line=(v:unknown)=>v==null?'':String(v)
async function proof(action:string,kind:string,c:Certificate,i:Identity,m?:any):Promise<Device>{
  const u={license_id:c.license_id,certificate_id:c.certificate_id,installation_id:i.installation_id,device_public_key:i.public_key,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()}
  const fields=kind==='stock'?['desktop-stock-sync-v1',action,u.license_id,u.certificate_id,u.installation_id,u.device_public_key,u.nonce,u.requested_at,line(m?.client_id),line(m?.product_sync_id),line(m?.type),line(m?.delta),line(m?.note),line(m?.created_at),line(m?.user_email?.toLowerCase()),line(m?.branch_code)]
    :kind==='purchase'?['desktop-purchase-sync-v1',action,u.license_id,u.certificate_id,u.installation_id,u.device_public_key,u.nonce,u.requested_at,line(m?.client_id),line(m?.operation),line(m?.purchase_sync_id),line(m?.base_updated_at),m?stable(m.data):'']
    :kind==='sales'?['desktop-sales-sync-v1',action,u.license_id,u.certificate_id,u.installation_id,u.device_public_key,u.nonce,u.requested_at,line(m?.client_id),line(m?.operation),line(m?.base_updated_at),m?JSON.stringify(m.data):'']
    :['desktop-orders-sync-v1',action,u.license_id,u.certificate_id,u.installation_id,u.device_public_key,u.nonce,u.requested_at,line(m?.client_id),line(m?.operation),m?JSON.stringify(m.data):'']
  const {invoke}=await import('@tauri-apps/api/core');return {...u,device_proof:await invoke<string>('sign_license_device_payload',{payload:fields.join('\n')})}
}
async function response(url:string,init?:RequestInit){const r=await fetch(url,init),b=await r.json().catch(()=>null);if(!r.ok)throw Object.assign(new Error(b?.message??`Sync failed (${r.status})`),{status:r.status});return b?.data??b}
let active:Promise<boolean>|null=null
async function reconcile(){
  if(!desktop()||!navigator.onLine)return false
  try{
    const [config,status,identity]=await Promise.all([unwrapData<{server_url:string}>(await api.get('/sync/config')),unwrapData<{certificate?:Certificate}>(await api.get('/license/status')),(async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<Identity|null>('load_license_device_identity')})()])
    const c=status.certificate;if(!c||!identity||c.installation_id!==identity.installation_id)return false;const base=config.server_url.replace(/\/$/,'')
    const jobs=[
      {kind:'stock',outbox:'/sync/stock-movements/outbox',state:'/sync/stock-movements/state',push:'/api/desktop-sync/stock-movements/push',pull:'/api/desktop-sync/stock-movements/pull',apply:'/sync/stock-movements/apply',key:'movements'},
      {kind:'purchase',outbox:'/sync/purchases/outbox',state:'/sync/purchases/state',push:'/api/desktop-sync/purchases/push',pull:'/api/desktop-sync/purchases/pull',apply:'/sync/purchases/apply',key:'purchases'},
      {kind:'orders',outbox:'/sync/orders/outbox',state:'/sync/orders/state',push:'/api/desktop-sync/orders/push',pull:'/api/desktop-sync/orders/pull',apply:'/sync/orders/apply',key:'orders'},
      {kind:'sales',outbox:'/sync/sales/outbox',state:'/sync/sales/state',push:'/api/desktop-sync/sales/push',pull:'/api/desktop-sync/sales/pull',apply:'/sync/sales/apply',key:'sales'},
    ] as const
    let completed=false
    for(const job of jobs){
      try{
        const outbox=await unwrapData<any[]>(await api.get(job.outbox));
        for(const mutation of outbox){await response(`${base}${job.push}`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({device:await proof('push',job.kind,c,identity,mutation),mutation}),signal:AbortSignal.timeout(8000)});await api.post(`/sync/outbox/${mutation.client_id}/ack`)}
        const state=await unwrapData<{cursor:string|null}>(await api.get(job.state));const d=await proof('pull',job.kind,c,identity);const pulled=await response(`${base}${job.pull}?${new URLSearchParams({...d,cursor:state.cursor??''})}`,{signal:AbortSignal.timeout(8000)});await api.post(job.apply,pulled);completed=true
      }catch{continue}
    }
    return completed
  }catch{return false}
}
export function reconcileDesktopTransactional(){if(active)return active;active=reconcile().finally(()=>{active=null});return active}

