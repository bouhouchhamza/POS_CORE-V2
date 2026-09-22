import crypto from'node:crypto'

export type LicenseCertificateV1={
 version:1
 certificate_id:string
 license_id:string
 customer_id:string|null
 business_id:number|null
 business_type:string|null
 plan:string|null
 features:string[]
 installation_id:string
 device_fingerprint:string
 issued_at:string
 expires_at:string|null
 offline_validity_days:number|null
}

export type LicenseCertificateV2={
 version:2
 certificate_id:string
 license_id:string
 customer_id:string
 vendor_business_id:string
 business_id:number|null
 business_type:string
 plan:string|null
 features:string[]
 installation_id:string
 device_fingerprint:string
 issued_at:string
 expires_at:string|null
 offline_validity_days:number|null
 bootstrap?:{
  business:{name:string;logo:string|null;currency:string;locale:string;timezone:string}
  branch:{name:string;code:string;address:string|null;phone:string|null}
  users:Array<{name:string;email:string;password:string;role:string;is_active:boolean}>
 }
}

export type LicenseCertificate=
 LicenseCertificateV1|
 LicenseCertificateV2

export function canonical(value:unknown):string{if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;return JSON.stringify(value)}
export const fingerprint=(publicKey:string)=>crypto.createHash('sha256').update(publicKey).digest('hex')
export const licenseKeyHash=(key:string)=>crypto.createHash('sha256').update(key.trim()).digest('hex')
export function signCertificate(certificate:LicenseCertificate,privateKey:string){return crypto.sign(null,Buffer.from(canonical(certificate)),privateKey).toString('base64url')}
export function verifyCertificate(certificate:LicenseCertificate,signature:string,publicKey:string){try{return crypto.verify(null,Buffer.from(canonical(certificate)),publicKey,Buffer.from(signature,'base64url'))}catch{return false}}
export function certificateMatchesDevice(certificate:LicenseCertificate,installationId:string,devicePublicKey:string){return certificate.installation_id===installationId&&certificate.device_fingerprint===fingerprint(devicePublicKey)}
