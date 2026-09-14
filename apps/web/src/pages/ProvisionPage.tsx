import { useState,type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check,ChevronLeft,ChevronRight } from 'lucide-react'
import { provisionBusiness,resolveProvisioningKey,type ProvisionResolution } from '../api/core-v2'
import type {BusinessType,FeatureKey} from '../types'
import { getApiErrorMessage } from '../utils/format'
import {recommendedModules} from '../components/businessTypeConfig'
import {useI18n,type Language} from '../i18n'
import {setWorkspaceSlug} from '../api/tenant'

const modules:FeatureKey[]=['pos','inventory','barcode','suppliers','purchases','customers','tables','qr_menu','kitchen','takeaway','delivery','reservations','product_variants','modifiers','weighted_products','expiry_tracking']

export default function ProvisionPage(){
  const {t,language,setLanguage}=useI18n()
  const navigate=useNavigate()
  const [step,setStep]=useState(1)
  const [error,setError]=useState<string|null>(null)
  const [submitting,setSubmitting]=useState(false)
  const [provisioningKey,setProvisioningKey]=useState('')
  const [resolution,setResolution]=useState<ProvisionResolution|null>(null)
  const [resolving,setResolving]=useState(false)

  const [business,setBusiness]=useState({
    name:'',
    phone:'',
    address:'',
    currency:'MAD',
    locale:'fr-MA',
    timezone:'Africa/Casablanca',
    business_type:'retail' as BusinessType
  })

  const [features,setFeatures]=useState<FeatureKey[]>(
    recommendedModules.retail
  )

  const [patron,setPatron]=useState({
    name:'',
    email:'',
    password:'',
    passwordConfirmation:''
  })

  async function resolveKey(){
    setResolving(true)
    setError(null)

    try{
      const resolved=
        await resolveProvisioningKey(
          provisioningKey.trim()
        )

      setResolution(resolved)

      setBusiness(value=>({
        ...value,
        business_type:
          resolved.business_type
      }))

      setFeatures(
        resolved.allowed_features
      )

      setStep(2)
    }
    catch(value){
      setResolution(null)

      setError(
        getApiErrorMessage(value)
      )
    }
    finally{
      setResolving(false)
    }
  }

  const toggle=(feature:FeatureKey)=>{
    setFeatures(value=>
      value.includes(feature)
        ?value.filter(
          current=>current!==feature
        )
        :[...value,feature]
    )
  }

  async function finish(event:FormEvent){
    event.preventDefault()

    if(
      patron.password!==
      patron.passwordConfirmation
    ){
      setError(
        t('setup.passwordMismatch')
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try{
      const provisioned=await provisionBusiness({
        provisioning_key:
          provisioningKey.trim(),

        setup:{
          business:{
            ...business,
            logo:null
          },

          enabled_features:
            features,

          admin:{
            name:patron.name,
            email:patron.email,
            password:patron.password
          }
        }
      })

      if(provisioned.tenant?.slug){
        setWorkspaceSlug(provisioned.tenant.slug)
      }

      navigate(
        provisioned.tenant?.slug
          ?`/login?workspace=${encodeURIComponent(provisioned.tenant.slug)}`
          :'/login',
        {replace:true}
      )
    }
    catch(value){
      setError(
        getApiErrorMessage(value)
      )
    }
    finally{
      setSubmitting(false)
    }
  }

  return <main className="setup-page">
    <section className="setup-shell">
      <header className="setup-header">
        <div className="product-lockup">
          <span className="brand-mark">CP</span>
          <div>
            <strong>CorePOS</strong>
            <small>{t('provision.brand')}</small>
          </div>
        </div>

        <label className="language-selector"><span className="sr-only">{t('language.label')}</span><select aria-label={t('language.label')} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select></label>
        <span>{t('setup.step',{step})}</span>
      </header>

      <div className="setup-progress">
        {[1,2,3,4,5].map(value=>
          <i
            className={
              value<=step
                ?'active'
                :''
            }
            key={value}
          />
        )}
      </div>

      <form onSubmit={finish}>
        <div className="setup-content">

          {step===1?<>
            <h1>
              {t('provision.activateTitle')}
            </h1>

            <p>
              {t('provision.activateHelp')}
            </p>

            <div className="form-grid setup-grid">
              <label>
                {t('provision.key')}
                <input
                  autoComplete="off"
                  minLength={20}
                  required
                  spellCheck={false}
                  type="password"
                  value={provisioningKey}
                  onChange={event=>{
                    setProvisioningKey(
                      event.target.value
                    )
                    setResolution(null)
                    setError(null)
                  }}
                />
              </label>

              <label>
                {t('setup.businessName')}
                <input
                  required
                  value={business.name}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      name:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('common.phone')}
                <input
                  value={business.phone}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      phone:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('setup.address')}
                <input
                  value={business.address}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      address:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('setup.currency')}
                <input
                  maxLength={3}
                  required
                  value={business.currency}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      currency:
                        event.target.value.toUpperCase()
                    }))
                  }
                />
              </label>

              <label>
                {t('language.label')}
                <select
                  value={business.locale}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      locale:event.target.value
                    }))
                  }
                >
                  <option value="fr-MA">
                    {t('language.fr')}
                  </option>
                  <option value="ar-MA">
                    {t('language.ar')}
                  </option>
                  <option value="en-US">
                    {t('language.en')}
                  </option>
                </select>
              </label>

              <label>
                {t('setup.timezone')}
                <input
                  required
                  value={business.timezone}
                  onChange={event=>
                    setBusiness(value=>({
                      ...value,
                      timezone:event.target.value
                    }))
                  }
                />
              </label>
            </div>

            {error
              ?<p className="error-message">
                {error}
              </p>
              :null}
          </>:null}

          {step===2?<>
            <h1>
              {t('provision.authorizedTitle')}
            </h1>

            <p>
              {t('provision.authorizedHelp')}
            </p>

            <div className="setup-summary">
              <div>
                <small>{t('provision.vendorBusiness')}</small>
                <strong>
                  {
                    resolution
                      ?.vendor_business_name
                      ??business.name
                  }
                </strong>
              </div>

              <div>
                <small>{t('setup.summaryType')}</small>
                <strong>
                  {
                    t(`businessType.${business.business_type}.title`)
                  }
                </strong>
              </div>

              <div>
                <small>{t('provision.plan')}</small>
                <strong>
                  {
                    resolution?.plan
                      ??t('provision.customPlan')
                  }
                </strong>
              </div>
            </div>
          </>:null}

          {step===3?<>
            <h1>
              {t('provision.modulesTitle')}
            </h1>

            <p>
              {t('provision.modulesHelp')}
            </p>

            <div className="module-grid">
              {modules.filter(module=>resolution?.allowed_features.includes(module)).map(module=>
                <label
                  className="module-option"
                  key={module}
                >
                  <input
                    checked={
                      features.includes(
                        module
                      )
                    }
                    onChange={()=>
                      toggle(module)
                    }
                    type="checkbox"
                  />

                  <span>
                    {t(`module.${module}.label`)}
                  </span>
                </label>
              )}
            </div>
          </>:null}

          {step===4?<>
            <h1>
              {t('provision.patronTitle')}
            </h1>

            <p>
              {t('provision.patronHelp')}
            </p>

            <div className="form-grid setup-grid">
              <label>
                {t('setup.fullName')}
                <input
                  required
                  value={patron.name}
                  onChange={event=>
                    setPatron(value=>({
                      ...value,
                      name:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('setup.emailId')}
                <input
                  required
                  type="email"
                  value={patron.email}
                  onChange={event=>
                    setPatron(value=>({
                      ...value,
                      email:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('setup.password')}
                <input
                  minLength={8}
                  required
                  type="password"
                  value={patron.password}
                  onChange={event=>
                    setPatron(value=>({
                      ...value,
                      password:event.target.value
                    }))
                  }
                />
              </label>

              <label>
                {t('setup.passwordConfirm')}
                <input
                  minLength={8}
                  required
                  type="password"
                  value={
                    patron.passwordConfirmation
                  }
                  onChange={event=>
                    setPatron(value=>({
                      ...value,
                      passwordConfirmation:
                        event.target.value
                    }))
                  }
                />

                {
                  patron.passwordConfirmation&&
                  patron.password!==
                    patron.passwordConfirmation
                    ?<small className="field-error">
                      {t('setup.passwordMismatch')}
                    </small>
                    :null
                }
              </label>
            </div>
          </>:null}

          {step===5?<>
            <h1>
              {t('provision.confirmTitle')}
            </h1>

            <p>
              {t('provision.confirmHelp')}
            </p>

            <div className="setup-summary">
              <div>
                <small>{t('setup.summaryBusiness')}</small>
                <strong>
                  {business.name}
                </strong>
              </div>

              <div>
                <small>{t('setup.summaryType')}</small>
                <strong>
                  {
                    t(`businessType.${business.business_type}.title`)
                  }
                </strong>
              </div>

              <div>
                <small>{t('provision.patron')}</small>
                <strong>
                  {patron.name}
                </strong>
              </div>

              <div>
                <small>{t('setup.summaryModules')}</small>
                <strong>
                  {t('setup.activeCount',{count:features.length})}
                </strong>
              </div>

              <div>
                <small>{t('provision.license')}</small>
                <strong>
                  {t('provision.licenseSummary')}
                </strong>
              </div>
            </div>

            {error
              ?<p className="error-message">
                {error}
              </p>
              :null}
          </>:null}

        </div>

        <footer className="setup-actions">
          <button
            className="button secondary"
            disabled={
              step===1||
              submitting
            }
            onClick={()=>
              setStep(value=>value-1)
            }
            type="button"
          >
            <ChevronLeft size={18}/>
            {t('setup.back')}
          </button>

          {step<5
            ?<button
              className="button"
              disabled={
                resolving||
                (
                  step===1&&(
                    provisioningKey
                      .trim()
                      .length<20||
                    !business.name
                  )
                )||
                (
                  step===3&&
                  !features.length
                )||
                (
                  step===4&&(
                    !patron.name||
                    !patron.email||
                    patron.password.length<8||
                    patron.password!==
                      patron.passwordConfirmation
                  )
                )
              }
              onClick={()=>{
                if(step===1){
                  void resolveKey()
                  return
                }

                setStep(value=>value+1)
              }}
              type="button"
            >
              {step===1
                ?resolving
                  ?t('provision.verifying')
                  :t('provision.verifyContinue')
                :t('setup.continue')}
              <ChevronRight size={18}/>
            </button>
            :<button
              className="button"
              disabled={submitting}
              type="submit"
            >
              <Check size={18}/>

              {submitting
                ?t('provision.provisioning')
                :t('setup.createSpace')}
            </button>}
        </footer>
      </form>
    </section>
  </main>
}
