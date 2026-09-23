import api,{unwrapData} from '../api/client'
import {reconcileCashRegister} from './desktopCashRegisterCore'
import type {CashCertificate as Certificate,CashDeviceProof as Device,CashIdentity as Identity,CashMutationPayload,CashMutation} from './desktopCashRegisterCore'

const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const line=(value:unknown)=>value===undefined||value===null?'':String(value)
function payload(action:string,device:Omit<Device,'device_proof'>,mutation?:CashMutationPayload){return[
  'desktop-sync-v1',action,device.license_id,device.certificate_id,device.installation_id,device.device_public_key,device.nonce,device.requested_at,
  line(mutation?.client_id),line(mutation?.operation),line(mutation?.local_session_id),line(mutation?.server_session_id),line(mutation?.user_email?.toLowerCase()),line(mutation?.branch_code),line(mutation?.opening_cash),line(mutation?.opening_note),line(mutation?.opened_at),line(mutation?.actual_cash),line(mutation?.closing_note),line(mutation?.closed_at),
].join('\n')}
async function device(action:string,certificate:Certificate,identity:Identity,mutation?:CashMutationPayload):Promise<Device>{
  const unsigned={license_id:certificate.license_id,certificate_id:certificate.certificate_id,installation_id:identity.installation_id,device_public_key:identity.public_key,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()}
  const {invoke}=await import('@tauri-apps/api/core')
  return{...unsigned,device_proof:await invoke<string>('sign_license_device_payload',{payload:payload(action,unsigned,mutation)})}
}
export async function desktopCashRealtimeCredentials(){
  if(!desktop()||!navigator.onLine)return null
  const [config,status,identity]=await Promise.all([
    unwrapData<{server_url:string}>(await api.get('/sync/config')),
    unwrapData<{certificate?:Certificate}>(await api.get('/license/status')),
    (async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<Identity|null>('load_license_device_identity')})(),
  ])
  const certificate=status.certificate
  if(!certificate||!identity||certificate.installation_id!==identity.installation_id)return null
  const url=new URL('/api/desktop-sync/realtime',`${config.server_url.replace(/\/$/,'')}/`)
  url.protocol=url.protocol==='https:'?'wss:':'ws:'
  return{url:url.toString(),message:{type:'authenticate' as const,device:await device('realtime',certificate,identity)}}
}
async function response(url:string,init?:RequestInit){const value=await fetch(url,init);const body=await value.json().catch(()=>null);if(!value.ok){const error=Object.assign(new Error(body?.message??`Sync failed (${value.status})`),{status:value.status,body});throw error}return body?.data??body}

/** Best-effort reconciliation only. SQLite mutations always commit before this
 * runs, and failures deliberately leave the durable local outbox untouched. */
let activeReconciliation:Promise<boolean>|null=null
let reconciliationQueued=false

async function reconcile(){return reconcileCashRegister({
  available:()=>desktop()&&navigator.onLine,
  load:async()=>{
    const [config,status,identity,outbox,state]=await Promise.all([
      unwrapData<{server_url:string}>(await api.get('/sync/config')),
      unwrapData<{certificate?:Certificate}>(await api.get('/license/status')),
      (async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<Identity|null>('load_license_device_identity')})(),
      unwrapData<CashMutation[]>(await api.get('/sync/outbox')),
      unwrapData<{cursor:string|null}>(await api.get('/sync/cash-register/state')),
    ])
    return{config,status,identity,outbox,state}
  },
  sign:(action,certificate,identity,mutation)=>device(action,certificate,identity,mutation),
  push:(base,proof,mutation)=>response(`${base}/api/desktop-sync/cash-registers/push`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({device:proof,mutation}),signal:AbortSignal.timeout(8000)}),
  pull:(base,proof,cursor)=>{const query=new URLSearchParams({...proof,cursor:cursor??''});return response(`${base}/api/desktop-sync/cash-registers/pull?${query}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)})},
  localPost:async(path,body)=>{await api.post(path,body)},
  notify:()=>window.dispatchEvent(new Event('cash-register-changed')),
})}

/** This module-level lock survives component remounts.  Two overlapping pull
 * responses can otherwise arrive out of order and replay older state. */
export function reconcileDesktopCashRegister(){
  if(activeReconciliation){reconciliationQueued=true;return activeReconciliation}
  activeReconciliation=(async()=>{let result=false;do{reconciliationQueued=false;result=await reconcile()}while(reconciliationQueued);return result})().finally(()=>{activeReconciliation=null})
  return activeReconciliation
}
