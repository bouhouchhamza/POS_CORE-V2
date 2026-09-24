import api,{unwrapData} from '../api/client'

const pilot=new Set(['categories','units','customers'])
const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value)
type Device={license_id:string;certificate_id:string;installation_id:string;device_public_key:string;nonce:string;requested_at:string;device_proof:string}
type Mutation={client_id:string;entity_type:string;sync_id:string;operation:'upsert'|'delete';base_updated_at:string|null;data:Record<string,unknown>|null}
type Result={client_id:string;status:'acked'|'conflict'|'retry';code?:string}
let active:Promise<boolean>|null=null

async function reconcile(){
  if(!desktop()||!navigator.onLine)return false
  try{
    const [config,status,identity,outbox,state]=await Promise.all([
      unwrapData<{server_url:string}>(await api.get('/sync/config')),
      unwrapData<{certificate?:{license_id:string;certificate_id:string;installation_id:string}}>(await api.get('/license/status')),
      (async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<{installation_id:string;public_key:string}|null>('load_license_device_identity')})(),
      unwrapData<Mutation[]>(await api.get('/sync/v1/outbox')),
      unwrapData<{cursor:string|null}>(await api.get('/sync/v1/state')),
    ])
    const certificate=status.certificate
    if(!certificate||!identity||certificate.installation_id!==identity.installation_id)return false
    const proof=async(action:string,mutations:Mutation[]=[]):Promise<Device>=>{
      const unsigned={license_id:certificate.license_id,certificate_id:certificate.certificate_id,installation_id:identity.installation_id,device_public_key:identity.public_key,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()}
      const {invoke}=await import('@tauri-apps/api/core')
      const payload=['desktop-universal-sync-v1',action,unsigned.license_id,unsigned.certificate_id,unsigned.installation_id,unsigned.device_public_key,unsigned.nonce,unsigned.requested_at,stable(mutations)].join('\n')
      return{...unsigned,device_proof:await invoke<string>('sign_license_device_payload',{payload})}
    }
    const base=config.server_url.replace(/\/$/,'')
    const mutations=outbox.filter(mutation=>pilot.has(mutation.entity_type))
    if(mutations.length){
      const response=await fetch(`${base}/api/desktop-sync/v1/push`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device:await proof('push',mutations),mutations})})
      if(!response.ok){await Promise.all(mutations.map(mutation=>api.post(`/sync/v1/outbox/${mutation.client_id}/retry`,{error:`HOSTED_HTTP_${response.status}`})));return false}
      for(const result of ((await response.json()).data?.results??[]) as Result[]){
        if(result.status==='acked')await api.post(`/sync/outbox/${result.client_id}/ack`)
        else if(result.status==='conflict')await api.post(`/sync/v1/outbox/${result.client_id}/conflict`)
        else await api.post(`/sync/v1/outbox/${result.client_id}/retry`,{error:result.code??'TEMPORARY_FAILURE'})
      }
    }
    let cursor=state.cursor
    for(;;){
      const device=await proof('pull')
      const response=await fetch(`${base}/api/desktop-sync/v1/pull?${new URLSearchParams({...device,cursor:cursor??''})}`)
      if(!response.ok)return false
      const pulled=(await response.json()).data as {changes:unknown[];cursor:string|null}
      await api.post('/sync/v1/apply',pulled)
      if(pulled.changes.length<500)break
      cursor=pulled.cursor
    }
    window.dispatchEvent(new Event('master-data-synced'))
    return true
  }catch{return false}
}

export function reconcileDesktopUniversalV1(){if(active)return active;active=reconcile().finally(()=>{active=null});return active}
