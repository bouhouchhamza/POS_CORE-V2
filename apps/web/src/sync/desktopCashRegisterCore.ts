export type CashCertificate={license_id:string;certificate_id:string;installation_id:string}
export type CashIdentity={installation_id:string;public_key:string}
export type CashMutationPayload={client_id:string;operation:'open'|'close';local_session_id:number;server_session_id?:number|null;user_email:string;branch_code:string|null;opening_cash?:number;opening_note?:string|null;opened_at?:string;actual_cash?:number;closing_note?:string|null;closed_at?:string}
export type CashMutation={client_id:string;payload:CashMutationPayload}
export type CashDeviceProof={license_id:string;certificate_id:string;installation_id:string;device_public_key:string;nonce:string;requested_at:string;device_proof:string}

type LoadedCashState={
  config:{server_url:string}
  status:{certificate?:CashCertificate}
  identity:CashIdentity|null
  outbox:CashMutation[]
  state:{cursor:string|null}
}

export type CashReconciliationDependencies={
  available:()=>boolean
  load:()=>Promise<LoadedCashState>
  sign:(action:'push'|'pull',certificate:CashCertificate,identity:CashIdentity,mutation?:CashMutationPayload)=>Promise<CashDeviceProof>
  push:(serverUrl:string,proof:CashDeviceProof,mutation:CashMutationPayload)=>Promise<{session?:{id?:number}}>
  pull:(serverUrl:string,proof:CashDeviceProof,cursor:string|null)=>Promise<{sessions?:unknown[];cursor?:string|null}>
  localPost:(path:string,body:unknown)=>Promise<unknown>
  notify:()=>void
}

type SyncError={status?:number;body?:{code?:string;data?:{code?:string;outcome?:string;session?:{id?:number}}}}

function errorCode(error:SyncError){return error.body?.code??error.body?.data?.code}
function isHostedOpenConflict(error:SyncError,mutation:CashMutationPayload){
  return mutation.operation==='open'&&error.status===409&&(
    errorCode(error)==='CASH_REGISTER_ALREADY_OPEN'||
    (error.body?.data?.outcome==='conflict'&&Number.isInteger(error.body.data.session?.id))
  )
}

function causallyOrdered(mutations:CashMutation[]){
  const groups=new Map<number,CashMutation[]>()
  for(const mutation of mutations){
    const group=groups.get(mutation.payload.local_session_id)??[]
    group.push(mutation)
    groups.set(mutation.payload.local_session_id,group)
  }
  return [...groups.values()].flatMap(group=>[
    ...group.filter(item=>item.payload.operation==='open'),
    ...group.filter(item=>item.payload.operation==='close'),
  ])
}

/** Reconciles durable local cash mutations before applying the authoritative
 * hosted view. Only known, locally-recorded 409 outcomes are recoverable. */
export async function reconcileCashRegister(dependencies:CashReconciliationDependencies){
  if(!dependencies.available())return false
  try{
    const {config,status,identity,outbox,state}=await dependencies.load()
    const certificate=status.certificate
    if(!certificate||!identity||certificate.installation_id!==identity.installation_id)return false
    const serverUrl=config.server_url.replace(/\/$/,'')
    const cashMutations=outbox.filter(item=>item.payload?.operation==='open'||item.payload?.operation==='close')
    const ordered=causallyOrdered(cashMutations)
    const quarantinedSessions=new Set<number>()

    for(const queued of ordered){
      const localSessionId=queued.payload.local_session_id
      if(quarantinedSessions.has(localSessionId))continue
      const proof=await dependencies.sign('push',certificate,identity,queued.payload)
      try{
        const result=await dependencies.push(serverUrl,proof,queued.payload)
        if(result?.session?.id){
          await dependencies.localPost('/sync/cash-register/ack',{client_id:queued.client_id,local_session_id:localSessionId,server_session_id:result.session.id})
          // An offline close is captured before the hosted open id exists.
          // Update both the durable outbox (above) and this loaded batch.
          for(const following of cashMutations)if(following.payload.operation==='close'&&following.payload.local_session_id===localSessionId&&!following.payload.server_session_id)following.payload.server_session_id=result.session.id
        }
      }catch(caught){
        const error=caught as SyncError
        if(isHostedOpenConflict(error,queued.payload)){
          await dependencies.localPost('/sync/cash-register/conflict',{client_id:queued.client_id,local_session_id:localSessionId})
          quarantinedSessions.add(localSessionId)
          continue
        }
        if(queued.payload.operation==='close'&&error.status===409&&errorCode(error)==='SYNC_OPEN_PENDING'){
          await dependencies.localPost('/sync/cash-register/defer',{client_id:queued.client_id,local_session_id:localSessionId})
          quarantinedSessions.add(localSessionId)
          continue
        }
        return false
      }
    }

    const proof=await dependencies.sign('pull',certificate,identity)
    const pulled=await dependencies.pull(serverUrl,proof,state.cursor)
    await dependencies.localPost('/sync/cash-register/apply-v2',{sessions:pulled.sessions??[],cursor:pulled.cursor??state.cursor})
    dependencies.notify()
    return true
  }catch{return false}
}
