import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { businessTypes, featureKeys, type FeatureKey } from '@corepos/shared-types'
import { vendorApi } from '../api/license'

type Language = 'fr' | 'en' | 'ar'
type Section = 'dashboard' | 'businesses' | 'licenses' | 'devices' | 'administration'
type AdministrationTab = 'plans' | 'activation-codes' | 'activations' | 'audit'
type LifecycleState = 'PROVISIONING' | 'PROVISIONING_FAILED' | 'READY_FOR_ACTIVATION' | 'BLOCKED'

type Business = {
  id: string
  name: string
  business_type: string
  status: string
  customer_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  notes?: string | null
  created_at?: string
  license_id?: string | null
  license_status?: string | null
  license_expires_at?: string | null
  plan_name?: string | null
  max_devices?: number | null
  active_devices?: number | null
  lifecycle_state: LifecycleState
  readiness_reason?: string | null
}

type License = {
  id: string
  vendor_business_id: string
  vendor_business_name?: string | null
  customer_name?: string | null
  plan_name?: string | null
  plan_code?: string | null
  status: string
  expires_at?: string | null
  offline_validity_days?: number | null
  max_devices: number
  active_devices?: number
  lifecycle_state: LifecycleState
  readiness_reason?: string | null
}

type Device = {
  id: string
  license_id: string
  vendor_business_name?: string | null
  customer_name?: string | null
  device_name?: string | null
  channel?: string | null
  platform?: string | null
  status: string
  app_version?: string | null
  activated_at?: string | null
  last_seen_at?: string | null
  last_validated_at?: string | null
}

type Plan = {
  id: string
  name: string
  code: string
  features?: FeatureKey[]
  default_device_limit: number
  default_desktop_device_limit?: number | null
  default_web_device_limit?: number | null
  default_mobile_device_limit?: number | null
  offline_validity_days?: number | null
  active: boolean
}

type PlanForm = {
  code: string
  name: string
  features: FeatureKey[]
  default_device_limit: number
  default_desktop_device_limit: number | null
  default_web_device_limit: number | null
  default_mobile_device_limit: number | null
  offline_validity_days: number | null
  active: boolean
}

type Audit = { id: string; created_at?: string; actor?: string; action?: string; entity_type?: string; entity_id?: string; description?: string }
type ActivationCode = { id: string; vendor_business_name?: string; customer_name?: string; activation_status?: string; key_hint?: string; expires_at?: string; consumed_at?: string | null }
type Dashboard = { businesses: { count: number; attention: number; ready: number }; licenses: { active: number }; devices: { active: number } }
type CodeResult = { activation_code: string; expires_at?: string | null; vendor_business_name?: string; customer_name?: string }

type Onboarding = {
  customer_name: string; customer_email: string; customer_phone: string; customer_notes: string
  business_name: string; business_type: string; address: string; currency: string; locale: string; timezone: string
  owner_name: string; owner_email: string; owner_password: string
  plan_id: string; duration: 'lifetime' | 'custom'; custom_expires_at: string; offline_validity_days: number | null
}

type BusinessEdit = {
  name: string
  business_type: string
  status: 'active' | 'suspended' | 'closed'
  notes: string
}

const emptyOnboarding: Onboarding = {
  customer_name: '', customer_email: '', customer_phone: '', customer_notes: '',
  business_name: '', business_type: 'retail', address: '', currency: 'MAD', locale: 'fr-MA', timezone: 'Africa/Casablanca',
  owner_name: '', owner_email: '', owner_password: '', plan_id: '', duration: 'lifetime', custom_expires_at: '', offline_validity_days: null,
}

const emptyPlanForm: PlanForm = {
  code: '', name: '', features: ['pos'], default_device_limit: 1,
  default_desktop_device_limit: null, default_web_device_limit: null, default_mobile_device_limit: null,
  offline_validity_days: null, active: true,
}

