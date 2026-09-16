import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { Banknote, Bell, Copy, ExternalLink, Plus, Printer, QrCode, RefreshCw, ReceiptText, X } from 'lucide-react'
import { createRoom, createTable, getOrders, getRooms, getTableEvents, getTables, payOrder, resolveTableEvent, rotateTableQr, type TableEvent } from '../api/core-v2'
import { getSale } from '../api/sales'
import { useAuth } from '../auth/useAuth'
import RestaurantReceipt from '../components/RestaurantReceipt'
import type { RestaurantTable, Room, Sale, UniversalOrder } from '../types'
import { useI18n } from '../i18n'
import { publicMenuUrl } from '../public-menu-url'

type TableQr={url:string;image:string;table:RestaurantTable}
type PrintMode='single'|'bulk'

async function waitForPrintImages(container:HTMLElement|null){
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
  const images=Array.from(container?.querySelectorAll('img')??[])
  await Promise.all(images.map(async image=>{
    if(!image.complete)await new Promise<void>(resolve=>{image.addEventListener('load',()=>resolve(),{once:true});image.addEventListener('error',()=>resolve(),{once:true})})
    if(image.decode)await image.decode().catch(()=>undefined)
  }))
}

export default function TablesPage(){
  const {t}=useI18n()
  const {user}=useAuth()
  const navigate=useNavigate()
  const [rooms,setRooms]=useState<Room[]>([]),[tables,setTables]=useState<RestaurantTable[]>([]),[events,setEvents]=useState<TableEvent[]>([]),[orders,setOrders]=useState<UniversalOrder[]>([])
  const [roomName,setRoomName]=useState(''),[tableName,setTableName]=useState(''),[number,setNumber]=useState(''),[roomId,setRoomId]=useState(0),[showSetup,setShowSetup]=useState(false)
  const [qr,setQr]=useState<TableQr|null>(null),[bulkQrs,setBulkQrs]=useState<TableQr[]>([]),[printMode,setPrintMode]=useState<PrintMode|null>(null)
  const singlePrintRef=useRef<HTMLElement>(null),bulkPrintRef=useRef<HTMLElement>(null)
  const [bill,setBill]=useState<UniversalOrder|null>(null),[receipt,setReceipt]=useState<Sale|null>(null),[paymentMethod,setPaymentMethod]=useState<'cash'|'card'|'other'>('cash'),[error,setError]=useState('')
  const load=useCallback(()=>Promise.all([getRooms(),getTables(),getTableEvents(),getOrders()]).then(([a,b,c,d])=>{setRooms(a);setTables(b);setEvents(c);setOrders(d);setRoomId(current=>current||a[0]?.id||0)}).catch(()=>setError(t('tables.loadError'))),[t])
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),8000);return()=>clearInterval(timer)},[load])
  useEffect(()=>()=>document.body.classList.remove('table-qr-print-mode'),[])
  async function addRoom(event:FormEvent){event.preventDefault();await createRoom({name:roomName,sort_order:rooms.length,active:true});setRoomName('');await load()}
  async function addTable(event:FormEvent){event.preventDefault();const table=await createTable({room_id:roomId,table_number:number,name:tableName,capacity:4,status:'available',active:true});setTableName('');setNumber('');setShowSetup(false);await load();await openQr(table)}
  async function ensureQr(table:RestaurantTable){if(!table.qr_token)throw new Error('QR indisponible.');const url=publicMenuUrl(table.qr_token,import.meta.env.VITE_PUBLIC_APP_URL,location.origin),image=await QRCode.toDataURL(url,{width:520,margin:2});if(import.meta.env.DEV)console.info('[CorePOS QR]',url);return{table,url,image}}
  async function openQr(table:RestaurantTable){setQr(await ensureQr(table))}
  async function regenerateQr(){if(!qr||!confirm(t('tables.regenerateConfirm')))return;const table={...qr.table,...await rotateTableQr(qr.table.id)};await load();setQr(await ensureQr(table))}
  async function startQrPrint(mode:PrintMode,container:HTMLElement|null){
    setPrintMode(mode)
    document.body.classList.add('table-qr-print-mode')
    await waitForPrintImages(container)
    const cleanup=()=>{document.body.classList.remove('table-qr-print-mode');setPrintMode(current=>current===mode?null:current)}
    window.addEventListener('afterprint',cleanup,{once:true})
    try{window.print()}catch(error){window.removeEventListener('afterprint',cleanup);cleanup();throw error}
  }
  async function printAll(){const generated=[];for(const table of tables)generated.push(await ensureQr(table));setBulkQrs(generated);await startQrPrint('bulk',bulkPrintRef.current)}
  const active=(tableId:number)=>orders.find(order=>order.table_id===tableId&&!['completed','cancelled'].includes(order.status))
  const requests=(tableId:number)=>events.filter(event=>event.table_id===tableId)
  async function resolve(event:TableEvent){await resolveTableEvent(event.id);await load()}
  async function pay(order:UniversalOrder){try{const result=await payOrder(order.id,paymentMethod);setReceipt(await getSale(result.sale_id));setBill(result.order);await load();window.dispatchEvent(new Event('cash-register-changed'))}catch(e){setError(e instanceof Error?e.message:'Encaissement impossible.')}}
  return <section className="tables-page operations-page">
    <div className="page-title"><div><h2>{t('tables.title')}</h2><p>{t('tables.subtitle')}</p></div><div className="button-row"><button className="button secondary" disabled={!tables.length} onClick={()=>void printAll()}><Printer size={17}/>{t('tables.printAllQr')}</button><button className="button" onClick={()=>setShowSetup(value=>!value)}><Plus size={17}/>{t('tables.createRoomTable')}</button></div></div>{error?<div className="error-message">{error}</div>:null}
    {events.length?<div className="service-alert-strip"><Bell size={18}/><strong>{events.length} demande(s) de service en attente</strong></div>:null}
    {showSetup?<div className="table-setup-grid"><form className="settings-card form-grid" onSubmit={addRoom}><h3>{t('tables.newRoom')}</h3><label>{t('common.name')}<input required value={roomName} onChange={event=>setRoomName(event.target.value)}/></label><button className="button">{t('tables.addRoom')}</button></form><form className="settings-card form-grid" onSubmit={addTable}><h3>{t('tables.newTable')}</h3><label>{t('tables.room')}<select value={roomId} onChange={event=>setRoomId(Number(event.target.value))}>{rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label>{t('tables.number')}<input required value={number} onChange={event=>setNumber(event.target.value)}/></label><label>{t('common.name')}<input required value={tableName} onChange={event=>setTableName(event.target.value)}/></label><button className="button" disabled={!roomId}>{t('tables.addTable')}</button></form></div>:null}
    {!tables.length?<div className="empty-state operational-empty"><h3>{t('tables.empty')}</h3><button className="button" onClick={()=>setShowSetup(true)}>{t('tables.createRoomTable')}</button></div>:<div className="table-management-grid">{tables.map(table=>{const order=active(table.id),alerts=requests(table.id),displayStatus=alerts.some(event=>event.type==='request_bill')?'bill_requested':order?.status==='preparing'?'preparing':order?.status==='ready'?'ready':order?'occupied':table.status;return <article className={`settings-card table-management-card table-status-${displayStatus}`} key={table.id}><div className="table-card-heading"><div><small>{table.room_name}</small><h3>{table.name}</h3><p>{t('common.table')} {table.table_number} · {t('tables.places',{count:table.capacity})}</p></div><span className={`badge ${displayStatus==='available'?'success':'warning'}`}>{t(`tables.status.${displayStatus}`)}</span></div>{order?<button className="table-active-order" onClick={()=>navigate(`/orders?open=${order.id}`)}><span><strong>{order.order_number}</strong><small>{order.items.reduce((sum,item)=>sum+item.quantity,0)} {t('common.items')} · {t(`order.status.${order.status}`)}</small></span><b>{order.total.toFixed(2)} {user?.business?.currency}</b></button>:null}{alerts.map(event=><div className={`table-service-alert ${event.type}`} key={event.id}>{event.type==='call_waiter'?<Bell/>:<ReceiptText/>}<span><strong>{t(event.type==='call_waiter'?'tables.callWaiter':'tables.billRequested')}</strong><small>{new Date(event.created_at).toLocaleTimeString()}</small></span>{event.type==='call_waiter'?<button className="button secondary" onClick={()=>void resolve(event)}>{t('tables.handle')}</button>:<button className="button" disabled={!order} onClick={()=>order&&setBill(order)}>{t('tables.handleBill')}</button>}</div>)}<div className="table-card-actions"><button className="button table-primary-action" onClick={()=>navigate(`/pos?mode=dine_in&table=${table.id}`)}>{t(order?'tables.addProducts':'tables.openOrder')}</button>{order?<button className="button secondary" onClick={()=>{setBill(order);setReceipt(null)}}>{t('tables.pay')}</button>:null}<button className="icon-button" title={t('tables.qrTitle')} onClick={()=>void openQr(table)}><QrCode/></button></div></article>})}</div>}
    {bill?<div className="modal-backdrop"><section className="modal-content order-detail-modal"><button className="icon-button modal-close" onClick={()=>{setBill(null);setReceipt(null)}}><X/></button>{receipt?<RestaurantReceipt sale={receipt} order={bill} businessName={user?.business?.name??'CorePOS'} currency={user?.business?.currency??'MAD'}/>:<><h2>{bill.table_name} · {t('tables.bill')}</h2><div className="order-lines">{bill.items.map(item=><article key={item.id}><span><strong>{item.quantity} × {item.product_name}</strong>{item.modifiers.length?<small>{item.modifiers.map(modifier=>modifier.name).join(', ')}</small>:null}{item.notes?<small>{item.notes}</small>:null}</span><b>{item.total.toFixed(2)}</b></article>)}</div><div className="bill-totals"><span>{t('tables.subtotal')} <b>{bill.subtotal.toFixed(2)}</b></span><span>{t('tables.discounts')} <b>{bill.discount.toFixed(2)}</b></span><span>{t('tables.taxes')} <b>{bill.tax.toFixed(2)}</b></span><strong>{t('orders.total')} <b>{bill.total.toFixed(2)} {user?.business?.currency}</b></strong></div>{bill.payment_status!=='paid'?<div className="button-row"><select value={paymentMethod} onChange={event=>setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="cash">{t('payment.cash')}</option><option value="card">{t('payment.card')}</option><option value="other">{t('payment.other')}</option></select><button className="button" onClick={()=>void pay(bill)}><Banknote/>{t('tables.pay')}</button></div>:bill.sale_id?<button className="button" onClick={()=>getSale(bill.sale_id!).then(setReceipt)}><Printer/>{t('common.previewReprint')}</button>:null}</>}</section></div>:null}
    {qr?<div className="modal-backdrop"><section className="modal-content qr-table-modal"><button className="icon-button qr-modal-close" onClick={()=>setQr(null)}><X/></button><small>{qr.table.room_name}</small><h2>{qr.table.name}</h2><img className="qr-admin-code" src={qr.image} alt={t('tables.qrAlt')}/><p className="break-word qr-public-url">{qr.url}</p><div className="button-row"><button className="button" onClick={()=>void startQrPrint('single',singlePrintRef.current)}><Printer/>{t('tables.printQr')}</button><a className="button secondary" href={qr.image} download={`qr-${qr.table.table_number}.png`}>{t('tables.download')}</a><button className="button secondary" onClick={()=>void navigator.clipboard.writeText(qr.url)}><Copy/>{t('tables.copy')}</button><a className="button secondary" href={qr.url} target="_blank" rel="noreferrer"><ExternalLink/>{t('tables.open')}</a><button className="button secondary" onClick={()=>void regenerateQr()}><RefreshCw/>{t('tables.regenerate')}</button></div></section></div>:null}
    <section ref={singlePrintRef} className={`table-qr-print${printMode==='single'?' is-printing':''}`} aria-hidden="true">{qr?<article><strong>{user?.business?.name??'CorePOS'}</strong><small>{qr.table.room_name}</small><h1>{qr.table.name}</h1><p>{t('common.table')} {qr.table.table_number}</p><img src={qr.image} alt={t('tables.qrAlt')}/><small>{qr.url}</small></article>:null}</section>
    <section ref={bulkPrintRef} className={`bulk-qr-print${printMode==='bulk'?' is-printing':''}`} aria-hidden="true">{bulkQrs.map(item=><article key={item.table.id}><strong>{user?.business?.name??'CorePOS'}</strong><small>{item.table.room_name}</small><h1>{item.table.name}</h1><p>{t('common.table')} {item.table.table_number}</p><img src={item.image} alt=""/><small>{item.url}</small></article>)}</section>
  </section>
}
