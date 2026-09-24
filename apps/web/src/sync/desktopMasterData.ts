import api,{unwrapData} from '../api/client'
import {legacyMasterChanges,legacyMasterOutbox} from './masterDataOwnership'

type Certificate={license_id:string;certificate_id:string;installation_id:string}
type Identity={installation_id:string;public_key:string}
type Payload={client_id:string;entity_type:string;sync_id:string;operation:'upsert'|'delete';base_updated_at:string|null;data:Record<string,unknown>|null}
type Mutation={client_id:string;payload:Payload}
type Device={license_id:string;certificate_id:string;installation_id:string;device_public_key:string;nonce:string;requested_at:string;device_proof:string}
const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value)
function signedPayload(action:string,device:Omit<Device,'device_proof'>,mutation?:Payload){return['desktop-master-sync-v1',action,device.license_id,device.certificate_id,device.installation_id,device.device_public_key,device.nonce,device.requested_at,mutation?.client_id??'',mutation?.entity_type??'',mutation?.sync_id??'',mutation?.operation??'',mutation?.base_updated_at??'',mutation?stable(mutation.data):''].join('\n')}
async function proof(action:string,certificate:Certificate,identity:Identity,mutation?:Payload):Promise<Device>{const unsigned={license_id:certificate.license_id,certificate_id:certificate.certificate_id,installation_id:identity.installation_id,device_public_key:identity.public_key,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()};const {invoke}=await import('@tauri-apps/api/core');return{...unsigned,device_proof:await invoke<string>('sign_license_device_payload',{payload:signedPayload(action,unsigned,mutation)})}}
async function response(url:string,init?:RequestInit){const value=await fetch(url,init),body=await value.json().catch(()=>null);if(!value.ok)throw Object.assign(new Error(body?.message??`Sync failed (${value.status})`),{status:value.status,body});return body?.data??body}
let active:Promise<boolean>|null=null
async function reconcile(){
  if(!desktop()||!navigator.onLine)return false
  try{
    const [config,status,identity,outbox,state]=await Promise.all([
      unwrapData<{server_url:string}>(await api.get('/sync/config')),
      unwrapData<{certificate?:Certificate}>(await api.get('/license/status')),
      (async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<Identity|null>('load_license_device_identity')})(),
      unwrapData<Mutation[]>(await api.get('/sync/master-data/outbox')),
      unwrapData<{cursor:string|null}>(await api.get('/sync/master-data/state')),
    ])
    const certificate=status.certificate;if(!certificate||!identity||certificate.installation_id!==identity.installation_id)return false
    const base=config.server_url.replace(/\/$/,'')
    for(const queued of legacyMasterOutbox(outbox)){
      try{await response(`${base}/api/desktop-sync/master-data/push`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({device:await proof('push',certificate,identity,queued.payload),mutation:queued.payload}),signal:AbortSignal.timeout(8000)});await api.post(`/sync/outbox/${queued.client_id}/ack`)}
      catch(error){if((error as {status?:number}).status===409)await api.post('/sync/master-data/conflict',{client_id:queued.client_id});else return false}
    }
    const device=await proof('pull',certificate,identity),query=new URLSearchParams({...device,cursor:state.cursor??''})
    const pulled=await response(`${base}/api/desktop-sync/master-data/pull?${query}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)})
    await api.post('/sync/master-data/apply',{changes:legacyMasterChanges(pulled.changes??[]),cursor:pulled.cursor??state.cursor})
    window.dispatchEvent(new Event('master-data-synced'));return true
  }catch{return false}
}
export function reconcileDesktopMasterData(){if(active)return active;active=reconcile().finally(()=>{active=null});return active}
