import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {openLocalDatabase} from './database.js';
import {ensureLocalPaths,resolveLocalPaths} from './paths.js';
import {buildLocalApp} from './server.js';
import {fingerprint,signCertificate,type LicenseCertificateV2} from '../license/crypto.js';

test('Universal V1 keeps pilot mutations durable and rolls back a failed remote batch',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-universal-v1-local-'));
  const paths=ensureLocalPaths(resolveLocalPaths({BIMIK_DATA_DIR:root}));
  let db:any,app:any;
  const vendorKey=crypto.generateKeyPairSync('ed25519'),previousKey=process.env.LICENSE_SIGNING_PUBLIC_KEY;
  process.env.LICENSE_SIGNING_PUBLIC_KEY=vendorKey.publicKey.export({type:'spki',format:'pem'}).toString();
  try{
    const stamp=new Date().toISOString(),vendor=crypto.randomUUID(),password=await bcrypt.hash('secret',4);
    db=openLocalDatabase(paths);
    db.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values(1,'Universal','universal','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?,?)").run(vendor,stamp,stamp);
    db.prepare("insert into branches(id,business_id,name,code,active,created_at,updated_at) values(1,1,'Main','MAIN',1,?,?)").run(stamp,stamp);
    db.prepare("insert into users(id,name,email,password,role,is_active,business_id,branch_id,created_at,updated_at) values(1,'Owner','universal@test.invalid',?,'owner',1,1,1,?,?)").run(password,stamp,stamp);
    const certificate:LicenseCertificateV2={version:2,certificate_id:crypto.randomUUID(),license_id:crypto.randomUUID(),customer_id:crypto.randomUUID(),vendor_business_id:vendor,business_id:null,business_type:'cafe',plan:'business',features:['pos'],installation_id:crypto.randomUUID(),device_fingerprint:fingerprint('universal-v1-local-device'),issued_at:stamp,expires_at:new Date(Date.now()+86_400_000).toISOString(),offline_validity_days:30};
    db.prepare("update merchant_license_state set status='active',license_id=?,customer_id=?,vendor_business_id=?,business_type='cafe',allowed_features_json=?,certificate_id=?,certificate_version=2,certificate_json=?,certificate_signature=?,device_fingerprint=?,device_status='active',expires_at=?,offline_valid_until=?,last_validated_at=?,updated_at=? where id=1").run(certificate.license_id,certificate.customer_id,vendor,JSON.stringify(certificate.features),certificate.certificate_id,JSON.stringify(certificate),signCertificate(certificate,vendorKey.privateKey.export({type:'pkcs8',format:'pem'}).toString()),certificate.device_fingerprint,certificate.expires_at,new Date(Date.now()+30*86_400_000).toISOString(),stamp,stamp);
    app=await buildLocalApp({paths,database:db});
    let login=await app.inject({method:'POST',url:'/api/login',payload:{email:'universal@test.invalid',password:'secret'}});
    const auth={authorization:`Bearer ${login.json().data.access_token}`};
    const created=await app.inject({method:'POST',url:'/api/categories',headers:auth,payload:{name:'Offline category',is_public:true}});
    assert.equal(created.statusCode,200,created.body);
    const localId=Number(created.json().data.id),outbox=(await app.inject({method:'GET',url:'/api/sync/v1/outbox',headers:auth})).json().data;
    assert.equal(outbox.length,1);
    assert.equal(outbox[0].entity_type,'categories');
    assert.equal(outbox[0].data.name,'Offline category');
    assert.equal((await app.inject({method:'POST',url:`/api/sync/v1/outbox/${outbox[0].client_id}/retry`,headers:auth,payload:{error:'OFFLINE'}})).statusCode,200);
    const retried=db.prepare('select sync_status,attempts,last_error from sync_mutations where client_id=?').get(outbox[0].client_id);
    assert.equal(retried.sync_status,'failed');assert.equal(Number(retried.attempts),1);assert.equal(retried.last_error,'OFFLINE');
    await app.close();app=null;db.close();db=null;
    db=openLocalDatabase(paths);app=await buildLocalApp({paths,database:db});
    login=await app.inject({method:'POST',url:'/api/login',payload:{email:'universal@test.invalid',password:'secret'}});
    const afterRestart={authorization:`Bearer ${login.json().data.access_token}`};
    assert.equal((await app.inject({method:'GET',url:'/api/sync/v1/outbox',headers:afterRestart})).json().data[0].client_id,outbox[0].client_id);
    assert.equal((await app.inject({method:'POST',url:`/api/sync/outbox/${outbox[0].client_id}/ack`,headers:afterRestart})).statusCode,200);
    const categorySync=outbox[0].sync_id,unitSync=crypto.randomUUID(),cursor=`${new Date().toISOString()}|2`;
    const failed=await app.inject({method:'POST',url:'/api/sync/v1/apply',headers:afterRestart,payload:{cursor,changes:[
      {entity_type:'categories',sync_id:categorySync,server_id:41,deleted:false,updated_at:stamp,data:{name:'Remote category',image:null,is_public:true}},
      {entity_type:'units',sync_id:unitSync,server_id:42,deleted:false,updated_at:stamp,data:{code:'pc',name:'Piece',precision:-1,active:true}},
    ]}});
    assert.ok(failed.statusCode>=400,failed.body);
    assert.equal(db.prepare('select name from categories where id=?').get(localId).name,'Offline category');
    assert.equal(db.prepare("select value from sync_state where key='universal_v1_cursor'").get(),undefined);
    const applied=await app.inject({method:'POST',url:'/api/sync/v1/apply',headers:afterRestart,payload:{cursor,changes:[
      {entity_type:'categories',sync_id:categorySync,server_id:41,deleted:false,updated_at:stamp,data:{name:'Remote category',image:null,is_public:true}},
      {entity_type:'units',sync_id:unitSync,server_id:42,deleted:false,updated_at:stamp,data:{code:'pc',name:'Piece',precision:0,active:true}},
    ]}});
    assert.equal(applied.statusCode,200,applied.body);
    assert.equal(db.prepare('select name from categories where id=?').get(localId).name,'Remote category');
    assert.equal(Number(db.prepare('select count(*) n from units where business_id=1').get().n),1);
    assert.equal((await app.inject({method:'POST',url:'/api/sync/v1/apply',headers:afterRestart,payload:{cursor,changes:[]}})).json().message,'Already reconciled.');
    assert.equal(Number(db.prepare("select count(*) n from sync_mutations where entity_type in ('categories','units','customers') and sync_status in ('pending','failed')").get().n),0);
  }finally{if(app)await app.close();if(db)db.close();if(previousKey===undefined)delete process.env.LICENSE_SIGNING_PUBLIC_KEY;else process.env.LICENSE_SIGNING_PUBLIC_KEY=previousKey;fs.rmSync(root,{recursive:true,force:true});}
});
