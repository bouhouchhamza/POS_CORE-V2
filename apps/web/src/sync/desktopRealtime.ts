import {desktopCashRealtimeCredentials,reconcileDesktopCashRegister} from './desktopCashRegister'
import {createDesktopRealtimeClient} from './desktopRealtimeCore'

const desktop=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window
const developmentLog=(message:string)=>{if(import.meta.env.DEV)console.debug(`[CorePOS realtime] ${message}`)}

let client:ReturnType<typeof createDesktopRealtimeClient>|null=null
let consumers=0

function createClient(){return createDesktopRealtimeClient({
  available:()=>desktop()&&navigator.onLine,
  credentials:desktopCashRealtimeCredentials,
  createSocket:url=>{
    const socket=new WebSocket(url)
    return{
      onOpen:listener=>socket.addEventListener('open',listener),
      onMessage:listener=>socket.addEventListener('message',event=>listener(String(event.data))),
      onClose:listener=>socket.addEventListener('close',listener),
      onError:listener=>socket.addEventListener('error',listener),
      send:data=>socket.send(data),
      close:()=>socket.close(),
    }
  },
  reconcile:reconcileDesktopCashRegister,
  listenConnectivity:(online,offline)=>{window.addEventListener('online',online);window.addEventListener('offline',offline);return()=>{window.removeEventListener('online',online);window.removeEventListener('offline',offline)}},
  schedule:(callback,delay)=>window.setTimeout(callback,delay),
  cancel:timer=>window.clearTimeout(timer as number),
  random:Math.random,
  log:developmentLog,
})}

export function startDesktopRealtime(){
  if(!desktop())return()=>{}
  consumers++
  client??=createClient()
  client.start()
  let released=false
  return()=>{
    if(released)return
    released=true;consumers--
    queueMicrotask(()=>{if(consumers===0){client?.stop();client=null}})
  }
}
