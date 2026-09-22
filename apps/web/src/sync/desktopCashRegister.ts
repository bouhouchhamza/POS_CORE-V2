import api,{unwrapData} from '../api/client'

type Certificate={license_id:string;certificate_id:string;installation_id:string}
type Identity={installation_id:string;public_key:string}
type Mutation={client_id:string;payload:{client_id:string;operation:'open'|'close';local_session_id:number;server_session_id?:number|null;user_email:string;branch_code:string|null;opening_cash?:number;opening_note?:string|null;opened_at?:string;actual_cash?:number;closing_note?:string|null;closed_at?:string}}
type Device={license_id:string;certificate_id:string;installation_id:string;device_public_key:string;nonce:string;requested_at:string;device_proof:string}

const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const line=(value:unknown)=>value===undefined||value===null?'':String(value)
function payload(action:string,device:Omit<Device,'device_proof'>,mutation?:Mutation['payload']){return[
  'desktop-sync-v1',action,device.license_id,device.certificate_id,device.installation_id,device.device_public_key,device.nonce,device.requested_at,
  line(mutation?.client_id),line(mutation?.operation),line(mutation?.local_session_id),line(mutation?.server_session_id),line(mutation?.user_email?.toLowerCase()),line(mutation?.branch_code),line(mutation?.opening_cash),line(mutation?.opening_note),line(mutation?.opened_at),line(mutation?.actual_cash),line(mutation?.closing_note),line(mutation?.closed_at),
].join('\n')}
async function device(action:string,certificate:Certificate,identity:Identity,mutation?:Mutation['payload']):Promise<Device>{
  const unsigned={license_id:certificate.license_id,certificate_id:certificate.certificate_id,installation_id:identity.installation_id,device_public_key:identity.public_key,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()}
  const {invoke}=await import('@tauri-apps/api/core')
  return{...unsigned,device_proof:await invoke<string>('sign_license_device_payload',{payload:payload(action,unsigned,mutation)})}
}
async function response(url:string,init?:RequestInit){const value=await fetch(url,init);const body=await value.json().catch(()=>null);if(!value.ok){const error=Object.assign(new Error(body?.message??`Sync failed (${value.status})`),{status:value.status,body});throw error}return body?.data??body}

/** Best-effort reconciliation only. SQLite mutations always commit before this
 * runs, and failures deliberately leave the durable local outbox untouched. */
export async function reconcileDesktopCashRegister(){
  if(!desktop()||!navigator.onLine)return false
  try{
    const [config,status,identity,outbox,state]=await Promise.all([
      unwrapData<{server_url:string}>(await api.get('/sync/config')),
      unwrapData<{certificate?:Certificate}>(await api.get('/license/status')),
      (async()=>{const {invoke}=await import('@tauri-apps/api/core');return invoke<Identity|null>('load_license_device_identity')})(),
      unwrapData<Mutation[]>(await api.get('/sync/outbox')),
      unwrapData<{cursor:string|null}>(await api.get('/sync/cash-register/state')),
    ])
    const certificate=status.certificate
    if(!certificate||!identity||certificate.installation_id!==identity.installation_id)return false
    const base=config.server_url.replace(/\/$/,'')
    const cashMutations=outbox.filter(item=>item.payload?.operation==='open'||item.payload?.operation==='close')
    for(const queued of cashMutations){
      const proof=await device('push',certificate,identity,queued.payload)
      try{
        const result=await response(`${base}/api/desktop-sync/cash-registers/push`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({device:proof,mutation:queued.payload}),signal:AbortSignal.timeout(8000)})
        if(result?.session?.id){
          await api.post('/sync/cash-register/ack',{client_id:queued.client_id,local_session_id:queued.payload.local_session_id,server_session_id:result.session.id})
          // A register can be opened and closed while offline.  The close was
          // captured before the hosted id existed, so update this in-memory
          // batch as well as the durable outbox record written by the ACK.
          for(const following of cashMutations)if(following.payload.operation==='close'&&following.payload.local_session_id===queued.payload.local_session_id&&!following.payload.server_session_id)following.payload.server_session_id=result.session.id
        }
      }catch(error){
        if((error as {status?:number;body?:{code?:string}}).status===409&&(error as {body?:{code?:string}}).body?.code==='CASH_REGISTER_ALREADY_OPEN')await api.post('/sync/cash-register/conflict',{client_id:queued.client_id,local_session_id:queued.payload.local_session_id})
        else return false
      }
    }
    const proof=await device('pull',certificate,identity)
    const query=new URLSearchParams({...proof,cursor:state.cursor??''})
    const pulled=await response(`${base}/api/desktop-sync/cash-registers/pull?${query}`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)})
    await api.post('/sync/cash-register/apply',{sessions:pulled.sessions??[],cursor:pulled.cursor??state.cursor})
    window.dispatchEvent(new Event('cash-register-changed'))
    return true
  }catch{return false}
}
