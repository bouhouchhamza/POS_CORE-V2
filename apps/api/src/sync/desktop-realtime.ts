import crypto from 'node:crypto'
import type {FastifyInstance} from 'fastify'
import type {WebSocket} from 'ws'
import {z} from 'zod'

export type DesktopRealtimeEvent={type:'cash_register_changed';event_id:string;occurred_at:string}
type RealtimeAuthorization={channelKey:string}
type RealtimeOptions={authenticate:(device:unknown)=>Promise<RealtimeAuthorization>;authenticationTimeoutMs?:number;heartbeatIntervalMs?:number}

const authenticationMessage=z.object({type:z.literal('authenticate'),device:z.unknown()}).strict()
const subscribers=new Map<string,Set<WebSocket>>()

function remove(channelKey:string,socket:WebSocket){
  const channel=subscribers.get(channelKey)
  if(!channel)return
  channel.delete(socket)
  if(!channel.size)subscribers.delete(channelKey)
}

function closeReason(error:unknown){
  const code=(error as {code?:unknown})?.code
  return typeof code==='string'&&code.length<=100?code:'REALTIME_AUTH_FAILED'
}

export function publishCashRegisterChanged(channelKey:string):DesktopRealtimeEvent{
  const event:DesktopRealtimeEvent={type:'cash_register_changed',event_id:crypto.randomUUID(),occurred_at:new Date().toISOString()}
  const serialized=JSON.stringify(event)
  for(const socket of subscribers.get(channelKey)??[]){
    try{
      if(socket.readyState===1)socket.send(serialized,error=>{if(error)socket.terminate()})
      else remove(channelKey,socket)
    }catch{socket.terminate();remove(channelKey,socket)}
  }
  return event
}

export function registerDesktopRealtime(app:FastifyInstance,{authenticate,authenticationTimeoutMs=8_000,heartbeatIntervalMs=30_000}:RealtimeOptions){
  app.get('/api/desktop-sync/realtime',{websocket:true},(socket,request)=>{
    let channelKey:string|null=null
    let heartbeat:ReturnType<typeof setInterval>|null=null
    let alive=true
    let closed=false
    const timeout=setTimeout(()=>socket.close(1008,'REALTIME_AUTH_TIMEOUT'),authenticationTimeoutMs)
    socket.once('message',async raw=>{
      try{
        const message=authenticationMessage.parse(JSON.parse(raw.toString()))
        const authorization=await authenticate(message.device)
        if(closed||socket.readyState!==1)return
        channelKey=authorization.channelKey
        const channel=subscribers.get(channelKey)??new Set<WebSocket>()
        channel.add(socket)
        subscribers.set(channelKey,channel)
        clearTimeout(timeout)
        socket.on('pong',()=>{alive=true})
        heartbeat=setInterval(()=>{
          if(socket.readyState!==1){socket.terminate();return}
          if(!alive){socket.terminate();return}
          alive=false
          try{socket.ping()}catch{socket.terminate()}
        },heartbeatIntervalMs)
        socket.send(JSON.stringify({type:'ready'}))
      }catch(error){
        clearTimeout(timeout)
        if(channelKey)remove(channelKey,socket)
        const code=closeReason(error)
        request.log.warn({code},'Desktop realtime authentication rejected')
        if(socket.readyState===1)socket.close(1008,code)
      }
    })
    socket.once('error',()=>socket.terminate())
    socket.once('close',()=>{
      closed=true
      clearTimeout(timeout)
      if(heartbeat)clearInterval(heartbeat)
      if(channelKey)remove(channelKey,socket)
    })
  })
}