const copy = {
  fr: {
    dashboard: 'Tableau de bord', businesses: 'Entreprises', licenses: 'Licences', devices: 'Appareils', administration: 'Administration',
    createBusiness: 'Nouvelle entreprise', refresh: 'Actualiser', signOut: 'Déconnexion', view: 'Voir', overview: 'Vue d’ensemble', activity: 'Activité',
    ready: 'Prête pour l’activation', provisioning: 'Préparation', failed: 'Préparation à reprendre', blocked: 'Bloquée',
    generate: 'Générer le code d’activation', regenerate: 'Régénérer le code', retry: 'Réessayer la préparation', copyCode: 'Copier le code', done: 'Terminé',
    business: 'Entreprise', licence: 'Licence', deviceUsage: 'Appareils', status: 'Statut', plan: 'Plan', created: 'Créée le', expires: 'Expiration',
    noBusinesses: 'Aucune entreprise pour le moment.', noLicenses: 'Aucune licence.', noDevices: 'Aucun appareil activé.', noActivity: 'Aucune activité enregistrée.',
    createTitle: 'Nouvelle entreprise', createHelp: 'CorePOS prépare l’entreprise, le compte propriétaire et la licence en interne. Le client recevra uniquement un code d’activation.',
    contact: 'Contact', owner: 'Compte propriétaire', commercial: 'Licence commerciale', save: 'Créer et préparer', cancel: 'Annuler',
    name: 'Nom', email: 'E-mail', phone: 'Téléphone', password: 'Mot de passe initial', address: 'Adresse', currency: 'Devise', language: 'Langue', timezone: 'Fuseau horaire', type: 'Type de commerce',
    businessCreated: 'Entreprise créée. CorePOS termine sa préparation interne.', businessReady: 'Entreprise prête. Générez le code d’activation à remettre au client.',
    codeTitle: 'Code d’activation appareil', codeShownOnce: 'Ce code n’est affiché qu’une fois. Conservez-le ou transmettez-le au client de façon sécurisée.',
    active: 'Active', disabled: 'Désactivée', suspended: 'Suspendue', closed: 'Fermée', revoked: 'Révoquée', expired: 'Expirée', available: 'Disponible', consumed: 'Utilisé', suspend: 'Désactiver', reactivate: 'Réactiver', revoke: 'Révoquer', editBusiness: 'Modifier l’entreprise', saveChanges: 'Enregistrer', notes: 'Notes', devicesTitle: 'Appareils activés', codeUnavailable: 'Le code précédent n’est plus disponible. Générez-en un nouveau si nécessaire.',
    plans: 'Plans', codes: 'Codes', activations: 'Activations', audit: 'Audit', search: 'Rechercher une entreprise', noMatches: 'Aucune entreprise correspondante.', newPlan: 'Nouveau plan', editPlan: 'Modifier le plan', modules: 'Modules inclus', deviceLimit: 'Limite d’appareils', offlineDays: 'Jours hors ligne (facultatif)', planCode: 'Code du plan',
  },
  en: {
    dashboard: 'Dashboard', businesses: 'Businesses', licenses: 'Licences', devices: 'Devices', administration: 'Administration',
    createBusiness: 'New business', refresh: 'Refresh', signOut: 'Sign out', view: 'View', overview: 'Overview', activity: 'Activity',
    ready: 'Ready for activation', provisioning: 'Preparing', failed: 'Preparation needs attention', blocked: 'Blocked',
    generate: 'Generate activation code', regenerate: 'Regenerate code', retry: 'Retry preparation', copyCode: 'Copy code', done: 'Done',
    business: 'Business', licence: 'Licence', deviceUsage: 'Devices', status: 'Status', plan: 'Plan', created: 'Created', expires: 'Expiry',
    noBusinesses: 'No businesses yet.', noLicenses: 'No licences yet.', noDevices: 'No activated devices yet.', noActivity: 'No activity recorded yet.',
    createTitle: 'New business', createHelp: 'CorePOS prepares the business, owner account, and licence internally. The customer receives only an activation code.',
    contact: 'Contact', owner: 'Owner account', commercial: 'Commercial licence', save: 'Create and prepare', cancel: 'Cancel',
    name: 'Name', email: 'Email', phone: 'Phone', password: 'Initial password', address: 'Address', currency: 'Currency', language: 'Language', timezone: 'Time zone', type: 'Business type',
    businessCreated: 'Business created. CorePOS is completing its internal preparation.', businessReady: 'Business ready. Generate the activation code for the customer.',
    codeTitle: 'Device activation code', codeShownOnce: 'This code is displayed once. Store it or send it securely to the customer.',
    active: 'Active', disabled: 'Disabled', suspended: 'Suspended', closed: 'Closed', revoked: 'Revoked', expired: 'Expired', available: 'Available', consumed: 'Used', suspend: 'Disable', reactivate: 'Reactivate', revoke: 'Revoke', editBusiness: 'Edit business', saveChanges: 'Save changes', notes: 'Notes', devicesTitle: 'Activated devices', codeUnavailable: 'The previous code is no longer available. Generate a new one if needed.',
    plans: 'Plans', codes: 'Codes', activations: 'Activations', audit: 'Audit', search: 'Search businesses', noMatches: 'No matching businesses.', newPlan: 'New plan', editPlan: 'Edit plan', modules: 'Included modules', deviceLimit: 'Device limit', offlineDays: 'Offline days (optional)', planCode: 'Plan code',
  },
  ar: {
    dashboard: 'لوحة التحكم', businesses: 'الأنشطة', licenses: 'التراخيص', devices: 'الأجهزة', administration: 'الإدارة',
    createBusiness: 'نشاط جديد', refresh: 'تحديث', signOut: 'تسجيل الخروج', view: 'عرض', overview: 'نظرة عامة', activity: 'النشاط',
    ready: 'جاهز للتفعيل', provisioning: 'جارٍ الإعداد', failed: 'يتطلب الإعداد متابعة', blocked: 'محظور',
    generate: 'إنشاء رمز التفعيل', regenerate: 'إنشاء رمز جديد', retry: 'إعادة محاولة الإعداد', copyCode: 'نسخ الرمز', done: 'تم',
    business: 'النشاط', licence: 'الترخيص', deviceUsage: 'الأجهزة', status: 'الحالة', plan: 'الخطة', created: 'تاريخ الإنشاء', expires: 'انتهاء الصلاحية',
    noBusinesses: 'لا توجد أنشطة بعد.', noLicenses: 'لا توجد تراخيص بعد.', noDevices: 'لا توجد أجهزة مفعّلة بعد.', noActivity: 'لا يوجد نشاط مسجل بعد.',
    createTitle: 'نشاط جديد', createHelp: 'يُعِد CorePOS النشاط وحساب المالك والترخيص داخليًا. يتلقى العميل رمز تفعيل واحدًا فقط.',
    contact: 'جهة الاتصال', owner: 'حساب المالك', commercial: 'الترخيص التجاري', save: 'إنشاء وإعداد', cancel: 'إلغاء',
    name: 'الاسم', email: 'البريد الإلكتروني', phone: 'الهاتف', password: 'كلمة المرور الأولية', address: 'العنوان', currency: 'العملة', language: 'اللغة', timezone: 'المنطقة الزمنية', type: 'نوع النشاط',
    businessCreated: 'تم إنشاء النشاط. يستكمل CorePOS الإعداد الداخلي.', businessReady: 'النشاط جاهز. أنشئ رمز التفعيل للعميل.',
    codeTitle: 'رمز تفعيل الجهاز', codeShownOnce: 'يظهر هذا الرمز مرة واحدة. احفظه أو أرسله بأمان إلى العميل.',
    active: 'نشط', disabled: 'معطّل', suspended: 'معلّق', closed: 'مغلق', revoked: 'ملغى', expired: 'منتهي', available: 'متاح', consumed: 'مستخدم', suspend: 'تعطيل', reactivate: 'إعادة تفعيل', revoke: 'إلغاء', editBusiness: 'تعديل النشاط', saveChanges: 'حفظ التغييرات', notes: 'ملاحظات', devicesTitle: 'الأجهزة المفعّلة', codeUnavailable: 'لم يعد الرمز السابق متاحًا. أنشئ رمزًا جديدًا عند الحاجة.',
    plans: 'الخطط', codes: 'الرموز', activations: 'عمليات التفعيل', audit: 'التدقيق', search: 'البحث عن نشاط', noMatches: 'لا توجد أنشطة مطابقة.', newPlan: 'خطة جديدة', editPlan: 'تعديل الخطة', modules: 'الوحدات المشمولة', deviceLimit: 'حد الأجهزة', offlineDays: 'أيام دون اتصال (اختياري)', planCode: 'رمز الخطة',
  },
} as const

