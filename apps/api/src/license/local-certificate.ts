import {commercialCertificateSchema} from '@bimik/validation';
import {verifyCertificate} from './crypto.js';

/** Cached commercial claims have no authority until their signature verifies. */
export function readLocalCertificate(state: {certificate_json?:unknown;certificate_signature?:unknown}|null|undefined) {
  if(typeof state?.certificate_json!=='string'||typeof state.certificate_signature!=='string')return null;
  const key=process.env.LICENSE_SIGNING_PUBLIC_KEY?.replaceAll('\\n','\n');
  if(!key||key.includes('PRIVATE KEY'))return null;
  try {
    const parsed=commercialCertificateSchema.safeParse(JSON.parse(state.certificate_json));
    return parsed.success&&verifyCertificate(parsed.data,state.certificate_signature,key)?parsed.data:null;
  } catch { return null; }
}
