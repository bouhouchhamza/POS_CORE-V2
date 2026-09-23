export type DesktopRealtimeSocket={
  onOpen:(listener:()=>void)=>void
  onMessage:(listener:(data:string)=>void)=>void
  onClose:(listener:()=>void)=>void
  onError:(listener:()=>void)=>void
  send:(data:string)=>void
  close:()=>void
}

export type DesktopRealtimeDependencies={
  available:()=>boolean
  credentials:()=>Promise<{url:string;message:unknown}|null>
  createSocket:(url:string)=>DesktopRealtimeSocket
  reconcile:()=>Promise<boolean>
  listenConnectivity:(online:()=>void,offline:()=>void)=>()=>void
  schedule:(callback:()=>void,delayMs:number)=>unknown
  cancel:(timer:unknown)=>void
  random:()=>number
  log:(message:string)=>void
}

export function createDesktopRealtimeClient(dependencies:DesktopRealtimeDependencies){
  let stopped=true,connecting=false,socket:DesktopRealtimeSocket|null=null,reconnectTimer:unknown=null,attempt=0,generation=0
  let reconciling=false,reconcileAgain=false,removeConnectivity:(()=>void)|null=null

  async function triggerReconciliation(){
    if(reconciling){reconcileAgain=true;return}
    reconciling=true
    try{
      do{
        reconcileAgain=false
        dependencies.log('reconciliation triggered')
        await dependencies.reconcile().catch(()=>false)
      }while(reconcileAgain&&!stopped)
    }finally{reconciling=false}
  }

  function clearReconnect(){if(reconnectTimer!==null){dependencies.cancel(reconnectTimer);reconnectTimer=null}}
  function scheduleReconnect(){
    if(stopped||socket||!dependencies.available()||reconnectTimer!==null)return
    const base=Math.min(1_000*2**attempt,30_000),delay=Math.round(base*(0.8+dependencies.random()*0.4))
    attempt++
    dependencies.log(`realtime reconnect scheduled (${delay}ms)`)
    reconnectTimer=dependencies.schedule(()=>{reconnectTimer=null;void connect()},delay)
  }

  async function connect(){
    if(stopped||connecting||socket||!dependencies.available())return
    connecting=true
    const currentGeneration=generation
    try{
      const credentials=await dependencies.credentials()
      if(stopped||currentGeneration!==generation||!credentials){scheduleReconnect();return}
      const current=dependencies.createSocket(credentials.url)
      socket=current
      let authenticated=false
      current.onOpen(()=>{try{current.send(JSON.stringify(credentials.message))}catch{current.close()}})
      current.onMessage(data=>{
        let event:unknown
        try{event=JSON.parse(data)}catch{return}
        if(!event||typeof event!=='object'||!('type' in event))return
        const type=(event as {type?:unknown}).type
        if(type==='ready'){
          authenticated=true
          attempt=0
          dependencies.log('realtime connected')
          void triggerReconciliation()
        }else if(type==='cash_register_changed'&&authenticated){
          dependencies.log('cash event received')
          void triggerReconciliation()
        }
      })
      current.onClose(()=>{
        if(socket===current)socket=null
        dependencies.log('realtime disconnected')
        scheduleReconnect()
      })
      current.onError(()=>current.close())
    }catch{scheduleReconnect()}
    finally{connecting=false}
  }

  function start(){
    if(!stopped)return
    stopped=false;generation++
    removeConnectivity=dependencies.listenConnectivity(
      ()=>{clearReconnect();void connect()},
      ()=>{clearReconnect();socket?.close();socket=null},
    )
    void connect()
  }

  function stop(){
    if(stopped)return
    stopped=true;generation++;clearReconnect();removeConnectivity?.();removeConnectivity=null
    const current=socket;socket=null;current?.close()
  }

  return{start,stop}
}
