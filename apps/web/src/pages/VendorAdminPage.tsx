import { useEffect, useState, type FormEvent } from 'react'
import { businessTypes, featureKeys } from '@bimik/shared-types'
import { offlineRequestSchema } from '@bimik/validation'
import { vendorApi } from '../api/license'

type MainSection = 'dashboard'|'customers'|'licenses'|'devices'|'advanced'
type AdvancedSection = 'businesses'|'plans'|'provisioning-keys'|'activation-codes'|'activations'|'offline'|'audit'
type Modal = 'onboarding'|'business'|'plan'|'license'|'renew'|null
type Duration = 'lifetime'|'custom'
type PlanDraft = {id:string;code:string;name:string;features:string[];default_device_limit:number;default_desktop_device_limit:number|null;default_web_device_limit:number|null;default_mobile_device_limit:number|null;offline_validity_days:number|null;active:boolean}

type Row = {
  id:string
  name?:string
  code?:string
  email?:string|null
  phone?:string|null
  notes?:string|null
  created_at?:string
  customer_id?:string
  customer_name?:string
  vendor_business_id?:string
  vendor_business_name?:string|null
  runtime_business_id?:number|null
  license_count?:number
  plan_id?:string
  plan_name?:string
  plan_code?:string
  status?:string
  business_type?:string|null
  max_devices?:number
  max_desktop_devices?:number|null
  max_web_devices?:number|null
  max_mobile_devices?:number|null
  active_devices?:number
  active_desktop_devices?:number
  active_web_devices?:number
  active_mobile_devices?:number
  expires_at?:string|null
  allowed_features?:string[]
  features?:string[]
  default_device_limit?:number
  default_desktop_device_limit?:number|null
  default_web_device_limit?:number|null
  default_mobile_device_limit?:number|null
  offline_validity_days?:number|null
  active?:boolean
  license_id?:string
  device_name?:string|null
  installation_id?:string
  device_fingerprint?:string
  app_version?:string|null
  activated_at?:string
  last_validated_at?:string|null
  last_seen_at?:string|null
  platform?:string|null
  tenant_slug?:string|null
  tenant_database_name?:string|null
  tenant_status?:string|null
  kind?:string
  certificate_id?:string
  actor?:string
  action?:string
  entity_type?:string
  entity_id?:string
  description?:string
  device_public_key?:string
  nonce?:string
  requested_at?:string
  device_proof?:string
  version?:number
  key_hint?:string
  channel?:string
  provisioning_status?:string
  activation_status?:string
  consumed_device_id?:string|null
  consumed_at?:string|null
  revoked_at?:string|null
}

type Dashboard = {
  customers:{count:number}
  licenses:{total:number;active:number;suspended:number;revoked:number}
  devices:{total:number;active:number;revoked:number}
  activations:{total:number;last_30_days:number}
}

type OneTimeBundle = {
  provisioningKey?:string
  provisioningExpiresAt?:string|null
  licenseKey?:string
  activationExpiresAt?:string|null
  activationChannel?:string
  customerName?:string
  businessName?:string
}

type OnboardingResponse = {
  provisioning?: { provisioning_key?: string; expires_at?: string | null }
  license_key?: string
  activation?: { expires_at?: string | null; channel?: string }
  customer?: { name?: string }
  business?: { name?: string }
}

type ProvisioningKeyResponse = {
  provisioning_key?: string
  expires_at?: string | null
  vendor_business_name?: string
  customer_name?: string
}

type ActivationCodeResponse = {
  activation_code?: string
  expires_at?: string | null
  channel?: string
  vendor_business_name?: string
  customer_name?: string
}

const mainSections:Array<{id:MainSection;label:string}> = [
  {id:'dashboard',label:'Dashboard'},
  {id:'customers',label:'Clients'},
  {id:'licenses',label:'Licences'},
  {id:'devices',label:'Appareils'},
  {id:'advanced',label:'Avance'}
]

const advancedSections:Array<{id:AdvancedSection;label:string}> = [
  {id:'businesses',label:'Businesses'},
  {id:'plans',label:'Plans & modules'},
  {id:'provisioning-keys',label:'Codes de provisionnement'},
  {id:'activation-codes',label:"Codes d'activation"},
  {id:'activations',label:'Activations'},
  {id:'offline',label:'Activation hors ligne'},
  {id:'audit',label:'Audit'}
]

const labels:Record<string,string> = {
  pos:'POS',inventory:'Stock',barcode:'Code-barres',suppliers:'Fournisseurs',purchases:'Achats',customers:'Clients',tables:'Tables',qr_menu:'Commande par QR',kitchen:'Cuisine',takeaway:'A emporter',delivery:'Livraison',reservations:'Reservations',product_variants:'Variantes',modifiers:'Modificateurs',weighted_products:'Produits au poids',expiry_tracking:'Suivi des expirations'
}

const emptyBusiness = {id:'',customer_id:'',name:'',business_type:'retail',status:'active',notes:''}
const emptyPlan:PlanDraft = {id:'',code:'',name:'',features:['pos','inventory'],default_device_limit:3,default_desktop_device_limit:1,default_web_device_limit:1,default_mobile_device_limit:1,offline_validity_days:null,active:true}
const emptyLicense = {vendor_business_id:'',plan_id:'',duration:'lifetime' as Duration,custom_expires_at:'',offline_validity_days:null as number|null,notes:''}
const emptyOnboarding = {customer_name:'',email:'',phone:'',customer_notes:'',business_name:'',business_type:'retail',business_notes:'',plan_id:'',duration:'lifetime' as Duration,custom_expires_at:'',offline_validity_days:null as number|null}

const parsedDate = (value:unknown) => {
  if(!value) return null
  const result = new Date(String(value))
  return Number.isNaN(result.getTime()) ? null : result
}

