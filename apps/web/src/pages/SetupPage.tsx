import { useEffect,useState,type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check,ChevronLeft,ChevronRight } from 'lucide-react'
import { completeSetup } from '../api/core-v2'
import type {BusinessType,FeatureKey} from '../types'
import { getApiErrorMessage } from '../utils/format'
import {commercialCertificateSchema} from '@bimik/validation'
import {getLicenseStatus} from '../api/license'
import {featureKeys} from '@bimik/shared-types'

import {useI18n,type Language} from '../i18n'

const modules=featureKeys

export default function SetupPage(){
  const {t,language,setLanguage}=useI18n()
  const navigate=useNavigate(),[step,setStep]=useState(1),[error,setError]=useState<string|null>(null),[submitting,setSubmitting]=useState(false)
  const [business,setBusiness]=useState({name:'',logo:null as string|null,phone:'',address:'',currency:'MAD',locale:'fr-MA',timezone:'Africa/Casablanca',business_type:'' as BusinessType}),[features,setFeatures]=useState<FeatureKey[]>([]),[admin,setAdmin]=useState({name:'',email:'',password:'',passwordConfirmation:''})
  const [entitlements,setEntitlements]=useState<FeatureKey[]>([])
  useEffect(()=>{let active=true;void getLicenseStatus().then(status=>{
    const certificate=commercialCertificateSchema.safeParse(status.certificate);
    if(!active)return;
    if(status.status!=='active'||!certificate.success){navigate('/license',{replace:true});return}
    setBusiness(current=>({...current,business_type:certificate.data.business_type}));
    setFeatures(certificate.data.features);setEntitlements(certificate.data.features);
  }).catch(value=>{if(active)setError(getApiErrorMessage(value))});return()=>{active=false}},[navigate])

  const toggle=(id:FeatureKey)=>setFeatures(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id])
  const logo=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>setBusiness(x=>({...x,logo:String(reader.result)}));reader.readAsDataURL(file)}
  async function finish(e:FormEvent){e.preventDefault();setSubmitting(true);setError(null);try{await completeSetup({business,enabled_features:features,admin:{name:admin.name,email:admin.email,password:admin.password}});navigate('/login',{replace:true})}catch(err){setError(getApiErrorMessage(err))}finally{setSubmitting(false)}}
  return <main className="setup-page"><section className="setup-shell"><header className="setup-header"><div className="product-lockup"><span className="brand-mark">CP</span><div><strong>CorePOS</strong><small>{t('brand.subtitle')}</small></div></div><label className="language-selector"><span className="sr-only">{t('language.label')}</span><select aria-label={t('language.label')} value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select></label><span>{t('setup.step',{step})}</span></header><div className="setup-progress">{[1,2,3,4,5].map(x=><i className={x<=step?'active':''} key={x}/>)}</div>
  <form onSubmit={finish}><div className="setup-content">
    {step===1?<><h1>{t('setup.configureTitle')}</h1><p>{t('setup.configureHelp')}</p><div className="form-grid setup-grid"><label>{t('setup.businessName')}<input required value={business.name} onChange={e=>setBusiness(x=>({...x,name:e.target.value}))}/></label><label>{t('setup.logoOptional')}<input accept="image/*" type="file" onChange={e=>logo(e.target.files?.[0])}/></label><label>{t('common.phone')}<input value={business.phone} onChange={e=>setBusiness(x=>({...x,phone:e.target.value}))}/></label><label>{t('setup.address')}<input value={business.address} onChange={e=>setBusiness(x=>({...x,address:e.target.value}))}/></label><label>{t('setup.currency')}<input maxLength={3} required value={business.currency} onChange={e=>setBusiness(x=>({...x,currency:e.target.value.toUpperCase()}))}/></label><label>{t('language.label')}<select value={business.locale} onChange={e=>setBusiness(x=>({...x,locale:e.target.value}))}><option value="fr-MA">{t('language.fr')}</option><option value="ar-MA">{t('language.ar')}</option><option value="en-US">{t('language.en')}</option></select></label><label>{t('setup.timezone')}<input required value={business.timezone} onChange={e=>setBusiness(x=>({...x,timezone:e.target.value}))}/></label></div></>:null}
    {step===2?<><h1>{t('setup.chooseTypeTitle')}</h1><p>{t('license.typeBound')}</p><input readOnly value={business.business_type?t(`businessType.${business.business_type}.title`):t('license.typeDetermined')}/></>:null}
    {step===3?<><h1>{t('setup.modulesTitle')}</h1><p>{t('setup.modulesHelp')}</p><div className="module-grid">{modules.filter(id=>entitlements.includes(id)).map(id=><label className="module-option" key={id}><input checked={features.includes(id)} onChange={()=>toggle(id)} type="checkbox"/><span>{t(`module.${id}.label`)}</span></label>)}</div></>:null}
    {step===4?<><h1>{t('setup.adminTitle')}</h1><p>{t('setup.adminHelp')}</p><div className="form-grid setup-grid"><label>{t('setup.fullName')}<input required value={admin.name} onChange={e=>setAdmin(x=>({...x,name:e.target.value}))}/></label><label>{t('setup.emailId')}<input required type="email" value={admin.email} onChange={e=>setAdmin(x=>({...x,email:e.target.value}))}/></label><label>{t('setup.password')}<input minLength={8} required type="password" value={admin.password} onChange={e=>setAdmin(x=>({...x,password:e.target.value}))}/></label><label>{t('setup.passwordConfirm')}<input minLength={8} required type="password" value={admin.passwordConfirmation} onChange={e=>setAdmin(x=>({...x,passwordConfirmation:e.target.value}))}/>{admin.passwordConfirmation&&admin.password!==admin.passwordConfirmation?<small className="field-error">{t('setup.passwordMismatch')}</small>:null}</label></div></>:null}
    {step===5?<><h1>{t('setup.readyTitle')}</h1><p>{t('setup.readyHelp')}</p><div className="setup-summary"><div><small>{t('setup.summaryBusiness')}</small><strong>{business.name}</strong></div><div><small>{t('setup.summaryType')}</small><strong>{t(`businessType.${business.business_type}.title`)}</strong></div><div><small>{t('setup.summaryAdmin')}</small><strong>{admin.name}</strong></div><div><small>{t('setup.summaryModules')}</small><strong>{t('setup.activeCount',{count:features.length})}</strong></div></div>{error?<p className="error-message">{error}</p>:null}</>:null}
  </div><footer className="setup-actions"><button className="button secondary" disabled={step===1||submitting} onClick={()=>setStep(x=>x-1)} type="button"><ChevronLeft size={18}/>{t('setup.back')}</button>{step<5?<button className="button" disabled={!business.business_type||(step===1&&!business.name)||(step===3&&!features.length)||(step===4&&(!admin.name||!admin.email||admin.password.length<8||admin.password!==admin.passwordConfirmation))} onClick={()=>setStep(x=>x+1)} type="button">{t('setup.continue')}<ChevronRight size={18}/></button>:<button className="button" disabled={submitting} type="submit"><Check size={18}/>{t(submitting?'setup.creating':'setup.createSpace')}</button>}</footer></form></section></main>
}
