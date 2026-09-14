import assert from 'node:assert/strict'
import test from 'node:test'
import { activationRequestIsFresh, businessTypeAllowed, certificateDeadline, certificateIsCurrent, certificateStatus } from './policy.js'
import type { LicenseCertificate } from './crypto.js'

const certificate:LicenseCertificate={version:1,certificate_id:'00000000-0000-4000-8000-000000000001',license_id:'00000000-0000-4000-8000-000000000002',customer_id:null,business_id:null,business_type:'restaurant',plan:'restaurant',features:['pos','tables'],installation_id:'00000000-0000-4000-8000-000000000003',device_fingerprint:'a'.repeat(64),issued_at:'2026-09-01T00:00:00.000Z',expires_at:'2026-10-01T00:00:00.000Z',offline_validity_days:7}

test('offline deadline is the earlier commercial or validation deadline',()=>{
 assert.equal(new Date(certificateDeadline(certificate)).toISOString(),'2026-09-08T00:00:00.000Z')
 assert.equal(certificateIsCurrent(certificate,Date.parse('2026-09-07T23:59:59Z')),true)
 assert.equal(certificateIsCurrent(certificate,Date.parse('2026-09-08T00:00:00Z')),false)
})

test('business type binding is exact unless the license is universal',()=>{
 assert.equal(businessTypeAllowed(null,'library'),true)
 assert.equal(businessTypeAllowed('restaurant','restaurant'),true)
 assert.equal(businessTypeAllowed('restaurant','retail'),false)
})

test('online activation request freshness tolerates drift but rejects stale/future requests',()=>{
 const now=Date.parse('2026-09-05T12:00:00Z')
 assert.equal(activationRequestIsFresh('2026-09-05T11:55:00Z',600_000,now),true)
 assert.equal(activationRequestIsFresh('2026-09-05T11:40:00Z',600_000,now),false)
 assert.equal(activationRequestIsFresh('2026-09-05T12:04:00Z',600_000,now),true)
 assert.equal(activationRequestIsFresh('2026-09-05T12:06:00Z',600_000,now),false)
})

test('expired commercial and offline deadlines have distinct safe-mode reasons',()=>{
 assert.equal(certificateStatus(certificate,Date.parse('2026-09-08T00:00:00Z')),'offline_validity_exceeded')
 assert.equal(certificateStatus(certificate,Date.parse('2026-10-01T00:00:00Z')),'expired')
})

test('null offline validity permits permanent offline while commercial expiry still applies',()=>{
 const permanent={...certificate,expires_at:null,offline_validity_days:null}
 assert.equal(certificateDeadline(permanent),Number.POSITIVE_INFINITY)
 assert.equal(certificateIsCurrent(permanent,Date.parse('2036-09-08T00:00:00Z')),true)
 assert.equal(certificateStatus(permanent,Date.parse('2036-09-08T00:00:00Z')),'active')
 const commerciallyExpired={...permanent,expires_at:'2026-10-01T00:00:00.000Z'}
 assert.equal(certificateStatus(commerciallyExpired,Date.parse('2026-10-01T00:00:00Z')),'expired')
})