const date = (value:unknown) => parsedDate(value)?.toLocaleString('fr-MA') ?? '-'
const expiryLabel = (value:unknown) => value ? date(value) : 'À vie'
const offlineLabel = (value:unknown) => value == null ? 'Permanent' : `${Number(value)} jours`
const short = (value:unknown) => { const text=String(value??''); return text.length>18 ? `${text.slice(0,8)}...${text.slice(-6)}` : text||'-' }
const badge = (value:unknown) => <span className={`badge ${value==='active'||value==='approved'||value==='available'?'success':value==='suspended'?'warning':'muted'}`}>{String(value??'-')}</span>
const download = (name:string,value:string) => { const url=URL.createObjectURL(new Blob([value],{type:'text/plain;charset=utf-8'})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url) }

function isoFromLocal(value:string){
  if(!value) return null
  const result = new Date(value)
  if(Number.isNaN(result.getTime())) throw new Error('Date invalide.')
  return result.toISOString()
}

function expiryFromDuration(duration:Duration, custom:string){
  if(duration==='lifetime') return null
  if(duration==='custom') return isoFromLocal(custom)
  return null
}

function provisioningExpiry(licenseExpiry?:string|null){
  const automatic = Date.now() + 24*60*60*1000
  const licence = parsedDate(licenseExpiry)?.getTime()
  const value = licence ? Math.min(automatic,licence) : automatic
  if(value <= Date.now()) throw new Error('Cette licence est expiree.')
  return new Date(value).toISOString()
}

