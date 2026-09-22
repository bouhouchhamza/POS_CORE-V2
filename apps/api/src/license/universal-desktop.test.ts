import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import argon2 from 'argon2';
import {offlineProofPayload, type BusinessType, type OfflineRequest} from '@corepos/shared-types';
import {offlineRequestSchema} from '@corepos/validation';
import {buildLocalApp} from '../local/server.js';
import {resolveLocalPaths} from '../local/paths.js';
import {signCertificate,fingerprint,type LicenseCertificateV2} from './crypto.js';

for(const preserved of [false,true])test(`migration clears only empty legacy metadata (customer data preserved=${preserved})`,async()=>{
  const f=await fixture();
  try{
    const db=new DatabaseSync(f.paths.database),stamp=new Date().toISOString();
    db.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,created_at,updated_at) values(1,'Bimik Cafe','bimik-cafe','cafe','MAD','fr-MA','Africa/Casablanca',?,?)").run(stamp,stamp);
    db.prepare("insert into branches(id,business_id,name,code,created_at,updated_at) values(1,1,'Main','MAIN',?,?)").run(stamp,stamp);
    if(preserved)db.prepare("insert into customers(business_id,name,created_at,updated_at) values(1,'Customer data',?,?)").run(stamp,stamp);
    db.exec('pragma user_version=10');db.close();await f.restart();await f.restart();
    const check=new DatabaseSync(f.paths.database);
    assert.equal(check.prepare('select count(*) n from businesses').get()?.n,preserved?1:0);
    assert.equal(check.prepare('select count(*) n from customers').get()?.n,preserved?1:0);
    assert.equal(check.prepare('pragma integrity_check').get()?.integrity_check,'ok');check.close();
    assert.ok(fs.readdirSync(f.paths.backups).length>0,'migration must back up before changing data');
    assert.equal((await f.app.inject('/api/license/status')).json().data.status,'activation_required');
  }finally{await f.close()}
});

test('replaying a cached certificate cannot undo a known revocation',async()=>{
  const f=await fixture();try{
    const d=device(),c=certificate(d,'library');
    assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)})).statusCode,200);
    const db=new DatabaseSync(f.paths.database);db.exec("update merchant_license_state set status='revoked',reason_code='LICENSE_REVOKED' where id=1");db.close();
    const result=await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)});
    assert.equal(result.statusCode,409,result.body);
    assert.equal((await f.app.inject('/api/license/status')).json().data.status,'revoked');
  }finally{await f.close()}
});

const vendor=crypto.generateKeyPairSync('ed25519');
const signer=vendor.privateKey.export({type:'pkcs8',format:'pem'}).toString();
process.env.LICENSE_SIGNING_PUBLIC_KEY=vendor.publicKey.export({type:'spki',format:'pem'}).toString();
process.env.LICENSE_MODE='commercial';

function device(){const keys=crypto.generateKeyPairSync('ed25519');return {id:crypto.randomUUID(),publicKey:JSON.stringify(keys.publicKey.export({format:'jwk'})),sign:(s:string)=>crypto.sign(null,Buffer.from(s),keys.privateKey).toString('base64url')}}
function certificate(d:ReturnType<typeof device>,type:BusinessType,password='$2b$12$X7j5WzhDOrS5m7D6oB9b0.N8hEgCboNKci0cEUhUEDKQM5Am0aJ9K'):LicenseCertificateV2{return {version:2,certificate_id:crypto.randomUUID(),license_id:crypto.randomUUID(),customer_id:crypto.randomUUID(),vendor_business_id:crypto.randomUUID(),business_id:null,business_type:type,features:['pos'],plan:'test',installation_id:d.id,device_fingerprint:fingerprint(d.publicKey),issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),offline_validity_days:30,bootstrap:{business:{name:'Licensed business',logo:null,currency:'MAD',locale:'fr-MA',timezone:'Africa/Casablanca'},branch:{name:'Principal',code:'MAIN',address:null,phone:null},users:[{name:'Owner',email:'owner@test.invalid',password,role:'owner',is_active:true}]}}}
function payload(d:ReturnType<typeof device>,c:LicenseCertificateV2){return {certificate:c,signature:signCertificate(c,signer),installation_id:d.id,device_public_key:d.publicKey,device_proof:d.sign(['poslic-import-v1',c.certificate_id,d.id].join('\n'))}}
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-universal-'));const paths=resolveLocalPaths({BIMIK_DATA_DIR:root});let app=await buildLocalApp({paths});return {paths,get app(){return app},async restart(){await app.close();app=await buildLocalApp({paths})},async close(){await app.close();fs.rmSync(root,{recursive:true,force:true})}}}

