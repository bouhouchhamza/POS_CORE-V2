import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ar } from './ar'
import { en } from './en'
import { fr } from './fr'
import { merchantI18n } from './merchant'
import { lifecycleI18n } from './lifecycle'
import { activationI18n } from './activation'
import { printingI18n } from './printing'

export type Language = 'fr' | 'en' | 'ar'
const dictionaries = {
  fr: { ...fr, ...merchantI18n.fr, ...lifecycleI18n.fr, ...activationI18n.fr, ...printingI18n.fr },
  en: { ...en, ...merchantI18n.en, ...lifecycleI18n.en, ...activationI18n.en, ...printingI18n.en },
  ar: { ...ar, ...merchantI18n.ar, ...lifecycleI18n.ar, ...activationI18n.ar, ...printingI18n.ar },
}
const neutralOverrides:Record<Language,Record<string,string>>={
  fr:{'license.typeDetermined':'Déterminé par la licence','license.typeAutomatic':'Le type de commerce et les modules seront configurés automatiquement lors de l’activation.','license.typeBound':'Défini lors de l’activation commerciale.','header.cafeManagement':'Gestion du commerce','settings.subtitle':'Gérez votre commerce, les tickets et les utilisateurs.','settings.cafe':'Informations du commerce','settings.cafeHelp':'Informations affichées dans l\'application et sur les tickets.','settings.addressHelp':'Adresse du commerce sur le ticket','cash.subtitle':'Ouverture, suivi et fermeture de la caisse.','products.trackHelp':'Désactivez le suivi pour les produits ou services gérés sans quantité de stock.'},
  en:{'license.typeDetermined':'Determined by licence','license.typeAutomatic':'The business type and modules will be configured automatically during activation.','license.typeBound':'Defined during commercial activation.','header.cafeManagement':'Business management','settings.subtitle':'Manage your business, receipts, and users.','settings.cafe':'Business information','settings.cafeHelp':'Information shown in the application and on receipts.','settings.addressHelp':'Business address on the receipt','cash.subtitle':'Open, monitor and close the cash register.','products.trackHelp':'Turn tracking off for products or services managed without a stock quantity.'},
  ar:{'license.typeDetermined':'يتم تحديده بواسطة الترخيص','license.typeAutomatic':'سيتم إعداد نوع النشاط والوحدات تلقائيًا عند التفعيل.','license.typeBound':'تم تحديده أثناء التفعيل التجاري.','header.cafeManagement':'إدارة النشاط','settings.subtitle':'إدارة النشاط والفواتير والمستخدمين.','settings.cafe':'معلومات النشاط','settings.cafeHelp':'المعلومات الظاهرة في التطبيق والفواتير.','settings.addressHelp':'عنوان النشاط على الفاتورة','cash.subtitle':'فتح الصندوق ومتابعته وإغلاقه.','products.trackHelp':'أوقف التتبع للمنتجات أو الخدمات التي لا تستخدم كمية مخزون.'},
}
const STORAGE_KEY = 'bimik_cafe_language'
type I18nValue = { language: Language; setLanguage: (language: Language) => void; t: (key: string, values?: Record<string, string | number>) => string }
const I18nContext = createContext<I18nValue | null>(null)

function initialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'ar' || stored === 'en' || stored === 'fr' ? stored : 'fr'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage)
  useEffect(() => { localStorage.setItem(STORAGE_KEY, language); document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr' }, [language])
  const value = useMemo<I18nValue>(() => ({ language, setLanguage, t(key, values = {}) { const template = neutralOverrides[language][key] ?? dictionaries[language][key] ?? fr[key] ?? key; return Object.entries(values).reduce((text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)), template) } }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// The provider and its bound hook intentionally share this small module.
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() { const value = useContext(I18nContext); if (!value) throw new Error('useI18n must be used inside I18nProvider'); return value }
