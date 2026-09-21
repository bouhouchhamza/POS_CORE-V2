import api,{unwrapData}from'./client'
export type LicenseStatus={status:'development'|'activation_required'|'active'|'legacy'|'suspended'|'expired'|'revoked'|'device_revoked'|'vendor_business_inactive'|'offline_validity_exceeded';features:string[]|'all';business_type?:string|null;expires_at?:string|null;offline_valid_until?:string|null;development?:boolean;certificate?:unknown}
export const getLicenseStatus=async()=>unwrapData<LicenseStatus>(await api.get('/license/status'))
// The local Desktop API owns this relay; it forwards the signed device proof
// to the canonical control-plane endpoint below and persists the certificate.
export const activateOnline=async(payload:unknown)=>unwrapData<unknown>(await api.post('/license/activate',payload))
// Canonical online activation endpoint for browser clients and the control
// plane. It accepts CP codes and compatible legacy act_ credentials.
export const activateDevice=async(payload:unknown)=>unwrapData<unknown>(await api.post('/license/device-activate',payload))
// Internal bootstrap handoff only. It requires the narrowly scoped HttpOnly
// grant cookie issued by a successful provisioning transaction; it is never a
// normal activation fallback.
export const activateProvisionedDevice=async()=>unwrapData<{activated:boolean}>(await api.post('/provision/activate-device',{intent:'activate-provisioned-device'}))
export const createOfflineRequest=async(payload:unknown)=>unwrapData<unknown>(await api.post('/license/offline-request',payload))
export const importOfflineLicense=async(payload:unknown)=>unwrapData<unknown>(await api.post('/license/import',payload))
export const revalidateLicense=async(payload:unknown)=>unwrapData<unknown>(await api.post('/license/revalidate',payload))

// COREPOS_VENDOR_PASSWORD_AUTH_V1
const vendorConfig={withCredentials:true}
function vendorError(value:unknown){
 const candidate=value as {response?:{data?:{message?:unknown;code?:unknown}};message?:unknown}
 const serverMessage=candidate?.response?.data?.message
 const code=candidate?.response?.data?.code
 const fallback=typeof candidate?.message==='string'?candidate.message:'Operation impossible.'
 const message=typeof serverMessage==='string'?serverMessage:fallback
 return new Error(typeof code==='string'?`${message} (${code})`:message)
}
async function vendorCall<T>(operation:()=>Promise<{data:unknown}>){
 try{return unwrapData<T>(await operation())}catch(value){throw vendorError(value)}
}
export const vendorApi={
 login:<T=unknown>(payload:{username:string;password:string})=>vendorCall<T>(()=>api.post('/vendor/auth/login',payload,vendorConfig)),
 logout:()=>vendorCall<unknown>(()=>api.post('/vendor/auth/logout',{},vendorConfig)),
 session:<T=unknown>()=>vendorCall<T>(()=>api.get('/vendor/auth/session',vendorConfig)),
 get:<T=unknown>(path:string)=>vendorCall<T>(()=>api.get(`/vendor${path}`,vendorConfig)),
 post:<T=unknown>(path:string,payload:unknown)=>vendorCall<T>(()=>api.post(`/vendor${path}`,payload,vendorConfig)),
 put:<T=unknown>(path:string,payload:unknown)=>vendorCall<T>(()=>api.put(`/vendor${path}`,payload,vendorConfig))
}