test('fresh universal desktop has no business, users, catalog, or commercial type',async()=>{const f=await fixture();try{const setup=(await f.app.inject('/api/setup/status')).json().data;assert.equal(setup.configured,false);assert.equal(setup.business,null);const status=(await f.app.inject('/api/license/status')).json().data;assert.equal(status.status,'activation_required');assert.equal(status.business_type,null);const db=new DatabaseSync(f.paths.database);for(const table of ['businesses','users','products'])assert.equal(db.prepare(`select count(*) n from ${table}`).get()?.n,0);db.close()}finally{await f.close()}});

test('v2 request signs device facts, does not require a type, and rejects tampering',async()=>{const f=await fixture();try{const d=device(),facts={version:2 as const,installation_id:d.id,device_public_key:d.publicKey,device_name:'CorePOS\nDesk',app_version:'2.0.8',platform:'win32',nonce:crypto.randomUUID(),requested_at:new Date().toISOString()};const input={...facts,device_proof:d.sign(offlineProofPayload(facts))};const result=await f.app.inject({method:'POST',url:'/api/license/offline-request',payload:input});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().data.version,2);assert.equal('business_type' in result.json().data,false);assert.deepEqual(JSON.parse(offlineProofPayload(facts)),['posreq-v2',d.id,d.publicKey,facts.device_name,'2.0.8','win32',facts.nonce,facts.requested_at]);assert.equal((await f.app.inject({method:'POST',url:'/api/license/offline-request',payload:{...input,platform:'tampered'}})).statusCode,403);assert.equal(offlineRequestSchema.safeParse({...input,business_type:'cafe'}).success,false)}finally{await f.close()}});

for(const type of ['library','cafe'] as const){
test(`same universal runtime imports ${type} certificate, bootstraps profiles and preserves them after restart`,async()=>{const f=await fixture();try{const d=device(),c=certificate(d,type);const result=await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)});assert.equal(result.statusCode,200,result.body);assert.equal((await f.app.inject('/api/setup/status')).json().data.state,'DEVICE_ACTIVATED');assert.equal((await f.app.inject({method:'POST',url:'/api/setup',payload:{}})).statusCode,403);await f.restart();const state=(await f.app.inject('/api/license/status')).json().data;assert.equal(state.status,'active');assert.equal(state.business_type,type);assert.deepEqual(state.features,['pos']);assert.equal((await f.app.inject('/api/login-profiles')).json().data[0].email,'owner@test.invalid');const db=new DatabaseSync(f.paths.database);assert.equal(db.prepare('select vendor_business_id from businesses').get()?.vendor_business_id,c.vendor_business_id);db.close()}finally{await f.close()}});
test(`online ${type} activation accepts only the Vendor-signed commercial facts`,async(t)=>{const f=await fixture();try{const d=device(),c=certificate(d,type);t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({data:{certificate:c,signature:signCertificate(c,signer)}}),{status:200,headers:{'content-type':'application/json'}}));const result=await f.app.inject({method:'POST',url:'/api/license/activate',payload:{license_key:'isolated-test-one-time-code',installation_id:d.id,device_public_key:d.publicKey,device_name:'CorePOS',app_version:'2.0.8',nonce:crypto.randomUUID(),requested_at:new Date().toISOString(),device_proof:'a'.repeat(64)}});assert.equal(result.statusCode,200,result.body);const state=(await f.app.inject('/api/license/status')).json().data;assert.equal(state.status,'active');assert.equal(state.business_type,type);assert.deepEqual(state.features,['pos'])}finally{await f.close()}});
}

