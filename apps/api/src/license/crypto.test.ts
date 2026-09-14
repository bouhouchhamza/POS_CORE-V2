import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import {certificateMatchesDevice,fingerprint,signCertificate,verifyCertificate,type LicenseCertificateV2} from './crypto.js'

test('certificate signature and device binding reject copied or tampered data',()=>{
  const vendor=crypto.generateKeyPairSync('ed25519')
  const deviceA=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'jwk'})
  const deviceB=crypto.generateKeyPairSync('ed25519').publicKey.export({format:'jwk'})
  const publicA=JSON.stringify(deviceA),publicB=JSON.stringify(deviceB)
  const certificate:LicenseCertificateV2={version:2,certificate_id:crypto.randomUUID(),license_id:crypto.randomUUID(),customer_id:crypto.randomUUID(),vendor_business_id:crypto.randomUUID(),business_id:null,business_type:'restaurant',plan:'restaurant',features:['pos','qr_menu'],installation_id:crypto.randomUUID(),device_fingerprint:fingerprint(publicA),issued_at:new Date().toISOString(),expires_at:null,offline_validity_days:30}
  const signature=signCertificate(certificate,vendor.privateKey.export({type:'pkcs8',format:'pem'}).toString())
  const verifyKey=vendor.publicKey.export({type:'spki',format:'pem'}).toString()
  assert.equal(verifyCertificate(certificate,signature,verifyKey),true)
  assert.equal(certificateMatchesDevice(certificate,certificate.installation_id,publicA),true)
  assert.equal(certificateMatchesDevice(certificate,crypto.randomUUID(),publicA),false)
  assert.equal(certificateMatchesDevice(certificate,certificate.installation_id,publicB),false)
  assert.equal(verifyCertificate({...certificate,features:['pos']},signature,verifyKey),false)
  const tamperedBytes=Buffer.from(signature,'base64url')
  tamperedBytes[0]^=1
  const tampered=tamperedBytes.toString('base64url')
  assert.notEqual(tampered,signature)
  assert.equal(verifyCertificate(certificate,tampered,verifyKey),false)
  assert.equal(verifyCertificate(certificate,'not-a-valid-signature',verifyKey),false)
  assert.equal(verifyCertificate(certificate,signature,'not-a-valid-public-key'),false)
  assert.equal(verifyCertificate({...certificate,certificate_id:undefined} as unknown as LicenseCertificateV2,signature,verifyKey),false)
})
