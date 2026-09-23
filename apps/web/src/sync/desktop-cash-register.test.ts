import assert from 'node:assert/strict'
import test from 'node:test'
import {reconcileCashRegister} from './desktopCashRegisterCore.ts'
import type {CashMutation,CashMutationPayload,CashReconciliationDependencies} from './desktopCashRegisterCore.ts'

const certificate={license_id:'license-1',certificate_id:'certificate-1',installation_id:'installation-1'}
const identity={installation_id:'installation-1',public_key:'public-key'}
const proof={...certificate,device_public_key:identity.public_key,nonce:'nonce',requested_at:'2026-09-23T10:00:00.000Z',device_proof:'signature'}

function mutation(operation:'open'|'close',localSessionId:number,clientId:string):CashMutation{
  return{client_id:clientId,payload:{client_id:clientId,operation,local_session_id:localSessionId,user_email:'owner@test.invalid',branch_code:'MAIN'}}
}

function syncError(status:number,body:object){return Object.assign(new Error('sync failed'),{status,body})}

function harness(outbox:CashMutation[],push:CashReconciliationDependencies['push'],sessions:unknown[]=[]){
  const calls={push:[] as CashMutationPayload[],local:[] as {path:string;body:any}[],pull:0,notified:0}
  const dependencies:CashReconciliationDependencies={
    available:()=>true,
    load:async()=>({config:{server_url:'https://hosted.test/'},status:{certificate},identity,outbox,state:{cursor:'cursor-1'}}),
    sign:async()=>proof,
    push:async(serverUrl,device,payload)=>{calls.push.push({...payload});return push(serverUrl,device,payload)},
    pull:async()=>{calls.pull++;return{sessions,cursor:'cursor-2'}},
    localPost:async(path,body)=>{calls.local.push({path,body})},
    notify:()=>{calls.notified++},
  }
  return{calls,dependencies}
}

test('stale close without a hosted session id is quarantined and does not block pull',async()=>{
  const close=mutation('close',7,'00000000-0000-4000-8000-000000000007')
  const {calls,dependencies}=harness([close],async()=>{throw syncError(409,{code:'SYNC_OPEN_PENDING'})})
  assert.equal(await reconcileCashRegister(dependencies),true)
  assert.equal(calls.pull,1)
  assert.deepEqual(calls.local.map(call=>call.path),['/sync/cash-register/defer','/sync/cash-register/apply-v2'])
})

test('an offline open is pushed before its dependent close and supplies the hosted id',async()=>{
  const close=mutation('close',8,'00000000-0000-4000-8000-000000000082')
  const open=mutation('open',8,'00000000-0000-4000-8000-000000000081')
  const {calls,dependencies}=harness([close,open],async(_serverUrl,_device,payload)=>({session:{id:payload.operation==='open'?808:808}}))
  assert.equal(await reconcileCashRegister(dependencies),true)
  assert.deepEqual(calls.push.map(item=>item.operation),['open','close'])
  assert.equal(calls.push[1]?.server_session_id,808)
  assert.equal(calls.pull,1)
})

test('the hosted open conflict response shape is recoverable and does not block pull',async()=>{
  const open=mutation('open',9,'00000000-0000-4000-8000-000000000091')
  const {calls,dependencies}=harness([open],async()=>{throw syncError(409,{data:{outcome:'conflict',session:{id:909}}})})
  assert.equal(await reconcileCashRegister(dependencies),true)
  assert.equal(calls.pull,1)
  assert.equal(calls.local[0]?.path,'/sync/cash-register/conflict')
})

test('a close dependent on a conflicted local open is not pushed as an orphan',async()=>{
  const open=mutation('open',10,'00000000-0000-4000-8000-000000000101')
  const close=mutation('close',10,'00000000-0000-4000-8000-000000000102')
  const {calls,dependencies}=harness([close,open],async(_serverUrl,_device,payload)=>{
    if(payload.operation==='open')throw syncError(409,{data:{outcome:'conflict',session:{id:1001}}})
    throw new Error('dependent close must not be sent')
  })
  assert.equal(await reconcileCashRegister(dependencies),true)
  assert.deepEqual(calls.push.map(item=>item.operation),['open'])
  assert.equal(calls.pull,1)
})

test('an authoritative hosted open is applied after a recoverable push conflict',async()=>{
  const open=mutation('open',11,'00000000-0000-4000-8000-000000000111')
  const remote={id:1101,status:'open',branch_code:'MAIN'}
  const {calls,dependencies}=harness([open],async()=>{throw syncError(409,{data:{outcome:'conflict',session:remote}})},[remote])
  assert.equal(await reconcileCashRegister(dependencies),true)
  const apply=calls.local.find(call=>call.path==='/sync/cash-register/apply-v2')
  assert.deepEqual(apply?.body,{sessions:[remote],cursor:'cursor-2'})
  assert.equal(calls.notified,1)
})

test('unknown, authentication, and licence failures remain fail-closed',async t=>{
  for(const failure of [
    {name:'unknown',error:syncError(500,{code:'UNEXPECTED'})},
    {name:'authentication',error:syncError(401,{code:'UNAUTHORIZED'})},
    {name:'licence',error:syncError(403,{code:'LICENSE_INACTIVE'})},
  ])await t.test(failure.name,async()=>{
    const open=mutation('open',12,'00000000-0000-4000-8000-000000000121')
    const {calls,dependencies}=harness([open],async()=>{throw failure.error})
    assert.equal(await reconcileCashRegister(dependencies),false)
    assert.equal(calls.pull,0)
    assert.equal(calls.local.length,0)
  })
})