test('signed Argon2 bootstrap verifier is copied exactly and authenticates locally',async()=>{const f=await fixture();try{const plain='offline-verifier-test-password',hash=await argon2.hash(plain),d=device(),c=certificate(d,'cafe',hash);assert.match(hash,/^\$argon2id\$/);assert.equal(JSON.stringify(c).includes(plain),false);const imported=await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)});assert.equal(imported.statusCode,200,imported.body);const db=new DatabaseSync(f.paths.database);assert.equal(db.prepare("select password from users where email='owner@test.invalid'").get()?.password,hash);db.close();assert.equal((await f.app.inject({method:'POST',url:'/api/login',payload:{email:'owner@test.invalid',password:plain}})).statusCode,200);const denied=await f.app.inject({method:'POST',url:'/api/login',payload:{email:'owner@test.invalid',password:'wrong-password'}});assert.equal(denied.statusCode,422);assert.equal(denied.json().code,'INVALID_CREDENTIALS')}finally{await f.close()}});

test('signed bootstrap never overwrites an existing merchant profile verifier',async()=>{const f=await fixture();try{const existingHash=await argon2.hash('existing-merchant-password'),stamp=new Date().toISOString(),db=new DatabaseSync(f.paths.database);db.prepare("insert into businesses(name,slug,business_type,currency,locale,timezone,created_at,updated_at) values('Existing','existing','cafe','MAD','fr-MA','Africa/Casablanca',?,?)").run(stamp,stamp);db.prepare("insert into branches(business_id,name,code,created_at,updated_at) values(1,'Main','MAIN',?,?)").run(stamp,stamp);db.prepare("insert into users(business_id,branch_id,name,email,password,role,is_active,created_at,updated_at) values(1,1,'Existing owner','existing@test.invalid',?,'owner',1,?,?)").run(existingHash,stamp,stamp);db.close();const d=device(),c=certificate(d,'cafe',await argon2.hash('bootstrap-password'));assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)})).statusCode,200);const check=new DatabaseSync(f.paths.database);assert.equal(check.prepare("select password from users where email='existing@test.invalid'").get()?.password,existingHash);assert.equal(check.prepare('select count(*) n from users').get()?.n,1);check.close();assert.equal((await f.app.inject({method:'POST',url:'/api/login',payload:{email:'existing@test.invalid',password:'existing-merchant-password'}})).statusCode,200)}finally{await f.close()}});

test('wrong-device, tampered-type and unknown-feature certificates are rejected',async()=>{const f=await fixture();try{const d=device(),c=certificate(d,'library'),signed=payload(d,c),other=device();assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:{...signed,installation_id:other.id,device_public_key:other.publicKey,device_proof:other.sign(['poslic-import-v1',c.certificate_id,other.id].join('\n'))}})).statusCode,403);assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:{...signed,certificate:{...c,business_type:'cafe'}}})).statusCode,422);assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,{...c,features:['super_admin']})})).statusCode,422);assert.equal((await f.app.inject('/api/license/status')).json().data.status,'activation_required')}finally{await f.close()}});

test('signed cache is verified after restart and local feature injection fails closed',async()=>{const f=await fixture();try{const d=device(),c=certificate(d,'library');assert.equal((await f.app.inject({method:'POST',url:'/api/license/import',payload:payload(d,c)})).statusCode,200);const db=new DatabaseSync(f.paths.database);db.prepare('update merchant_license_state set certificate_json=? where id=1').run(JSON.stringify({...c,features:['pos','tables']}));db.close();await f.restart();const state=(await f.app.inject('/api/license/status')).json().data;assert.equal(state.status,'activation_required');assert.deepEqual(state.features,[])}finally{await f.close()}});

test('v1 remains an explicit frozen protocol and malformed v1 is not reinterpreted',()=>{const d=device(),facts={version:1 as const,installation_id:d.id,device_public_key:d.publicKey,device_name:'Legacy',app_version:'2.0.8',business_type:'cafe' as const,nonce:crypto.randomUUID(),requested_at:new Date().toISOString()};const request:OfflineRequest={...facts,device_proof:d.sign(offlineProofPayload(facts))};assert.equal(offlineRequestSchema.safeParse(request).success,true);assert.equal(offlineRequestSchema.safeParse({...request,business_type:undefined}).success,false);assert.equal(offlineProofPayload(facts),['posreq-v1',d.id,d.publicKey,'Legacy','2.0.8','cafe',facts.nonce,facts.requested_at].join('\n'))});
