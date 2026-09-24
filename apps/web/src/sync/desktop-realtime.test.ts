import assert from 'node:assert/strict'
import test from 'node:test'
import {createDesktopRealtimeClient} from './desktopRealtimeCore.ts'
import type {DesktopRealtimeDependencies,DesktopRealtimeSocket} from './desktopRealtimeCore.ts'

class FakeSocket implements DesktopRealtimeSocket{
  sent:string[]=[];closed=false
  private openListeners:(()=>void)[]=[]
  private messageListeners:((data:string)=>void)[]=[]
  private closeListeners:(()=>void)[]=[]
  private errorListeners:(()=>void)[]=[]
  onOpen(listener:()=>void){this.openListeners.push(listener)}
  onMessage(listener:(data:string)=>void){this.messageListeners.push(listener)}
  onClose(listener:()=>void){this.closeListeners.push(listener)}
  onError(listener:()=>void){this.errorListeners.push(listener)}
  send(data:string){this.sent.push(data)}
  close(){if(this.closed)return;this.closed=true;for(const listener of this.closeListeners)listener()}
  open(){for(const listener of this.openListeners)listener()}
  message(value:unknown){const data=typeof value==='string'?value:JSON.stringify(value);for(const listener of this.messageListeners)listener(data)}
  error(){for(const listener of this.errorListeners)listener()}
}

const tick=async()=>{await Promise.resolve();await Promise.resolve()}

function harness(reconcileCash:()=>Promise<boolean>=async()=>true,reconcileMaster:()=>Promise<boolean>=async()=>true){
  let online=true,onlineListener=()=>{},offlineListener=()=>{}
  const sockets:FakeSocket[]=[],timers:{callback:()=>void;delay:number;cancelled:boolean}[]=[],logs:string[]=[]
  const dependencies:DesktopRealtimeDependencies={
    available:()=>online,
    credentials:async()=>({url:'wss://hosted.test/api/desktop-sync/realtime',message:{type:'authenticate',device:{proof:'signed'}}}),
    createSocket:()=>{const socket=new FakeSocket();sockets.push(socket);return socket},
    reconcileCash,
    reconcileMaster,
    listenConnectivity:(onOnline,onOffline)=>{onlineListener=onOnline;offlineListener=onOffline;return()=>{onlineListener=()=>{};offlineListener=()=>{}}},
    schedule:(callback,delay)=>{const timer={callback,delay,cancelled:false};timers.push(timer);return timer},
    cancel:value=>{(value as {cancelled:boolean}).cancelled=true},
    random:()=>0.5,
    log:message=>logs.push(message),
  }
  return{
    dependencies,sockets,timers,logs,
    setOnline(value:boolean){online=value;if(value)onlineListener();else offlineListener()},
    runLatestTimer(){const timer=timers.at(-1);assert.ok(timer);assert.equal(timer.cancelled,false);timer.callback()},
  }
}

test('cash_register_changed triggers reconciliation after authenticated ready',async()=>{
  let reconciliations=0
  const h=harness(async()=>{reconciliations++;return true}),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open()
  assert.equal(JSON.parse(h.sockets[0]!.sent[0]!).type,'authenticate')
  h.sockets[0]!.message({type:'ready'});await tick()
  h.sockets[0]!.message({type:'cash_register_changed',event_id:'event-1',occurred_at:new Date().toISOString()});await tick()
  assert.equal(reconciliations,2)
  client.stop()
})

test('repeated cash events coalesce without concurrent reconciliation',async()=>{
  let calls=0,active=0,maxActive=0
  const releases:(()=>void)[]=[]
  const h=harness(()=>new Promise<boolean>(resolve=>{calls++;active++;maxActive=Math.max(maxActive,active);releases.push(()=>{active--;resolve(true)})})),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.sockets[0]!.message({type:'ready'});await tick()
  h.sockets[0]!.message({type:'cash_register_changed'});h.sockets[0]!.message({type:'cash_register_changed'});h.sockets[0]!.message({type:'cash_register_changed'})
  assert.equal(calls,1);releases.shift()!();await tick();assert.equal(calls,2);releases.shift()!();await tick()
  assert.equal(maxActive,1);assert.equal(calls,2)
  client.stop()
})

test('sync_required master events invoke and coalesce Universal V1 reconciliation',async()=>{
  let calls=0,active=0,maxActive=0
  const releases:(()=>void)[]=[]
  const h=harness(async()=>true,()=>new Promise<boolean>(resolve=>{calls++;active++;maxActive=Math.max(maxActive,active);releases.push(()=>{active--;resolve(true)})})),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.sockets[0]!.message({type:'ready'});await tick()
  h.sockets[0]!.message({type:'sync_required',scopes:['master']});h.sockets[0]!.message({type:'sync_required',scopes:['master']});h.sockets[0]!.message({type:'sync_required',scopes:['master']})
  assert.equal(calls,1);releases.shift()!();await tick();assert.equal(calls,2);releases.shift()!();await tick()
  assert.equal(maxActive,1);assert.equal(calls,2)
  client.stop()
})

test('reconnect authenticates again and triggers one catch-up reconciliation',async()=>{
  let reconciliations=0
  const h=harness(async()=>{reconciliations++;return true}),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.sockets[0]!.message({type:'ready'});await tick()
  h.sockets[0]!.close();assert.equal(h.timers.at(-1)?.delay,1_000)
  h.runLatestTimer();await tick();h.sockets[1]!.open();h.sockets[1]!.message({type:'ready'});await tick()
  assert.equal(reconciliations,2)
  client.stop()
})

test('socket failure remains non-blocking and schedules bounded retry',async()=>{
  const h=harness(),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.sockets[0]!.error()
  assert.equal(h.sockets[0]!.closed,true);assert.equal(h.timers.at(-1)?.delay,1_000)
  client.stop()
})

test('WebSocket failure does not disable ordinary HTTP reconciliation',async()=>{
  let reconciliations=0
  const reconcile=async()=>{reconciliations++;return true},h=harness(reconcile),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.error();await reconcile()
  assert.equal(reconciliations,1)
  client.stop()
})

test('offline to online recovery connects and performs initial reconciliation',async()=>{
  let reconciliations=0
  const h=harness(async()=>{reconciliations++;return true});h.setOnline(false)
  const client=createDesktopRealtimeClient(h.dependencies);client.start();await tick();assert.equal(h.sockets.length,0)
  h.setOnline(true);await tick();h.sockets[0]!.open();h.sockets[0]!.message({type:'ready'});await tick()
  assert.equal(reconciliations,1)
  client.stop()
})

test('unknown and malformed events are ignored safely',async()=>{
  let reconciliations=0
  const h=harness(async()=>{reconciliations++;return true}),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.sockets[0]!.message({type:'ready'});await tick()
  h.sockets[0]!.message({type:'unknown'});h.sockets[0]!.message('{not-json');await tick()
  assert.equal(reconciliations,1)
  client.stop()
})

test('offline disconnect and service teardown do not schedule reconnect loops',async()=>{
  const h=harness(),client=createDesktopRealtimeClient(h.dependencies)
  client.start();await tick();h.sockets[0]!.open();h.setOnline(false);assert.equal(h.sockets[0]!.closed,true);assert.equal(h.timers.length,0)
  client.stop();h.setOnline(true);await tick();assert.equal(h.sockets.length,1)
})