function date(value: string | null | undefined, language: Language) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString(language === 'ar' ? 'ar-MA' : language === 'fr' ? 'fr-MA' : 'en-US')
}

function statusBadge(value: string, label: string) {
  const success = value === 'READY_FOR_ACTIVATION' || value === 'active' || value === 'approved'
  const warning = value === 'PROVISIONING' || value === 'suspended'
  return <span className={`badge ${success ? 'success' : warning ? 'warning' : 'muted'}`}>{label}</span>
}

export default function VendorAdminPage() {
  const [language, setLanguage] = useState<Language>('fr')
  const [connected, setConnected] = useState(false)
  const [username, setUsername] = useState(() => localStorage.getItem('vendor-username') ?? 'admin')
  const [password, setPassword] = useState('')
  const [section, setSection] = useState<Section>('dashboard')
  const [administrationTab, setAdministrationTab] = useState<AdministrationTab>('plans')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [licenses, setLicenses] = useState<License[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [records, setRecords] = useState<Array<Audit | ActivationCode>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [onboarding, setOnboarding] = useState<Onboarding>(emptyOnboarding)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [businessEdit, setBusinessEdit] = useState<BusinessEdit | null>(null)
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlanForm)
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'overview' | 'license' | 'devices' | 'activity'>('overview')
  const [activation, setActivation] = useState<{ code: string; license: License } | null>(null)
  const [search, setSearch] = useState('')
  const t = copy[language]

  const selectedBusiness = businesses.find((item) => item.id === selectedBusinessId) ?? null
  const filteredBusinesses = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return businesses
    return businesses.filter((item) => [item.name, item.customer_name, item.customer_email].some((value) => value?.toLowerCase().includes(needle)))
  }, [businesses, search])
  const licenseById = useMemo(() => new Map(licenses.map((item) => [item.id, item])), [licenses])
  const selectedLicense = selectedBusiness?.license_id ? licenses.find((item) => item.id === selectedBusiness.license_id) ?? null : null
  const selectedDevices = selectedBusiness ? devices.filter((item) => licenseById.get(item.license_id)?.vendor_business_id === selectedBusiness.id) : []

  function clearMessages() { setError(''); setSuccess('') }
  function fail() { setError(language === 'fr' ? 'Cette action ne peut pas être terminée pour le moment.' : language === 'ar' ? 'يتعذر إكمال هذا الإجراء حاليًا.' : 'This action cannot be completed right now.') }
  function lifecycleLabel(value: LifecycleState) {
    if (value === 'READY_FOR_ACTIVATION') return t.ready
    if (value === 'PROVISIONING') return t.provisioning
    if (value === 'PROVISIONING_FAILED') return t.failed
    return t.blocked
  }
  function statusLabel(value: string | null | undefined) {
    if (value === 'active' || value === 'approved') return t.active
    if (value === 'suspended') return t.suspended
    if (value === 'closed') return t.closed
    if (value === 'revoked') return t.revoked
    if (value === 'expired') return t.expired
    if (value === 'available') return t.available
    if (value === 'consumed') return t.consumed
    return t.disabled
  }
  function activityLabel(action: string | undefined) {
    if (action === 'business.create') return t.businessCreated
    if (action === 'tenant.provision.complete') return t.businessReady
    if (action === 'tenant.provision.failed') return t.failed
    if (action === 'activation_code.issue' || action === 'activation_code.regenerate') return t.codeTitle
    if (action?.startsWith('license.')) return t.licence
    if (action?.startsWith('device.')) return t.devices
    return t.activity
  }

  async function loadBusinesses() { setBusinesses(await vendorApi.get<Business[]>('/businesses')) }
  async function loadLicenses() { setLicenses(await vendorApi.get<License[]>('/licenses')) }
  async function loadDevices() { setDevices(await vendorApi.get<Device[]>('/devices')) }
  async function loadPlans() { setPlans(await vendorApi.get<Plan[]>('/plans')) }

  function openPlanForm(plan?: Plan) {
    clearMessages()
    setEditingPlanId(plan?.id ?? null)
    setPlanForm(plan ? {
      code: plan.code,
      name: plan.name,
      features: plan.features ?? [],
      default_device_limit: plan.default_device_limit,
      default_desktop_device_limit: plan.default_desktop_device_limit ?? null,
      default_web_device_limit: plan.default_web_device_limit ?? null,
      default_mobile_device_limit: plan.default_mobile_device_limit ?? null,
      offline_validity_days: plan.offline_validity_days ?? null,
      active: plan.active,
    } : emptyPlanForm)
    setShowPlanForm(true)
  }

  function togglePlanFeature(feature: FeatureKey) {
    setPlanForm((current) => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter((item) => item !== feature)
        : [...current.features, feature],
    }))
  }

  async function savePlan(event: FormEvent) {
    event.preventDefault()
    if (loading || !planForm.features.length) return
    setLoading(true); clearMessages()
    try {
      const payload = {
        name: planForm.name.trim(),
        features: planForm.features,
        default_device_limit: planForm.default_device_limit,
        default_desktop_device_limit: planForm.default_desktop_device_limit,
        default_web_device_limit: planForm.default_web_device_limit,
        default_mobile_device_limit: planForm.default_mobile_device_limit,
        offline_validity_days: planForm.offline_validity_days,
        ...(editingPlanId ? { active: planForm.active } : { code: planForm.code.trim().toLowerCase() }),
      }
      if (editingPlanId) await vendorApi.put(`/plans/${editingPlanId}`, payload)
      else await vendorApi.post('/plans', payload)
      await loadPlans()
      setShowPlanForm(false)
      setSuccess(t.saveChanges)
    } catch { fail() } finally { setLoading(false) }
  }

  async function openCreate() {
    setLoading(true); clearMessages()
    try { await loadPlans(); setOnboarding(emptyOnboarding); setShowCreate(true) }
    catch { fail() } finally { setLoading(false) }
  }

  async function load(next: Section = section) {
    setSection(next); setLoading(true); clearMessages()
    try {
      if (next === 'dashboard') setDashboard(await vendorApi.get<Dashboard>('/dashboard'))
      if (next === 'businesses') await Promise.all([loadBusinesses(), loadLicenses(), loadDevices()])
      if (next === 'licenses') await loadLicenses()
      if (next === 'devices') await Promise.all([loadDevices(), loadLicenses()])
      if (next === 'administration') await loadAdministration(administrationTab)
    } catch { fail() } finally { setLoading(false) }
  }

  async function loadAdministration(tab: AdministrationTab) {
    setAdministrationTab(tab); setLoading(true); clearMessages()
    try {
      if (tab === 'plans') { await loadPlans(); setRecords([]) }
      else setRecords(await vendorApi.get<Array<Audit | ActivationCode>>(`/${tab}`))
    } catch { fail() } finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    void vendorApi.session()
      .then(async () => { if (active) { setConnected(true); setDashboard(await vendorApi.get<Dashboard>('/dashboard')) } })
      .catch(() => { if (active) setConnected(false) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function signIn(event: FormEvent) {
    event.preventDefault(); if (!username.trim() || !password) return
    setLoading(true); clearMessages()
    try {
      await vendorApi.login({ username: username.trim(), password })
      localStorage.setItem('vendor-username', username.trim()); setPassword(''); setConnected(true)
      setDashboard(await vendorApi.get<Dashboard>('/dashboard'))
    } catch { fail() } finally { setLoading(false) }
  }

  async function signOut() {
    try { await vendorApi.logout() } finally { setConnected(false); setPassword(''); setSelectedBusinessId(null); clearMessages() }
  }

  async function createBusiness(event: FormEvent) {
    event.preventDefault(); if (loading) return
    setLoading(true); clearMessages()
    try {
      const result = await vendorApi.post<{ business: { id: string }; lifecycle: { state: LifecycleState } }>('/onboarding', {
        customer: { name: onboarding.customer_name, email: onboarding.customer_email || null, phone: onboarding.customer_phone || null, notes: onboarding.customer_notes || null },
        business: { name: onboarding.business_name, business_type: onboarding.business_type, address: onboarding.address || null, phone: onboarding.customer_phone || null, currency: onboarding.currency, locale: onboarding.locale, timezone: onboarding.timezone },
        owner: { name: onboarding.owner_name, email: onboarding.owner_email, password: onboarding.owner_password },
        plan_id: onboarding.plan_id,
        duration: onboarding.duration,
        custom_expires_at: onboarding.duration === 'custom' ? new Date(onboarding.custom_expires_at).toISOString() : null,
        offline_validity_days: onboarding.offline_validity_days,
      })
      setShowCreate(false); setOnboarding(emptyOnboarding); setSelectedBusinessId(result.business.id); setDetailTab('overview')
      await Promise.all([loadBusinesses(), loadLicenses(), loadDevices()]); setSection('businesses')
      setSuccess(result.lifecycle.state === 'READY_FOR_ACTIVATION' ? t.businessReady : t.businessCreated)
    } catch { fail() } finally { setLoading(false) }
  }

  async function retryProvisioning(business: Business) {
    if (loading) return
    setLoading(true); clearMessages()
    try {
      await vendorApi.post(`/businesses/${business.id}/provision/retry`, {})
      await Promise.all([loadBusinesses(), loadLicenses(), loadDevices()]); setSuccess(t.businessReady)
    } catch { fail() } finally { setLoading(false) }
  }

  async function generateCode(license: License) {
    if (loading || license.lifecycle_state !== 'READY_FOR_ACTIVATION') return
    if (!window.confirm(language === 'fr' ? 'Créer un nouveau code ? Les codes inutilisés seront annulés. Les appareils déjà activés resteront actifs.' : language === 'ar' ? 'هل تريد إنشاء رمز جديد؟ ستُلغى الرموز غير المستخدمة، وستبقى الأجهزة المفعّلة نشطة.' : 'Generate a new code? Unused codes will be revoked. Activated devices remain active.')) return
    setLoading(true); clearMessages()
    try {
      const result = await vendorApi.post<CodeResult>(`/licenses/${license.id}/activation-code/regenerate`, { channel: 'desktop', ttl_hours: 24, notes: 'Generated from Vendor Console' })
      setActivation({ code: result.activation_code, license }); await loadLicenses()
    } catch { fail() } finally { setLoading(false) }
  }

  async function changeLicense(license: License, action: 'suspend' | 'reactivate') {
    if (loading || !window.confirm(action === 'suspend' ? t.suspend + ' ?' : t.reactivate + ' ?')) return
    setLoading(true); clearMessages()
    try { await vendorApi.post(`/licenses/${license.id}/${action}`, {}); await Promise.all([loadLicenses(), loadBusinesses()]) } catch { fail() } finally { setLoading(false) }
  }

  async function revokeDevice(device: Device) {
    if (loading || !window.confirm(`${t.revoke} ?`)) return
    setLoading(true); clearMessages()
    try { await vendorApi.post(`/devices/${device.id}/revoke`, {}); await Promise.all([loadDevices(), loadLicenses(), loadBusinesses()]) } catch { fail() } finally { setLoading(false) }
  }

  function openEditBusiness(business: Business) {
    setBusinessEdit({
      name: business.name,
      business_type: business.business_type,
      status: business.status === 'closed' ? 'closed' : business.status === 'suspended' ? 'suspended' : 'active',
      notes: business.notes ?? '',
    })
    setShowEdit(true)
  }

  async function saveBusinessEdit(event: FormEvent) {
    event.preventDefault()
    if (!selectedBusiness || !businessEdit || loading) return
    setLoading(true); clearMessages()
    try {
      await vendorApi.put(`/businesses/${selectedBusiness.id}`, businessEdit)
      setShowEdit(false)
      await Promise.all([loadBusinesses(), loadLicenses(), loadDevices()])
      setSuccess(t.saveChanges)
    } catch { fail() } finally { setLoading(false) }
  }

  function openBusiness(business: Business) {
    setSelectedBusinessId(business.id); setDetailTab('overview')
    void Promise.all([loadLicenses(), loadDevices()])
    void vendorApi.get<Audit[]>('/audit').then(setRecords).catch(() => undefined)
  }

  function businessActions(business: Business, compact = false) {
    const license = business.license_id ? licenses.find((item) => item.id === business.license_id) : null
    return <div className="vendor-row-actions">
      {!compact ? <button className="button secondary" onClick={() => openBusiness(business)}>{t.view}</button> : null}
      {business.lifecycle_state === 'PROVISIONING_FAILED' ? <button className="button" disabled={loading} onClick={() => void retryProvisioning(business)}>{t.retry}</button> : null}
      {license?.lifecycle_state === 'READY_FOR_ACTIVATION' ? <button className="button" disabled={loading} onClick={() => void generateCode(license)}>{t.generate}</button> : null}
    </div>
  }

  function businessList() {
    if (loading && !businesses.length) return <div className="vendor-empty">…</div>
    if (!filteredBusinesses.length) return <div className="vendor-empty">{search ? t.noMatches : t.noBusinesses}<br/><button className="button" onClick={() => void openCreate()}>{t.createBusiness}</button></div>
    return <div className="table-wrap"><table><thead><tr><th>{t.business}</th><th>{t.licence}</th><th>{t.status}</th><th>{t.deviceUsage}</th><th /></tr></thead><tbody>{filteredBusinesses.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br/><small>{item.customer_name ?? '—'}{item.customer_email ? ` · ${item.customer_email}` : ''}</small></td><td>{item.plan_name ?? '—'}<br/><small>{item.license_status ?? '—'}</small></td><td>{statusBadge(item.lifecycle_state, lifecycleLabel(item.lifecycle_state))}</td><td><strong>{item.active_devices ?? 0} / {item.max_devices ?? '—'}</strong></td><td>{businessActions(item)}</td></tr>)}</tbody></table></div>
  }

  function licenseList() {
    if (loading && !licenses.length) return <div className="vendor-empty">…</div>
    if (!licenses.length) return <div className="vendor-empty">{t.noLicenses}</div>
    return <div className="table-wrap"><table><thead><tr><th>{t.business}</th><th>{t.plan}</th><th>{t.status}</th><th>{t.deviceUsage}</th><th /></tr></thead><tbody>{licenses.map((item) => <tr key={item.id}><td><strong>{item.vendor_business_name ?? '—'}</strong><br/><small>{item.customer_name ?? '—'}</small></td><td>{item.plan_name ?? item.plan_code ?? '—'}</td><td>{statusBadge(item.status, statusLabel(item.status))}<br/><small>{date(item.expires_at, language)}</small></td><td><strong>{item.active_devices ?? 0} / {item.max_devices}</strong></td><td><div className="vendor-row-actions">{item.lifecycle_state === 'READY_FOR_ACTIVATION' ? <button className="button" disabled={loading} onClick={() => void generateCode(item)}>{t.generate}</button> : null}{item.status === 'active' ? <button className="button secondary" disabled={loading} onClick={() => void changeLicense(item, 'suspend')}>{t.suspend}</button> : item.status === 'suspended' ? <button className="button secondary" disabled={loading} onClick={() => void changeLicense(item, 'reactivate')}>{t.reactivate}</button> : null}</div></td></tr>)}</tbody></table></div>
  }

  function deviceList(items = devices) {
    if (!items.length) return <div className="vendor-empty">{t.noDevices}</div>
    return <div className="table-wrap"><table><thead><tr><th>{t.business}</th><th>{t.deviceUsage}</th><th>{t.status}</th><th>{t.activity}</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.vendor_business_name ?? '—'}</strong><br/><small>{item.customer_name ?? '—'}</small></td><td><strong>{item.device_name ?? 'CorePOS'}</strong><br/><small>{item.channel ?? 'desktop'} · {item.platform ?? '—'}</small></td><td>{statusBadge(item.status, statusLabel(item.status))}</td><td>{date(item.last_seen_at ?? item.last_validated_at ?? item.activated_at, language)}</td><td>{item.status === 'active' ? <button className="button danger" disabled={loading} onClick={() => void revokeDevice(item)}>{t.revoke}</button> : null}</td></tr>)}</tbody></table></div>
  }

  function businessDetails() {
    if (!selectedBusiness) return null
    return <>
      <div className="vendor-section-head"><div><small>{selectedBusiness.customer_name ?? 'CorePOS'}</small><h2>{selectedBusiness.name}</h2></div><div className="vendor-row-actions">{statusBadge(selectedBusiness.lifecycle_state, lifecycleLabel(selectedBusiness.lifecycle_state))}{businessActions(selectedBusiness, true)}<button className="button secondary" disabled={loading} onClick={() => openEditBusiness(selectedBusiness)}>{t.editBusiness}</button><button className="button secondary" onClick={() => setSelectedBusinessId(null)}>{t.businesses}</button></div></div>
      <div className="vendor-row-actions" style={{ marginBottom: 12 }}>
        {(['overview', 'license', 'devices', 'activity'] as const).map((tab) => <button key={tab} className={`button ${detailTab === tab ? '' : 'secondary'}`} onClick={() => setDetailTab(tab)}>{tab === 'overview' ? t.overview : tab === 'license' ? t.licence : tab === 'devices' ? t.devices : t.activity}</button>)}
      </div>
      {detailTab === 'overview' ? <article className="settings-card"><div className="vendor-summary-grid"><div className="vendor-summary-line"><small>{t.contact}</small><strong>{selectedBusiness.customer_name ?? '—'}</strong><span>{selectedBusiness.customer_email ?? selectedBusiness.customer_phone ?? '—'}</span></div><div className="vendor-summary-line"><small>{t.licence}</small><strong>{selectedBusiness.plan_name ?? '—'}</strong><span>{statusLabel(selectedBusiness.license_status)}</span></div><div className="vendor-summary-line"><small>{t.deviceUsage}</small><strong>{selectedBusiness.active_devices ?? 0} / {selectedBusiness.max_devices ?? '—'}</strong></div><div className="vendor-summary-line"><small>{t.created}</small><strong>{date(selectedBusiness.created_at, language)}</strong></div></div></article> : null}
      {detailTab === 'license' ? <article className="settings-card"><h3>{t.licence}</h3>{selectedLicense ? <><div className="vendor-summary-grid"><div className="vendor-summary-line"><small>{t.status}</small><strong>{statusLabel(selectedLicense.status)}</strong></div><div className="vendor-summary-line"><small>{t.plan}</small><strong>{selectedLicense.plan_name ?? selectedLicense.plan_code ?? '—'}</strong></div><div className="vendor-summary-line"><small>{t.expires}</small><strong>{selectedLicense.expires_at ? date(selectedLicense.expires_at, language) : '∞'}</strong></div><div className="vendor-summary-line"><small>{t.deviceUsage}</small><strong>{selectedLicense.active_devices ?? 0} / {selectedLicense.max_devices}</strong></div></div><p className="vendor-secret-note">{t.codeUnavailable}</p><div className="vendor-row-actions">{selectedLicense.lifecycle_state === 'READY_FOR_ACTIVATION' ? <button className="button" disabled={loading} onClick={() => void generateCode(selectedLicense)}>{t.generate}</button> : null}</div></> : <p>{t.provisioning}</p>}</article> : null}
      {detailTab === 'devices' ? <article className="settings-card vendor-table-card"><h3>{t.devicesTitle}</h3>{deviceList(selectedDevices)}</article> : null}
      {detailTab === 'activity' ? <article className="settings-card vendor-table-card">{activityList(records.filter((item) => 'entity_id' in item && item.entity_id === selectedBusiness.id) as Audit[])}</article> : null}
    </>
  }

  function activityList(items: Audit[]) {
    if (!items.length) return <div className="vendor-empty">{t.noActivity}</div>
    return <div className="table-wrap"><table><thead><tr><th>{t.activity}</th><th>{t.status}</th><th>{t.created}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{activityLabel(item.action)}</strong></td><td>{item.actor ?? '—'}</td><td>{date(item.created_at, language)}</td></tr>)}</tbody></table></div>
  }

  function administration() {
    const planList = plans.length ? <div className="table-wrap"><table><thead><tr><th>{t.plan}</th><th>{t.deviceUsage}</th><th>{t.status}</th><th /></tr></thead><tbody>{plans.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><br/><small>{item.code}</small></td><td>{item.default_device_limit}</td><td>{statusBadge(item.active ? 'active' : 'disabled', item.active ? t.active : t.disabled)}</td><td><button className="button secondary" disabled={loading} onClick={() => openPlanForm(item)}>{t.editPlan}</button></td></tr>)}</tbody></table></div> : <div className="vendor-empty">—<br/><button className="button" onClick={() => openPlanForm()}>{t.newPlan}</button></div>
    const codes = records as ActivationCode[]
    const codeList = !codes.length ? <div className="vendor-empty">—</div> : <div className="table-wrap"><table><thead><tr><th>{t.business}</th><th>{t.status}</th><th>{t.created}</th></tr></thead><tbody>{codes.map((item) => <tr key={item.id}><td><strong>{item.vendor_business_name ?? '—'}</strong><br/><small>{item.customer_name ?? '—'}</small></td><td>{statusLabel(item.activation_status)}<br/><small>{item.key_hint ?? '—'}</small></td><td>{date(item.expires_at, language)}</td></tr>)}</tbody></table></div>
    return <><div className="vendor-section-head"><div><small>CorePOS</small><h2>{t.administration}</h2></div><div className="vendor-row-actions">{administrationTab === 'plans' ? <button className="button" disabled={loading} onClick={() => openPlanForm()}>{t.newPlan}</button> : null}<button className="button secondary" disabled={loading} onClick={() => void loadAdministration(administrationTab)}>{t.refresh}</button></div></div><div className="vendor-row-actions" style={{ marginBottom: 12 }}>{(['plans', 'activation-codes', 'activations', 'audit'] as const).map((tab) => <button key={tab} className={`button ${administrationTab === tab ? '' : 'secondary'}`} onClick={() => void loadAdministration(tab)}>{tab === 'plans' ? t.plans : tab === 'activation-codes' ? t.codes : tab === 'activations' ? t.activations : t.audit}</button>)}</div><article className="settings-card vendor-table-card">{administrationTab === 'plans' ? planList : administrationTab === 'activation-codes' ? codeList : activityList(records as Audit[])}</article></>
  }

  if (!connected) return <main className="vendor-login-page" dir={language === 'ar' ? 'rtl' : 'ltr'}><form className="vendor-login-card" onSubmit={signIn}><div className="vendor-login-brand"><span>CP</span><div><strong>CorePOS</strong><small>Vendor Console</small></div></div><label>{t.name}<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>{t.password}<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>{t.language}<select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select></label>{error ? <p className="error-message">{error}</p> : null}<button className="button" disabled={loading}>{loading ? '…' : 'CorePOS'}</button></form></main>

  return <main className="vendor-admin vendor-admin-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header className="vendor-topbar"><div><small>CorePOS</small><h1>Vendor Console</h1></div><div className="vendor-topbar-actions"><label className="language-selector"><span className="sr-only">{t.language}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select></label><button className="button secondary" onClick={() => void signOut()}>{t.signOut}</button></div></header>
    <div className="vendor-layout"><aside className="vendor-sidebar"><div className="vendor-sidebar-brand"><span>CP</span><div><strong>CorePOS</strong><small>Vendor Console</small></div></div><nav>{(['dashboard', 'businesses', 'licenses', 'devices', 'administration'] as const).map((item) => <button key={item} className={section === item ? 'active' : ''} onClick={() => void load(item)}>{t[item]}</button>)}</nav></aside><section className="vendor-content">
      {error ? <p className="error-message">{error}</p> : null}{success ? <p className="success-message">{success}</p> : null}
      {section === 'dashboard' ? <><div className="vendor-section-head"><div><small>CorePOS</small><h2>{t.dashboard}</h2></div><div className="vendor-row-actions"><button className="button" onClick={() => void openCreate()}>{t.createBusiness}</button><button className="button secondary" disabled={loading} onClick={() => void load('dashboard')}>{t.refresh}</button></div></div><div className="vendor-stats"><button className="vendor-stat-card vendor-stat-link" onClick={() => void load('businesses')}><small>{t.businesses}</small><strong>{dashboard?.businesses.count ?? 0}</strong></button><button className="vendor-stat-card vendor-stat-link" onClick={() => void load('businesses')}><small>{t.ready}</small><strong>{dashboard?.businesses.ready ?? 0}</strong></button><button className="vendor-stat-card vendor-stat-link" onClick={() => void load('licenses')}><small>{t.licenses}</small><strong>{dashboard?.licenses.active ?? 0}</strong></button><button className="vendor-stat-card vendor-stat-link" onClick={() => void load('devices')}><small>{t.devices}</small><strong>{dashboard?.devices.active ?? 0}</strong></button></div><article className="settings-card"><h3>{t.createBusiness}</h3><p>{t.createHelp}</p><button className="button" onClick={() => void openCreate()}>{t.createBusiness}</button></article></> : null}
      {section === 'businesses' ? selectedBusiness ? businessDetails() : <><div className="vendor-section-head"><div><small>CorePOS</small><h2>{t.businesses}</h2></div><div className="vendor-row-actions"><button className="button" onClick={() => void openCreate()}>{t.createBusiness}</button><button className="button secondary" disabled={loading} onClick={() => void load('businesses')}>{t.refresh}</button></div></div><input className="vendor-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search}/><article className="settings-card vendor-table-card">{businessList()}</article></> : null}
      {section === 'licenses' ? <><div className="vendor-section-head"><div><small>CorePOS</small><h2>{t.licenses}</h2></div><button className="button secondary" disabled={loading} onClick={() => void load('licenses')}>{t.refresh}</button></div><article className="settings-card vendor-table-card">{licenseList()}</article></> : null}
      {section === 'devices' ? <><div className="vendor-section-head"><div><small>CorePOS</small><h2>{t.devices}</h2></div><button className="button secondary" disabled={loading} onClick={() => void load('devices')}>{t.refresh}</button></div><article className="settings-card vendor-table-card">{deviceList()}</article></> : null}
      {section === 'administration' ? administration() : null}
    </section></div>
    {showCreate ? <div className="modal-backdrop"><section className="modal-content vendor-form-modal" aria-modal="true" role="dialog"><form onSubmit={createBusiness}><h3>{t.createTitle}</h3><p>{t.createHelp}</p><fieldset className="vendor-policy-field"><legend>{t.business}</legend><label>{t.name}<input required value={onboarding.business_name} onChange={(event) => setOnboarding({ ...onboarding, business_name: event.target.value })}/></label><label>{t.type}<select value={onboarding.business_type} onChange={(event) => setOnboarding({ ...onboarding, business_type: event.target.value })}>{businessTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>{t.address}<input value={onboarding.address} onChange={(event) => setOnboarding({ ...onboarding, address: event.target.value })}/></label><label>{t.currency}<input required maxLength={3} value={onboarding.currency} onChange={(event) => setOnboarding({ ...onboarding, currency: event.target.value.toUpperCase() })}/></label><label>{t.language}<select value={onboarding.locale} onChange={(event) => setOnboarding({ ...onboarding, locale: event.target.value })}><option value="fr-MA">Français</option><option value="en">English</option><option value="ar">العربية</option></select></label><label>{t.timezone}<input required value={onboarding.timezone} onChange={(event) => setOnboarding({ ...onboarding, timezone: event.target.value })}/></label></fieldset><fieldset className="vendor-policy-field"><legend>{t.contact}</legend><label>{t.name}<input required value={onboarding.customer_name} onChange={(event) => setOnboarding({ ...onboarding, customer_name: event.target.value })}/></label><label>{t.email}<input type="email" value={onboarding.customer_email} onChange={(event) => setOnboarding({ ...onboarding, customer_email: event.target.value })}/></label><label>{t.phone}<input value={onboarding.customer_phone} onChange={(event) => setOnboarding({ ...onboarding, customer_phone: event.target.value })}/></label></fieldset><fieldset className="vendor-policy-field"><legend>{t.owner}</legend><label>{t.name}<input required value={onboarding.owner_name} onChange={(event) => setOnboarding({ ...onboarding, owner_name: event.target.value })}/></label><label>{t.email}<input required type="email" value={onboarding.owner_email} onChange={(event) => setOnboarding({ ...onboarding, owner_email: event.target.value })}/></label><label>{t.password}<input required minLength={8} type="password" value={onboarding.owner_password} onChange={(event) => setOnboarding({ ...onboarding, owner_password: event.target.value })}/></label></fieldset><fieldset className="vendor-policy-field"><legend>{t.commercial}</legend><label>{t.plan}<select required value={onboarding.plan_id} onChange={(event) => { const plan = plans.find((item) => item.id === event.target.value); setOnboarding({ ...onboarding, plan_id: event.target.value, offline_validity_days: plan ? null : onboarding.offline_validity_days }) }}><option value="">—</option>{plans.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><input type="checkbox" checked={onboarding.duration === 'lifetime'} onChange={(event) => setOnboarding({ ...onboarding, duration: event.target.checked ? 'lifetime' : 'custom' })}/> {t.licence} {onboarding.duration === 'lifetime' ? '∞' : ''}</label>{onboarding.duration === 'custom' ? <label>{t.created}<input required type="datetime-local" value={onboarding.custom_expires_at} onChange={(event) => setOnboarding({ ...onboarding, custom_expires_at: event.target.value })}/></label> : null}</fieldset><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowCreate(false)}>{t.cancel}</button><button className="button" disabled={loading}>{loading ? '…' : t.save}</button></div></form></section></div> : null}
    {showEdit && businessEdit ? <div className="modal-backdrop"><section className="modal-content vendor-form-modal" aria-modal="true" role="dialog"><form onSubmit={saveBusinessEdit}><h3>{t.editBusiness}</h3><fieldset className="vendor-policy-field"><legend>{t.business}</legend><label>{t.name}<input required value={businessEdit.name} onChange={(event) => setBusinessEdit({ ...businessEdit, name: event.target.value })}/></label><label>{t.status}<select value={businessEdit.status} onChange={(event) => setBusinessEdit({ ...businessEdit, status: event.target.value as BusinessEdit['status'] })}><option value="active">{t.active}</option><option value="suspended">{t.suspended}</option><option value="closed">{t.closed}</option></select></label><label style={{ gridColumn: '1 / -1' }}>{t.notes}<textarea value={businessEdit.notes} onChange={(event) => setBusinessEdit({ ...businessEdit, notes: event.target.value })}/></label></fieldset><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowEdit(false)}>{t.cancel}</button><button className="button" disabled={loading}>{loading ? '…' : t.saveChanges}</button></div></form></section></div> : null}
    {showPlanForm ? <div className="modal-backdrop"><section className="modal-content vendor-form-modal" aria-modal="true" role="dialog"><form onSubmit={savePlan}><h3>{editingPlanId ? t.editPlan : t.newPlan}</h3><fieldset className="vendor-policy-field"><legend>{t.plan}</legend><label>{t.name}<input required value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })}/></label><label>{t.planCode}<input required disabled={Boolean(editingPlanId)} pattern="[a-z0-9_-]+" value={planForm.code} onChange={(event) => setPlanForm({ ...planForm, code: event.target.value.toLowerCase() })}/></label><label>{t.deviceLimit}<input required min={1} type="number" value={planForm.default_device_limit} onChange={(event) => setPlanForm({ ...planForm, default_device_limit: Math.max(1, Number(event.target.value) || 1) })}/></label><label>{t.offlineDays}<input min={1} type="number" value={planForm.offline_validity_days ?? ''} onChange={(event) => setPlanForm({ ...planForm, offline_validity_days: event.target.value ? Math.max(1, Number(event.target.value)) : null })}/></label>{editingPlanId ? <label><input type="checkbox" checked={planForm.active} onChange={(event) => setPlanForm({ ...planForm, active: event.target.checked })}/>{t.active}</label> : null}</fieldset><fieldset className="vendor-policy-field"><legend>{t.modules}</legend><div className="vendor-feature-grid" style={{ gridColumn: '1 / -1' }}>{featureKeys.map((feature) => <label key={feature}><input checked={planForm.features.includes(feature)} onChange={() => togglePlanFeature(feature)} type="checkbox"/>{feature}</label>)}</div></fieldset><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowPlanForm(false)}>{t.cancel}</button><button className="button" disabled={loading || !planForm.features.length}>{loading ? '…' : t.saveChanges}</button></div></form></section></div> : null}
    {activation ? <div className="modal-backdrop"><section className="modal-content vendor-key-modal" aria-modal="true" role="dialog"><header className="vendor-activation-card-head"><div><small>CorePOS</small><h3>{t.codeTitle}</h3></div>{statusBadge(activation.license.status, statusLabel(activation.license.status))}</header><div className="vendor-activation-facts"><span><small>{t.business}</small><strong>{activation.license.vendor_business_name ?? '—'}</strong></span><span><small>{t.deviceUsage}</small><strong>{activation.license.active_devices ?? 0} / {activation.license.max_devices}</strong></span></div><section className="vendor-activation-code-block primary"><code dir="ltr">{activation.code}</code><p>{t.codeShownOnce}</p><div className="modal-actions"><button className="button" onClick={() => void navigator.clipboard.writeText(activation.code).then(() => setSuccess(t.copyCode)).catch(() => fail())}>{t.copyCode}</button><button className="button secondary" disabled={loading} onClick={() => void generateCode(activation.license)}>{t.regenerate}</button></div></section><div className="modal-actions"><button className="button" onClick={() => setActivation(null)}>{t.done}</button></div></section></div> : null}
  </main>
}
