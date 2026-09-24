import {useEffect} from 'react'
import {reconcileDesktopCashRegister} from './desktopCashRegister'
import {reconcileDesktopMasterData} from './desktopMasterData'
import {reconcileDesktopUniversalV1} from './desktopUniversalV1'
import {reconcileDesktopCycle} from './desktopSyncCore'
import {reconcileDesktopTransactional} from './desktopTransactionalSync'
import {startDesktopRealtime} from './desktopRealtime'

export default function DesktopSync(){
  useEffect(()=>{
    const stopRealtime=startDesktopRealtime()
    let running=false
    const run=async()=>{if(running)return;running=true;try{await reconcileDesktopCycle({cash:reconcileDesktopCashRegister,universalMaster:reconcileDesktopUniversalV1,legacyMaster:reconcileDesktopMasterData,transactional:reconcileDesktopTransactional})}finally{running=false}}
    void run()
    const timer=window.setInterval(()=>void run(),15_000)
    window.addEventListener('online',run)
    return()=>{stopRealtime();window.clearInterval(timer);window.removeEventListener('online',run)}
  },[])
  return null
}