export default function VendorAdminPage(){
  const [username,setUsername] = useState(()=>localStorage.getItem('vendor-username')??'admin')
  const [password,setPassword] = useState('')
  const [connected,setConnected] = useState(false)
  const [section,setSection] = useState<MainSection>('dashboard')
  const [advancedSection,setAdvancedSection] = useState<AdvancedSection>('plans')
  const [dashboard,setDashboard] = useState<Dashboard|null>(null)
  const [rows,setRows] = useState<Row[]>([])
  const [customers,setCustomers] = useState<Row[]>([])
  const [businesses,setBusinesses] = useState<Row[]>([])
  const [plans,setPlans] = useState<Row[]>([])
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [modal,setModal] = useState<Modal>(null)
  const [business,setBusiness] = useState({...emptyBusiness})
  const [plan,setPlan] = useState({...emptyPlan})
  const [license,setLicense] = useState({...emptyLicense})
  const [onboarding,setOnboarding] = useState({...emptyOnboarding})
  const [renewTarget,setRenewTarget] = useState<Row|null>(null)
  const [renewDuration,setRenewDuration] = useState<Duration>('lifetime')
  const [renewCustom,setRenewCustom] = useState('')
  const [renewOfflineDays,setRenewOfflineDays] = useState<number|null>(null)
  const [oneTime,setOneTime] = useState<OneTimeBundle|null>(null)
  const [offlineRequest,setOfflineRequest] = useState<Row|null>(null)
  const [offlineLicenseId,setOfflineLicenseId] = useState('')
  const [offlineFingerprint,setOfflineFingerprint] = useState('')

  const [activeLicenses,setActiveLicenses] = useState<Row[]>([])

  const fail = (value:unknown) => setError(value instanceof Error?value.message:'Operation impossible.')
  const clearMessages = () => { setError(''); setSuccess('') }
  const toggle = (list:string[],item:string) => list.includes(item)?list.filter(value=>value!==item):[...list,item]

  async function references(){
    const [c,b,p] = await Promise.all([
      vendorApi.get<Row[]>('/customers'),
      vendorApi.get<Row[]>('/businesses'),
      vendorApi.get<Row[]>('/plans')
    ])
    setCustomers(c); setBusinesses(b); setPlans(p)
  }

  async function loadDashboard(){ setDashboard(await vendorApi.get<Dashboard>('/dashboard')) }

  async function loadAdvanced(next:AdvancedSection=advancedSection){
    setAdvancedSection(next); setLoading(true); clearMessages()
    try{
      if(next==='offline'){ await references(); setRows([]) }
      else setRows(await vendorApi.get<Row[]>(`/${next}`))
      if(['businesses','plans','provisioning-keys','activation-codes'].includes(next)) await references()
    }catch(value){ fail(value) }finally{ setLoading(false) }
  }

  async function load(next:MainSection=section){
    setSection(next); setLoading(true); clearMessages()
    try{
      if(next==='dashboard') await loadDashboard()
      else if(next==='advanced'){
        setLoading(false)
        await loadAdvanced(advancedSection)
        return
      }else{
        setRows(await vendorApi.get<Row[]>(`/${next}`))
        if(next==='licenses'||next==='devices') await references()
      }
    }catch(value){ fail(value) }finally{ setLoading(false) }
  }

  async function connect(event:FormEvent){
    event.preventDefault()
    if(!username.trim()||!password) return setError('Entrez votre identifiant et votre mot de passe.')
    setLoading(true); clearMessages()
    try{
      await vendorApi.login({username:username.trim(),password})
      localStorage.setItem('vendor-username',username.trim())
      setPassword(''); setConnected(true); setSection('dashboard')
      await loadDashboard()
    }catch(value){ setConnected(false); fail(value) }finally{ setLoading(false) }
  }

  useEffect(()=>{
    let active=true
    setLoading(true)
    vendorApi.session().then(async()=>{
      if(!active)return
      setConnected(true)
      try{ await loadDashboard() }catch{ setConnected(false) }
    }).catch(()=>{ if(active)setConnected(false) }).finally(()=>{ if(active)setLoading(false) })
    return()=>{active=false}
  },[])

  async function logout(){
    try{ await vendorApi.logout() }catch{/* local logout still proceeds */}
    setConnected(false); setRows([]); setDashboard(null); setOneTime(null); setPassword(''); clearMessages()
  }

  async function openOnboarding(){
    setLoading(true); clearMessages()
    try{
      await references()
      setOnboarding({...emptyOnboarding})
      setModal('onboarding')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function submitOnboarding(event:FormEvent){
    event.preventDefault(); setLoading(true); clearMessages()
    try{
      const created = await vendorApi.post<OnboardingResponse>('/onboarding',{
        customer:{
          name:onboarding.customer_name,
          email:onboarding.email||null,
          phone:onboarding.phone||null,
          notes:onboarding.customer_notes||null
        },
        business:{
          name:onboarding.business_name,
          business_type:onboarding.business_type,
          notes:onboarding.business_notes||null
        },
        plan_id:onboarding.plan_id,
        duration:onboarding.duration,
        custom_expires_at:onboarding.duration==='custom'?isoFromLocal(onboarding.custom_expires_at):null,
        offline_validity_days:onboarding.offline_validity_days
      })
      setOneTime({
        provisioningKey:created.provisioning?.provisioning_key,
        provisioningExpiresAt:created.provisioning?.expires_at,
        licenseKey:created.license_key,
        activationExpiresAt:created.activation?.expires_at??null,
        activationChannel:created.activation?.channel??'desktop',
        customerName:created.customer?.name,
        businessName:created.business?.name
      })
      setModal(null); setSuccess('Client, business et licence crees. Le code client est pret.')
      await references(); await loadDashboard()
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function submitBusiness(event:FormEvent){
    event.preventDefault(); setLoading(true); clearMessages()
    try{
      const payload={name:business.name,business_type:business.business_type,status:business.status,notes:business.notes||null}
      if(business.id) await vendorApi.put(`/businesses/${business.id}`,payload)
      else await vendorApi.post('/businesses',{...payload,customer_id:business.customer_id})
      setBusiness({...emptyBusiness}); setModal(null); setSuccess(business.id?'Business mis a jour.':'Business cree.')
      await loadAdvanced('businesses')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function submitPlan(event:FormEvent){
    event.preventDefault(); setLoading(true); clearMessages()
    try{
      const payload={name:plan.name,features:plan.features,default_device_limit:Number(plan.default_device_limit),default_desktop_device_limit:plan.default_desktop_device_limit==null?null:Number(plan.default_desktop_device_limit),default_web_device_limit:plan.default_web_device_limit==null?null:Number(plan.default_web_device_limit),default_mobile_device_limit:plan.default_mobile_device_limit==null?null:Number(plan.default_mobile_device_limit),offline_validity_days:plan.offline_validity_days?Number(plan.offline_validity_days):null,active:plan.active}
      if(plan.id) await vendorApi.put(`/plans/${plan.id}`,payload)
      else await vendorApi.post('/plans',{...payload,code:plan.code})
      setPlan({...emptyPlan}); setModal(null); setSuccess(plan.id?'Plan mis a jour.':'Plan cree.')
      await loadAdvanced('plans')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function submitLicense(event:FormEvent){
    event.preventDefault(); setLoading(true); clearMessages()
    try{
      const selected = plans.find(item=>item.id===license.plan_id)
      if(!selected) throw new Error('Selectionnez un plan.')
      const created = await vendorApi.post<Row&{license_key:string;activation?:{expires_at?:string|null;channel?:string}}>('/licenses',{
        vendor_business_id:license.vendor_business_id,
        plan_id:license.plan_id,
        allowed_features:selected.features??[],
        max_devices:Number(selected.default_device_limit??1),
        expires_at:expiryFromDuration(license.duration,license.custom_expires_at),
        offline_validity_days:license.offline_validity_days,
        notes:license.notes||null
      })
      setOneTime({licenseKey:created.license_key,activationExpiresAt:created.activation?.expires_at??null,activationChannel:created.activation?.channel??'desktop',businessName:created.vendor_business_name??undefined,customerName:created.customer_name})
      setLicense({...emptyLicense}); setModal(null); setSuccess('Licence creee.')
      await load('licenses')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function licenseAction(id:string,action:'suspend'|'reactivate'|'revoke'){
    if(!confirm(action==='revoke'?'Revoquer definitivement cette licence ?':'Confirmer cette modification ?')) return
    setLoading(true); clearMessages()
    try{ await vendorApi.post(`/licenses/${id}/${action}`,{}); await load('licenses'); setSuccess('Licence mise a jour.') }
    catch(value){fail(value)}finally{setLoading(false)}
  }

  async function submitRenew(event:FormEvent){
    event.preventDefault()
    if(!renewTarget)return
    setLoading(true); clearMessages()
    try{
      await vendorApi.post(`/licenses/${renewTarget.id}/renew`,{expires_at:expiryFromDuration(renewDuration,renewCustom),offline_validity_days:renewOfflineDays})
      setRenewTarget(null); setModal(null); await load('licenses'); setSuccess('Licence renouvelee.')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function issueProvisioningFor(item:Row){
    if(item.runtime_business_id){
      setError('Ce business est deja provisionne. Aucun nouveau code client n est necessaire.')
      return
    }
    setLoading(true); clearMessages()
    try{
      const created=await vendorApi.post<ProvisioningKeyResponse>('/provisioning-keys',{
        license_id:item.id,
        channel:'cloud',
        expires_at:provisioningExpiry(item.expires_at),
        notes:'Code client genere depuis Vendor Console'
      })
      setOneTime({provisioningKey:created.provisioning_key,provisioningExpiresAt:created.expires_at,businessName:created.vendor_business_name,customerName:created.customer_name})
      setSuccess('Nouveau code client genere. Les anciens codes inutilises ont ete revoques.')
      if(section==='advanced'&&advancedSection==='provisioning-keys') await loadAdvanced('provisioning-keys')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function revokeProvisioning(id:string){
    if(!confirm('Revoquer ce code inutilise ?'))return
    try{ await vendorApi.post(`/provisioning-keys/${id}/revoke`,{}); await loadAdvanced('provisioning-keys'); setSuccess('Code revoque.') }catch(value){fail(value)}
  }

  async function issueActivationFor(item:Row,channel:'desktop'|'web'|'mobile'='desktop'){
    setLoading(true); clearMessages()
    try{
      const created=await vendorApi.post<ActivationCodeResponse>('/activation-codes',{
        license_id:item.id,
        channel,
        ttl_hours:24,
        notes:`Code ${channel} genere depuis Vendor Console`
      })
      setOneTime({
        licenseKey:created.activation_code,
        activationExpiresAt:created.expires_at,
        activationChannel:created.channel??channel,
        businessName:created.vendor_business_name,
        customerName:created.customer_name
      })
      setSuccess(`Code d'activation ${channel} genere. Il est utilisable une seule fois.`)
      if(section==='advanced'&&advancedSection==='activation-codes') await loadAdvanced('activation-codes')
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  async function revokeActivationCode(id:string){
    if(!confirm("Revoquer ce code d'activation inutilise ?"))return
    try{ await vendorApi.post(`/activation-codes/${id}/revoke`,{}); await loadAdvanced('activation-codes'); setSuccess("Code d'activation revoque.") }catch(value){fail(value)}
  }

  async function revokeDevice(id:string){
    if(!confirm("Revoquer cet appareil ? Le slot sera libere."))return
    try{ await vendorApi.post(`/devices/${id}/revoke`,{}); await load('devices'); setSuccess('Appareil revoque. Le slot est disponible.') }catch(value){fail(value)}
  }

  async function importRequest(file:File){
    try{
      const parsed=JSON.parse(await file.text())
      const valid=offlineRequestSchema.parse(parsed)
      setActiveLicenses(await vendorApi.post<Row[]>('/offline-activations/candidates',valid))
      setOfflineRequest(parsed)
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parsed.device_public_key))
      setOfflineFingerprint(Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''))
    }catch(value){setOfflineRequest(null);fail(value)}
  }

  async function issueOffline(){
    if(!offlineRequest||!offlineLicenseId)return
    setLoading(true); clearMessages()
    try{
      const signed=await vendorApi.post<Record<string,unknown>>('/offline-activations/issue',{license_id:offlineLicenseId,request:offlineRequest})
      download(`licence-${offlineRequest.installation_id}.poslic`,JSON.stringify(signed,null,2))
      setSuccess('Licence hors ligne signee et telechargee.'); setOfflineRequest(null); setOfflineLicenseId(''); await references()
    }catch(value){fail(value)}finally{setLoading(false)}
  }

  function features(value:string[],change:(next:string[])=>void){
    return <div className="vendor-feature-grid">{featureKeys.map(item=><label key={item}><input checked={value.includes(item)} onChange={()=>change(toggle(value,item))} type="checkbox"/><span>{labels[item]??item}</span></label>)}</div>
  }

  function customerTable(){
    if(!rows.length)return <div className="vendor-empty">Aucun client.</div>
    return <div className="table-wrap"><table><thead><tr><th>Client</th><th>Email</th><th>Telephone</th><th>Cree le</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.email??'-'}</td><td>{r.phone??'-'}</td><td>{date(r.created_at)}</td></tr>)}</tbody></table></div>
  }

  function licenseTable(){
    if(!rows.length)return <div className="vendor-empty">Aucune licence.</div>
    return <div className="table-wrap"><table><thead><tr><th>Client / Business</th><th>Plan</th><th>Statut</th><th>Expiration</th><th>Hors ligne</th><th>Appareils</th><th>Workspace</th><th>Actions</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.vendor_business_name??'-'}</strong><br/><small>{r.customer_name??'-'}</small></td><td>{r.plan_name??r.plan_code??'-'}</td><td>{badge(r.status)}</td><td>{expiryLabel(r.expires_at)}</td><td>{offlineLabel(r.offline_validity_days)}</td><td><strong>{r.active_devices??0}/{r.max_devices??0}</strong><br/><small>POS {r.active_desktop_devices??0}/{r.max_desktop_devices??'∞'} · Web {r.active_web_devices??0}/{r.max_web_devices??'∞'} · Mobile {r.active_mobile_devices??0}/{r.max_mobile_devices??'∞'}</small></td><td>{r.tenant_slug?<><code>{r.tenant_slug}</code><br/><small>{r.tenant_status??'-'}</small></>:'-'}</td><td><div className="vendor-row-actions">{r.status==='active'&&!r.runtime_business_id?<button className="button" onClick={()=>void issueProvisioningFor(r)}>Code client</button>:r.runtime_business_id?<span className="badge success">Deja provisionne</span>:null}{r.status==='active'&&(r.expires_at==null||(parsedDate(r.expires_at)?.getTime()??0)>Date.now())?<button className="button secondary" onClick={()=>void issueActivationFor(r,'desktop')}>Code Desktop</button>:null}<button className="button secondary" onClick={()=>{setRenewTarget(r);setRenewDuration(r.expires_at==null?'lifetime':'custom');setRenewCustom(r.expires_at?.slice(0,16)??'');setRenewOfflineDays(r.offline_validity_days??null);setModal('renew')}}>Modifier</button>{r.status==='active'?<button className="button secondary" onClick={()=>void licenseAction(r.id,'suspend')}>Suspendre</button>:r.status==='suspended'?<button className="button secondary" onClick={()=>void licenseAction(r.id,'reactivate')}>Reactiver</button>:null}{r.status!=='revoked'?<button className="button danger" onClick={()=>void licenseAction(r.id,'revoke')}>Revoquer</button>:null}</div></td></tr>)}</tbody></table></div>
  }

  function deviceTable(){
    if(!rows.length)return <div className="vendor-empty">Aucun appareil.</div>
    return <div className="table-wrap"><table><thead><tr><th>Client / Business</th><th>Canal</th><th>Appareil</th><th>Statut</th><th>Version</th><th>Derniere activite</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.vendor_business_name??'-'}</strong><br/><small>{r.customer_name??'-'}</small></td><td><span className="badge success">{r.channel??'desktop'}</span><br/><small>{r.platform??'-'}</small></td><td><strong>{r.device_name??'Appareil'}</strong><br/><code>{short(r.installation_id)}</code></td><td>{badge(r.status)}</td><td>{r.app_version??'-'}</td><td>{date(r.last_seen_at??r.last_validated_at??r.activated_at)}</td><td>{r.status==='active'?<button className="button danger" onClick={()=>void revokeDevice(r.id)}>Revoquer</button>:null}</td></tr>)}</tbody></table></div>
  }

  function advancedTable(){
    if(loading)return <div className="vendor-empty">Chargement...</div>
    if(advancedSection==='offline') return <article className="settings-card vendor-offline"><label>Importer une demande .posreq<input accept=".posreq,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void importRequest(file)}} type="file"/></label>{offlineRequest?<div className="vendor-request-details"><p><strong>Installation:</strong> {offlineRequest.installation_id}</p><p><strong>Appareil:</strong> {offlineRequest.device_name}</p><p><strong>Type:</strong> {offlineRequest.version===2?'Déterminé par la licence':offlineRequest.business_type}</p><p><strong>Empreinte:</strong> <code>{offlineFingerprint}</code></p><p><strong>Demande:</strong> {date(offlineRequest.requested_at)}</p><label>Licence compatible active<select value={offlineLicenseId} onChange={e=>setOfflineLicenseId(e.target.value)}><option value="">Selectionner</option>{activeLicenses.map(item=><option key={item.id} value={item.id}>{item.customer_name} - {item.vendor_business_name} · {item.business_type} · {offlineLabel(item.offline_validity_days)} ({item.active_devices??0}/{item.max_devices})</option>)}</select></label><button className="button" disabled={!offlineLicenseId||loading} onClick={()=>void issueOffline()}>Generer le fichier .poslic</button></div>:<p>Selectionnez la demande generee par le Desktop. La preuve appareil sera verifiee par le serveur.</p>}</article>
    if(!rows.length)return <div className="vendor-empty">Aucune donnee.</div>
    if(advancedSection==='businesses')return <div className="table-wrap"><table><thead><tr><th>Business</th><th>Client</th><th>Type</th><th>Statut</th><th>Provisionne</th><th>Workspace / DB</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.customer_name??'-'}</td><td>{r.business_type??'-'}</td><td>{badge(r.status)}</td><td>{r.runtime_business_id?'Oui':'Non'}</td><td>{r.tenant_slug?<><code>{r.tenant_slug}</code><br/><small>{r.tenant_database_name??'-'} · {r.tenant_status??'-'}</small></>:'-'}</td><td><button className="button secondary" onClick={()=>{setBusiness({id:r.id,customer_id:r.customer_id??'',name:r.name??'',business_type:r.business_type??'retail',status:r.status??'active',notes:r.notes??''});setModal('business')}}>Modifier</button></td></tr>)}</tbody></table></div>
    if(advancedSection==='plans')return <div className="table-wrap"><table><thead><tr><th>Plan</th><th>Appareils</th><th>Par canal</th><th>Offline</th><th>Modules</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong><br/><code>{r.code}</code></td><td>{r.default_device_limit??1}</td><td><small>POS {r.default_desktop_device_limit??'∞'} · Web {r.default_web_device_limit??'∞'} · Mobile {r.default_mobile_device_limit??'∞'}</small></td><td>{offlineLabel(r.offline_validity_days)}</td><td className="vendor-features">{r.features?.map(f=>labels[f]??f).join(', ')}</td><td><button className="button secondary" onClick={()=>{setPlan({id:r.id,code:r.code??'',name:r.name??'',features:Array.isArray(r.features)?r.features:[],default_device_limit:Number(r.default_device_limit??1),default_desktop_device_limit:r.default_desktop_device_limit==null?null:Number(r.default_desktop_device_limit),default_web_device_limit:r.default_web_device_limit==null?null:Number(r.default_web_device_limit),default_mobile_device_limit:r.default_mobile_device_limit==null?null:Number(r.default_mobile_device_limit),offline_validity_days:r.offline_validity_days==null?null:Number(r.offline_validity_days),active:r.active!==false});setModal('plan')}}>Modifier</button></td></tr>)}</tbody></table></div>
    if(advancedSection==='provisioning-keys')return <div className="table-wrap"><table><thead><tr><th>Business</th><th>Canal</th><th>Indice</th><th>Statut</th><th>Expiration</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.vendor_business_name??'-'}</strong><br/><small>{r.customer_name??'-'}</small></td><td>{r.channel??'-'}</td><td><code>{r.key_hint??'-'}</code></td><td>{badge(r.provisioning_status)}</td><td>{date(r.expires_at)}</td><td>{r.provisioning_status==='available'?<button className="button danger" onClick={()=>void revokeProvisioning(r.id)}>Revoquer</button>:null}</td></tr>)}</tbody></table></div>
    if(advancedSection==='activation-codes')return <div className="table-wrap"><table><thead><tr><th>Business</th><th>Canal</th><th>Indice</th><th>Statut</th><th>Expiration</th><th>Utilise le</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.vendor_business_name??'-'}</strong><br/><small>{r.customer_name??'-'}</small></td><td>{r.channel??'-'}</td><td><code>{r.key_hint??'-'}</code></td><td>{badge(r.activation_status)}</td><td>{date(r.expires_at)}</td><td>{date(r.consumed_at)}</td><td>{r.activation_status==='available'?<button className="button danger" onClick={()=>void revokeActivationCode(r.id)}>Revoquer</button>:null}</td></tr>)}</tbody></table></div>
    if(advancedSection==='activations')return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th>Appareil</th><th>Statut</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.customer_name??'-'}</td><td>{r.kind??'-'}</td><td>{r.device_name??short(r.installation_id)}</td><td>{badge(r.status)}</td></tr>)}</tbody></table></div>
    return <div className="table-wrap"><table><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Entite</th><th>Description</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.actor??'-'}</td><td><code>{r.action??'-'}</code></td><td>{r.entity_type??'-'} / {short(r.entity_id)}</td><td>{r.description??'-'}</td></tr>)}</tbody></table></div>
  }

  if(!connected) return <main className="vendor-login-page"><form className="vendor-login-card" onSubmit={connect}><div className="vendor-login-brand"><span>POS</span><div><strong>Vendor Console</strong><small>Administration commerciale</small></div></div><div><h1>Connexion vendeur</h1><p>Utilisez votre identifiant et votre mot de passe. Aucun jeton technique n'est demande ici.</p></div><label>Identifiant<input autoComplete="username" onChange={e=>setUsername(e.target.value)} value={username}/></label><label>Mot de passe<input autoComplete="current-password" onChange={e=>setPassword(e.target.value)} type="password" value={password}/></label>{error?<p className="error-message">{error}</p>:null}<button className="button" disabled={loading}>{loading?'Connexion...':'Se connecter'}</button></form></main>

  return <main className="vendor-admin vendor-admin-shell">
    <header className="vendor-topbar"><div><small>Vendor Console</small><h1>Administration commerciale</h1></div><div className="vendor-topbar-actions"><span className="badge success">Connecte</span><button className="button secondary" onClick={()=>void logout()}>Deconnexion</button></div></header>
    <div className="vendor-layout">
      <aside className="vendor-sidebar"><div className="vendor-sidebar-brand"><span>POS</span><div><strong>Vendor</strong><small>Simple & commercial</small></div></div><nav>{mainSections.map(item=><button className={section===item.id?'active':''} key={item.id} onClick={()=>void load(item.id)}>{item.label}</button>)}</nav></aside>
      <section className="vendor-content">
        {error?<p className="error-message">{error}</p>:null}{success?<p className="success-message">{success}</p>:null}
        {section==='dashboard'?<><div className="vendor-section-head"><div><small>Vue generale</small><h2>Dashboard</h2></div><div className="vendor-row-actions"><button className="button" onClick={()=>void openOnboarding()}>Nouveau client</button><button className="button secondary" onClick={()=>void loadDashboard()}>Actualiser</button></div></div><div className="vendor-stats">{[['Clients',dashboard?.customers.count],['Licences actives',dashboard?.licenses.active],['Appareils actifs',dashboard?.devices.active],['Activations 30 jours',dashboard?.activations.last_30_days]].map(([label,value])=><article className="vendor-stat-card" key={String(label)}><small>{label}</small><strong>{Number(value??0)}</strong></article>)}</div><article className="settings-card"><h3>Onboarding simplifie</h3><p>Un seul formulaire cree le client, son business, sa licence et un code d'installation valable 24 h maximum.</p><button className="button" onClick={()=>void openOnboarding()}>Creer un nouveau client</button></article></>:null}
        {section==='customers'?<><div className="vendor-section-head"><div><small>Commercial</small><h2>Clients</h2></div><div className="vendor-row-actions"><button className="button" onClick={()=>void openOnboarding()}>Nouveau client</button><button className="button secondary" onClick={()=>void load('customers')}>Actualiser</button></div></div><article className="settings-card vendor-table-card">{loading?<div className="vendor-empty">Chargement...</div>:customerTable()}</article></>:null}
        {section==='licenses'?<><div className="vendor-section-head"><div><small>Controle</small><h2>Licences</h2></div><div className="vendor-row-actions"><button className="button" onClick={async()=>{await references();setLicense({...emptyLicense});setModal('license')}}>Nouvelle licence</button><button className="button secondary" onClick={()=>void load('licenses')}>Actualiser</button></div></div><article className="settings-card vendor-table-card">{loading?<div className="vendor-empty">Chargement...</div>:licenseTable()}</article></>:null}
        {section==='devices'?<><div className="vendor-section-head"><div><small>Desktop · Web · Mobile/PWA</small><h2>Appareils</h2></div><button className="button secondary" onClick={()=>void load('devices')}>Actualiser</button></div><article className="settings-card vendor-table-card">{loading?<div className="vendor-empty">Chargement...</div>:deviceTable()}</article></>:null}
        {section==='advanced'?<><div className="vendor-section-head"><div><small>Technique</small><h2>Avance</h2></div><button className="button secondary" onClick={()=>void loadAdvanced()}>Actualiser</button></div><div className="vendor-row-actions" style={{marginBottom:16,flexWrap:'wrap'}}>{advancedSections.map(item=><button className={`button ${advancedSection===item.id?'':'secondary'}`} key={item.id} onClick={()=>void loadAdvanced(item.id)}>{item.label}</button>)}</div>{advancedSection==='plans'?<div className="vendor-row-actions" style={{marginBottom:12}}><button className="button" onClick={()=>{setPlan({...emptyPlan});setModal('plan')}}>Nouveau plan</button></div>:null}{advancedSection==='businesses'?<div className="vendor-row-actions" style={{marginBottom:12}}><button className="button" onClick={async()=>{await references();setBusiness({...emptyBusiness});setModal('business')}}>Nouveau business</button></div>:null}<article className="settings-card vendor-table-card">{advancedTable()}</article></>:null}
      </section>
    </div>

    {modal?<div className="modal-backdrop"><div className="modal-content vendor-form-modal">
      {modal==='onboarding'?<form onSubmit={submitOnboarding}><h3>Nouveau client</h3><p>Tout se fait ici: client + business + licence + code d'installation.</p><label>Nom du client<input required value={onboarding.customer_name} onChange={e=>setOnboarding({...onboarding,customer_name:e.target.value})}/></label><label>Email<input type="email" value={onboarding.email} onChange={e=>setOnboarding({...onboarding,email:e.target.value})}/></label><label>Telephone<input value={onboarding.phone} onChange={e=>setOnboarding({...onboarding,phone:e.target.value})}/></label><label>Nom du business<input required value={onboarding.business_name} onChange={e=>setOnboarding({...onboarding,business_name:e.target.value})}/></label><label>Type de commerce<select value={onboarding.business_type} onChange={e=>setOnboarding({...onboarding,business_type:e.target.value})}>{businessTypes.map(item=><option key={item} value={item}>{item}</option>)}</select></label><label>Plan<select required value={onboarding.plan_id} onChange={e=>{const selected=plans.find(item=>item.id===e.target.value);setOnboarding({...onboarding,plan_id:e.target.value,offline_validity_days:selected?.offline_validity_days??null})}}><option value="">Selectionner</option>{plans.filter(item=>item.active!==false).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><fieldset className="vendor-policy-field"><legend>Duree de la licence</legend><label><input checked={onboarding.duration==='lifetime'} name="onboarding-duration" onChange={()=>setOnboarding({...onboarding,duration:'lifetime'})} type="radio"/> À vie</label><label><input checked={onboarding.duration==='custom'} name="onboarding-duration" onChange={()=>setOnboarding({...onboarding,duration:'custom'})} type="radio"/> Date d'expiration</label>{onboarding.duration==='custom'?<label>Date d'expiration<input required type="datetime-local" value={onboarding.custom_expires_at} onChange={e=>setOnboarding({...onboarding,custom_expires_at:e.target.value})}/></label>:null}</fieldset><fieldset className="vendor-policy-field"><legend>Fonctionnement hors ligne</legend><label><input checked={onboarding.offline_validity_days===null} name="onboarding-offline" onChange={()=>setOnboarding({...onboarding,offline_validity_days:null})} type="radio"/> Permanent</label><label><input checked={onboarding.offline_validity_days!==null} name="onboarding-offline" onChange={()=>setOnboarding({...onboarding,offline_validity_days:30})} type="radio"/> Limité</label>{onboarding.offline_validity_days!==null?<label>Durée hors ligne (jours)<input min="1" required type="number" value={onboarding.offline_validity_days} onChange={e=>setOnboarding({...onboarding,offline_validity_days:Math.max(1,Number(e.target.value)||1)})}/></label>:null}</fieldset><label>Notes client<textarea value={onboarding.customer_notes} onChange={e=>setOnboarding({...onboarding,customer_notes:e.target.value})}/></label><div className="modal-actions"><button className="button secondary" type="button" onClick={()=>setModal(null)}>Annuler</button><button className="button" disabled={loading}>{loading?'Creation...':'Creer et generer le code'}</button></div></form>:null}
      {modal==='business'?<form onSubmit={submitBusiness}><h3>{business.id?'Modifier le business':'Nouveau business'}</h3>{!business.id?<label>Client<select required value={business.customer_id} onChange={e=>setBusiness({...business,customer_id:e.target.value})}><option value="">Selectionner</option>{customers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}<label>Nom<input required value={business.name} onChange={e=>setBusiness({...business,name:e.target.value})}/></label><label>Type de commerce<select value={business.business_type} onChange={e=>setBusiness({...business,business_type:e.target.value})}>{businessTypes.map(item=><option key={item} value={item}>{item}</option>)}</select></label><label>Statut<select value={business.status} onChange={e=>setBusiness({...business,status:e.target.value})}><option value="active">active</option><option value="suspended">suspended</option><option value="closed">closed</option></select></label><label>Notes<textarea value={business.notes} onChange={e=>setBusiness({...business,notes:e.target.value})}/></label><div className="modal-actions"><button className="button secondary" type="button" onClick={()=>setModal(null)}>Annuler</button><button className="button">Enregistrer</button></div></form>:null}
      {modal==='plan'?<form onSubmit={submitPlan}><h3>{plan.id?'Modifier le plan':'Nouveau plan'}</h3>{!plan.id?<label>Code<input required pattern="[a-z0-9_-]+" value={plan.code} onChange={e=>setPlan({...plan,code:e.target.value})}/></label>:null}<label>Nom<input required value={plan.name} onChange={e=>setPlan({...plan,name:e.target.value})}/></label><div><strong>Modules</strong>{features(plan.features,value=>setPlan({...plan,features:value}))}</div><label>Appareils maximum (total)<input min="1" type="number" value={plan.default_device_limit} onChange={e=>setPlan({...plan,default_device_limit:Math.max(1,Number(e.target.value)||1)})}/></label><label>Desktop POS maximum<input min="0" type="number" value={plan.default_desktop_device_limit??''} placeholder="Sans limite de canal" onChange={e=>setPlan({...plan,default_desktop_device_limit:e.target.value===''?null:Math.max(0,Number(e.target.value)||0)})}/></label><label>Web maximum<input min="0" type="number" value={plan.default_web_device_limit??''} placeholder="Sans limite de canal" onChange={e=>setPlan({...plan,default_web_device_limit:e.target.value===''?null:Math.max(0,Number(e.target.value)||0)})}/></label><label>Mobile / PWA maximum<input min="0" type="number" value={plan.default_mobile_device_limit??''} placeholder="Sans limite de canal" onChange={e=>setPlan({...plan,default_mobile_device_limit:e.target.value===''?null:Math.max(0,Number(e.target.value)||0)})}/></label><label><input checked={plan.offline_validity_days===null} onChange={e=>setPlan({...plan,offline_validity_days:e.target.checked?null:30})} type="checkbox"/> Hors ligne permanent</label>{plan.offline_validity_days!==null?<label>Validation periodique hors ligne (jours)<input min="1" type="number" value={plan.offline_validity_days} onChange={e=>setPlan({...plan,offline_validity_days:Math.max(1,Number(e.target.value)||1)})}/></label>:<small>Aucune connexion periodique n'est requise. Une suspension ou revocation Vendor sera appliquee lors de la prochaine validation en ligne.</small>}<div className="modal-actions"><button className="button secondary" type="button" onClick={()=>setModal(null)}>Annuler</button><button className="button">Enregistrer</button></div></form>:null}
      {modal==='license'?<form onSubmit={submitLicense}><h3>Nouvelle licence</h3><label>Business<select required value={license.vendor_business_id} onChange={e=>setLicense({...license,vendor_business_id:e.target.value})}><option value="">Selectionner</option>{businesses.filter(item=>item.status==='active').map(item=><option key={item.id} value={item.id}>{item.customer_name} - {item.name}</option>)}</select></label><label>Plan<select required value={license.plan_id} onChange={e=>{const selected=plans.find(item=>item.id===e.target.value);setLicense({...license,plan_id:e.target.value,offline_validity_days:selected?.offline_validity_days??null})}}><option value="">Selectionner</option>{plans.filter(item=>item.active!==false).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><fieldset className="vendor-policy-field"><legend>Duree de la licence</legend><label><input checked={license.duration==='lifetime'} name="license-duration" onChange={()=>setLicense({...license,duration:'lifetime'})} type="radio"/> À vie</label><label><input checked={license.duration==='custom'} name="license-duration" onChange={()=>setLicense({...license,duration:'custom'})} type="radio"/> Date d'expiration</label>{license.duration==='custom'?<label>Date d'expiration<input required type="datetime-local" value={license.custom_expires_at} onChange={e=>setLicense({...license,custom_expires_at:e.target.value})}/></label>:null}</fieldset><fieldset className="vendor-policy-field"><legend>Fonctionnement hors ligne</legend><label><input checked={license.offline_validity_days===null} name="license-offline" onChange={()=>setLicense({...license,offline_validity_days:null})} type="radio"/> Permanent</label><label><input checked={license.offline_validity_days!==null} name="license-offline" onChange={()=>setLicense({...license,offline_validity_days:30})} type="radio"/> Limité</label>{license.offline_validity_days!==null?<label>Durée hors ligne (jours)<input min="1" required type="number" value={license.offline_validity_days} onChange={e=>setLicense({...license,offline_validity_days:Math.max(1,Number(e.target.value)||1)})}/></label>:null}</fieldset><label>Notes<textarea value={license.notes} onChange={e=>setLicense({...license,notes:e.target.value})}/></label><div className="modal-actions"><button className="button secondary" type="button" onClick={()=>setModal(null)}>Annuler</button><button className="button">Creer la licence</button></div></form>:null}
      {modal==='renew'?<form onSubmit={submitRenew}><h3>Modifier la licence</h3><p><strong>{renewTarget?.vendor_business_name}</strong> - {renewTarget?.customer_name}</p><fieldset className="vendor-policy-field"><legend>Duree de la licence</legend><label><input checked={renewDuration==='lifetime'} name="renew-duration" onChange={()=>setRenewDuration('lifetime')} type="radio"/> À vie</label><label><input checked={renewDuration==='custom'} name="renew-duration" onChange={()=>setRenewDuration('custom')} type="radio"/> Date d'expiration</label>{renewDuration==='custom'?<label>Date d'expiration<input required type="datetime-local" value={renewCustom} onChange={e=>setRenewCustom(e.target.value)}/></label>:null}</fieldset><fieldset className="vendor-policy-field"><legend>Fonctionnement hors ligne</legend><label><input checked={renewOfflineDays===null} name="renew-offline" onChange={()=>setRenewOfflineDays(null)} type="radio"/> Permanent</label><label><input checked={renewOfflineDays!==null} name="renew-offline" onChange={()=>setRenewOfflineDays(30)} type="radio"/> Limité</label>{renewOfflineDays!==null?<label>Durée hors ligne (jours)<input min="1" required type="number" value={renewOfflineDays} onChange={e=>setRenewOfflineDays(Math.max(1,Number(e.target.value)||1))}/></label>:null}</fieldset><div className="modal-actions"><button className="button secondary" type="button" onClick={()=>{setRenewTarget(null);setModal(null)}}>Annuler</button><button className="button">Enregistrer</button></div></form>:null}
    </div></div>:null}

    {oneTime?<div className="modal-backdrop"><div className="modal-content vendor-key-modal"><h3>Codes generes - affiches une seule fois</h3><p>Copiez-les maintenant. Le Vendor Console ne stocke jamais leur version lisible.</p>{oneTime.businessName?<p><strong>{oneTime.customerName??''}</strong>{oneTime.customerName?' - ':''}{oneTime.businessName}</p>:null}{oneTime.provisioningKey?<><h4>Code d'installation client</h4><p>A envoyer au client pour la page /provision. Expiration: {date(oneTime.provisioningExpiresAt)}</p><code>{oneTime.provisioningKey}</code><div className="modal-actions"><button className="button secondary" onClick={()=>void navigator.clipboard.writeText(oneTime.provisioningKey!)}>Copier le code client</button></div></>:null}{oneTime.licenseKey?<><h4>Code d'activation {oneTime.activationChannel??'desktop'}</h4><p>Usage unique. Expiration: {date(oneTime.activationExpiresAt)}. Une fois utilise, ce code ne sera plus accepte.</p><code>{oneTime.licenseKey}</code><div className="modal-actions"><button className="button secondary" onClick={()=>void navigator.clipboard.writeText(oneTime.licenseKey!)}>Copier le code d'activation</button></div></>:null}<div className="modal-actions"><button className="button secondary" onClick={()=>download('CorePOS-codes-client.txt',`${oneTime.customerName??''}\n${oneTime.businessName??''}\n${oneTime.provisioningKey?`Provisioning (usage unique): ${oneTime.provisioningKey}\n`:''}${oneTime.licenseKey?`Activation ${oneTime.activationChannel??'desktop'} (usage unique): ${oneTime.licenseKey}\n`:''}`)}>Telecharger .txt</button><button className="button" onClick={()=>setOneTime(null)}>J'ai conserve les codes</button></div></div></div>:null}
  </main>
}
