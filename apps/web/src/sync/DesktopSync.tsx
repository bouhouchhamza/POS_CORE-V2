import {useEffect} from 'react'
import {reconcileDesktopCashRegister} from './desktopCashRegister'

export default function DesktopSync(){
  useEffect(()=>{
    let running=false
    const run=async()=>{if(running)return;running=true;try{await reconcileDesktopCashRegister()}finally{running=false}}
    void run()
    const timer=window.setInterval(()=>void run(),15_000)
    window.addEventListener('online',run)
    return()=>{window.clearInterval(timer);window.removeEventListener('online',run)}
  },[])
  return null
}
