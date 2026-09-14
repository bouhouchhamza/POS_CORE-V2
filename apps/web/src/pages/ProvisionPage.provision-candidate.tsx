import { useState,type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check,ChevronLeft,ChevronRight } from 'lucide-react'
import { provisionBusiness } from '../api/core-v2.provision-candidate'
import type {BusinessType,FeatureKey} from '../types'
import { getApiErrorMessage } from '../utils/format'
import BusinessTypeSelector from '../components/BusinessTypeSelector'
import {businessTypeLabel,recommendedModules} from '../components/businessTypeConfig'

const modules:Array<{id:FeatureKey;label:string}>=[
  {id:'pos' as FeatureKey,label:'POS / Point de vente'},
  {id:'inventory' as FeatureKey,label:'Stock'},
  {id:'barcode' as FeatureKey,label:'Code-barres'},
  {id:'suppliers' as FeatureKey,label:'Fournisseurs'},
  {id:'purchases' as FeatureKey,label:'Achats'},
  {id:'customers' as FeatureKey,label:'Clients'},
  {id:'tables' as FeatureKey,label:'Tables'},
  {id:'qr_menu' as FeatureKey,label:'QR Menu'},
  {id:'kitchen' as FeatureKey,label:'Cuisine'},
  {id:'takeaway' as FeatureKey,label:'Takeaway'},
  {id:'delivery' as FeatureKey,label:'Livraison'},
  {id:'reservations' as FeatureKey,label:'Reservations'},
  {id:'product_variants' as FeatureKey,label:'Variantes produits'},
  {id:'modifiers' as FeatureKey,label:'Modificateurs'},
  {id:'weighted_products' as FeatureKey,label:'Produits au poids'},
  {id:'expiry_tracking' as FeatureKey,label:'Suivi des expirations'}
]

export default function ProvisionPage(){
  const navigate=useNavigate()
  const [step,setStep]=useState(1)
  const [error,setError]=useState<string|null>(null)
  const [submitting,setSubmitting]=useState(false)
  const [provisioningKey,setProvisioningKey]=useState('')

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

  const chooseType=(business_type:BusinessType)=>{
    setBusiness(value=>({
      ...value,
      business_type
    }))

    setFeatures(
      recommendedModules[business_type]
    )
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
        'Les mots de passe ne correspondent pas.'
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try{
      await provisionBusiness({
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

      navigate(
        '/login',
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
          <span className="brand-mark">BP</span>
          <div>
            <strong>Bimik POS</strong>
            <small>Provisionnement commercial</small>
          </div>
        </div>

        <span>
          Etape {step} / 5
        </span>
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
              Activer votre espace
            </h1>

            <p>
              Saisissez la cle de provisionnement
              fournie par votre fournisseur.
              Elle reste uniquement en memoire
              pendant cette operation.
            </p>

            <div className="form-grid setup-grid">
              <label>
                Cle de provisionnement
                <input
                  autoComplete="off"
                  minLength={20}
                  required
                  spellCheck={false}
                  type="password"
                  value={provisioningKey}
                  onChange={event=>
                    setProvisioningKey(
                      event.target.value
                    )
                  }
                />
              </label>

              <label>
                Nom de l'entreprise
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
                Telephone
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
                Adresse
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
                Devise
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
                Langue
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
                    Francais
                  </option>
                  <option value="ar-MA">
                    Arabe
                  </option>
                  <option value="en-US">
                    English
                  </option>
                </select>
              </label>

              <label>
                Fuseau horaire
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
          </>:null}

          {step===2?<>
            <h1>
              Type de commerce
            </h1>

            <p>
              Le type doit correspondre au
              Vendor Business associe a la licence.
            </p>

            <BusinessTypeSelector
              value={business.business_type}
              onChange={chooseType}
            />
          </>:null}

          {step===3?<>
            <h1>
              Modules actifs
            </h1>

            <p>
              Le serveur refusera tout module
              absent de la licence.
            </p>

            <div className="module-grid">
              {modules.map(module=>
                <label
                  className="module-option"
                  key={module.id}
                >
                  <input
                    checked={
                      features.includes(
                        module.id
                      )
                    }
                    onChange={()=>
                      toggle(module.id)
                    }
                    type="checkbox"
                  />

                  <span>
                    {module.label}
                  </span>
                </label>
              )}
            </div>
          </>:null}

          {step===4?<>
            <h1>
              Compte Patron
            </h1>

            <p>
              Ce compte sera le premier
              utilisateur du commerce.
            </p>

            <div className="form-grid setup-grid">
              <label>
                Nom complet
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
                Email / identifiant
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
                Mot de passe
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
                Confirmer le mot de passe
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
                      Les mots de passe
                      ne correspondent pas.
                    </small>
                    :null
                }
              </label>
            </div>
          </>:null}

          {step===5?<>
            <h1>
              Confirmer le provisionnement
            </h1>

            <p>
              La creation ne sera validee
              qu'apres verification de la licence,
              du Vendor Business et des modules.
            </p>

            <div className="setup-summary">
              <div>
                <small>Entreprise</small>
                <strong>
                  {business.name}
                </strong>
              </div>

              <div>
                <small>Type</small>
                <strong>
                  {
                    businessTypeLabel(
                      business.business_type
                    )
                  }
                </strong>
              </div>

              <div>
                <small>Patron</small>
                <strong>
                  {patron.name}
                </strong>
              </div>

              <div>
                <small>Modules</small>
                <strong>
                  {features.length} actifs
                </strong>
              </div>

              <div>
                <small>Licence</small>
                <strong>
                  Cle de provisionnement fournie
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
            Retour
          </button>

          {step<5
            ?<button
              className="button"
              disabled={
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
              onClick={()=>
                setStep(value=>value+1)
              }
              type="button"
            >
              Continuer
              <ChevronRight size={18}/>
            </button>
            :<button
              className="button"
              disabled={submitting}
              type="submit"
            >
              <Check size={18}/>

              {submitting
                ?'Provisionnement...'
                :'Creer mon espace'}
            </button>}
        </footer>
      </form>
    </section>
  </main>
}
