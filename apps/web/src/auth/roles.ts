import type{BusinessType,FeatureKey,Role,User}from'../types'
export type AppRole=Role
export type NavItem={to:string;label:string;feature?:FeatureKey;roles?:Role[]}
const admins:Role[]=['patron','owner','admin']
const sales:Role[]=[...admins,'manager','worker','cashier','seller']
const nav:NavItem[]=[
 {to:'/dashboard',label:'Dashboard',roles:[...admins,'manager']},{to:'/pos',label:'Caisse',feature:'pos',roles:[...sales,'waiter']},
 {to:'/tables',label:'Tables',feature:'tables',roles:[...admins,'manager','waiter']},{to:'/orders',label:'Commandes',feature:'pos',roles:[...sales,'waiter']},
 {to:'/kitchen',label:'Cuisine',feature:'kitchen',roles:[...admins,'kitchen']},{to:'/products',label:'Products',roles:[...admins,'manager','stock_manager','seller']},
 {to:'/categories',label:'Categories',roles:[...admins,'manager','stock_manager']},{to:'/stock',label:'Stock',feature:'inventory',roles:[...admins,'manager','stock_manager']},
 {to:'/suppliers',label:'Fournisseurs',feature:'suppliers',roles:[...admins,'manager','stock_manager']},{to:'/purchases',label:'Achats',feature:'purchases',roles:[...admins,'manager','stock_manager']},
 {to:'/customers',label:'Clients',feature:'customers',roles:[...admins,'manager','cashier','seller']},{to:'/rapport',label:'Rapport',feature:'pos',roles:[...admins,'manager']},{to:'/settings',label:'Parametres',roles:admins},
]
const compatibility:FeatureKey[]=['pos','inventory','tables','kitchen','qr_menu','takeaway']
const supported:Role[]=['patron','worker','owner','admin','manager','cashier','seller','waiter','kitchen','stock_manager']
export function normalizeRole(value:unknown):AppRole|null{if(typeof value!=='string')return null;const role=value.trim().toLowerCase()as Role;return supported.includes(role)?role:null}
export function getRoleLabel(role:User['role']|null|undefined,language:'fr'|'en'|'ar'='fr'){const normalized=normalizeRole(role);if(!normalized)return'';const fr:Record<Role,string>={patron:'Patron',owner:'Patron',admin:'Administrateur',manager:'Manager',worker:'Caissier',cashier:'Caissier',seller:'Vendeur',waiter:'Serveur',kitchen:'Cuisine',stock_manager:'Responsable Stock'},en:Record<Role,string>={patron:'Owner',owner:'Owner',admin:'Administrator',manager:'Manager',worker:'Cashier',cashier:'Cashier',seller:'Seller',waiter:'Waiter',kitchen:'Kitchen',stock_manager:'Stock Manager'},ar:Record<Role,string>={patron:'المالك',owner:'المالك',admin:'مدير النظام',manager:'المدير',worker:'أمين الصندوق',cashier:'أمين الصندوق',seller:'البائع',waiter:'النادل',kitchen:'المطبخ',stock_manager:'مسؤول المخزون'};return(language==='ar'?ar:language==='en'?en:fr)[normalized]}
const hospitality:Role[]=['patron','admin','manager','cashier','waiter','kitchen','stock_manager']
const retail:Role[]=['patron','admin','manager','cashier','seller','stock_manager']
export const rolePresets:Record<BusinessType,Role[]>={cafe:hospitality,restaurant:hospitality,library:retail,grocery:retail,drugstore:retail,retail,custom:['patron','admin','manager','cashier','seller','waiter','kitchen','stock_manager']}
export function getAvailableRoles(type:BusinessType='custom'){return rolePresets[type]??rolePresets.custom}
export function getNavItems(role:User['role']|null|undefined,features:readonly FeatureKey[]=compatibility){const normalized=normalizeRole(role);if(!normalized)return[];return nav.filter(item=>(!item.roles||item.roles.includes(normalized))&&(!item.feature||features.includes(item.feature)))}
export function getDefaultPath(role:User['role']|null|undefined,features?:readonly FeatureKey[]){return getNavItems(role,features)[0]?.to??'/login'}
export function canAccessPath(role:User['role']|null|undefined,pathname:string,features?:readonly FeatureKey[]){const path=pathname==='/'?getDefaultPath(role,features):pathname;if(path==='/commandes')return getNavItems(role,features).some(item=>item.to==='/pos');if(path==='/sales')return ['patron','owner','admin','manager','worker','cashier'].includes(normalizeRole(role)??'');return getNavItems(role,features).some(item=>item.to===path)}
