import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import type {WebSocket} from 'ws'
import {publishCashRegisterChanged,publishSyncRequired,registerDesktopRealtime} from './desktop-realtime.js'

type TestDevice={state?:'active'|'invalid'|'revoked'|'inactive';channel?:string}
const authentication=(device:TestDevice={})=>JSON.stringify({type:'authenticate',device})
const message=(socket:WebSocket)=>new Promise<any>(resolve=>socket.once('message',raw=>resolve(JSON.parse(raw.toString()))))
const closed=(socket:WebSocket)=>new Promise<{code:number;reason:string}>(resolve=>socket.once('close',(code,reason)=>resolve({code,reason:reason.toString()})))
async function disconnect(socket:WebSocket){if(socket.readyState===3)return;const done=closed(socket);socket.close();await done}

async function fixture(){
  const app=Fastify({logger:false})
  await app.register(websocket,{options:{maxPayload:16*1024,perMessageDeflate:false}})
  registerDesktopRealtime(app,{authenticate:async raw=>{
    const device=raw as TestDevice
    if(device.state==='invalid')throw Object.assign(new Error('Invalid proof'),{code:'DEVICE_PROOF_INVALID'})
    if(device.state==='revoked')throw Object.assign(new Error('Revoked'),{code:'DEVICE_REVOKED'})
    if(device.state==='inactive')throw Object.assign(new Error('Inactive licence'),{code:'LICENSE_INACTIVE'})
    return{channelKey:device.channel??'business-a'}
  },authenticationTimeoutMs:50,heartbeatIntervalMs:20})
  await app.ready()
  return app
}

test('authorized Desktop establishes a realtime subscription',async()=>{
  const app=await fixture(),socket=await app.injectWS('/api/desktop-sync/realtime')
  try{const ready=message(socket);socket.send(authentication());assert.deepEqual(await ready,{type:'ready'})}
  finally{await disconnect(socket);await app.close()}
})

test('an unauthenticated socket is closed after the bounded authentication timeout',async()=>{
  const app=await fixture(),socket=await app.injectWS('/api/desktop-sync/realtime')
  try{assert.deepEqual(await closed(socket),{code:1008,reason:'REALTIME_AUTH_TIMEOUT'})}
  finally{await app.close()}
})

test('a dead authenticated socket is terminated when it stops answering heartbeat pings',async()=>{
  const app=await fixture(),socket=await app.injectWS('/api/desktop-sync/realtime')
  try{
    const ready=message(socket);socket.send(authentication());await ready
    const disconnected=closed(socket)
    const transport=(socket as unknown as {_socket:{pause:()=>void;resume:()=>void}})._socket
    transport.pause()
    await new Promise(resolve=>setTimeout(resolve,70))
    transport.resume()
    assert.equal((await disconnected).code,1006)
  }finally{await app.close()}
})

test('invalid device, revoked device, and inactive licence are rejected',async t=>{
  for(const denied of [
    {state:'invalid' as const,code:'DEVICE_PROOF_INVALID'},
    {state:'revoked' as const,code:'DEVICE_REVOKED'},
    {state:'inactive' as const,code:'LICENSE_INACTIVE'},
  ])await t.test(denied.state,async()=>{
    const app=await fixture(),socket=await app.injectWS('/api/desktop-sync/realtime')
    try{const close=closed(socket);socket.send(authentication({state:denied.state}));assert.deepEqual(await close,{code:1008,reason:denied.code})}
    finally{await app.close()}
  })
})

test('a Desktop receives only its server-authorized business channel',async()=>{
  const app=await fixture(),a=await app.injectWS('/api/desktop-sync/realtime'),b=await app.injectWS('/api/desktop-sync/realtime')
  try{
    let ready=message(a);a.send(authentication({channel:'business-a'}));await ready
    ready=message(b);b.send(authentication({channel:'business-b'}));await ready
    let bReceived=false;b.once('message',()=>{bReceived=true})
    const eventMessage=message(a),published=publishCashRegisterChanged('business-a'),received=await eventMessage
    await new Promise(resolve=>setTimeout(resolve,10))
    assert.deepEqual(received,published);assert.equal(bReceived,false)
  }finally{await Promise.all([disconnect(a),disconnect(b)]);await app.close()}
})

test('sync_required contains only a master invalidation and stays inside its authorized channel',async()=>{
  const app=await fixture(),a=await app.injectWS('/api/desktop-sync/realtime'),b=await app.injectWS('/api/desktop-sync/realtime')
  try{
    let ready=message(a);a.send(authentication({channel:'business-a'}));await ready
    ready=message(b);b.send(authentication({channel:'business-b'}));await ready
    let bReceived=false;b.once('message',()=>{bReceived=true})
    const received=message(a),published=publishSyncRequired('business-a'),event=await received
    await new Promise(resolve=>setTimeout(resolve,10))
    assert.deepEqual(event,published);assert.equal(event.type,'sync_required');if(event.type==='sync_required')assert.deepEqual(event.scopes,['master']);assert.equal(bReceived,false);assert.equal('data' in event,false)
  }finally{await Promise.all([disconnect(a),disconnect(b)]);await app.close()}
})

test('client-supplied business subscription and malformed authentication are rejected',async t=>{
  for(const payload of [
    JSON.stringify({type:'authenticate',device:{},business_id:999}),
    '{not-json',
  ])await t.test(payload.startsWith('{not')?'malformed':'client business',async()=>{
    const app=await fixture(),socket=await app.injectWS('/api/desktop-sync/realtime')
    try{const close=closed(socket);socket.send(payload);assert.equal((await close).code,1008)}
    finally{await app.close()}
  })
})
