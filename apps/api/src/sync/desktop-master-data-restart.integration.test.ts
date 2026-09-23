import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import Fastify from 'fastify';
import pg from 'pg';
import {openLocalDatabase} from '../local/database.js';
import {ensureLocalPaths,resolveLocalPaths} from '../local/paths.js';
import {buildLocalApp} from '../local/server.js';
import {fingerprint,signCertificate,type LicenseCertificateV2} from '../license/crypto.js';

const url=process.env.TEST_DATABASE_URL;
if(url&&!decodeURIComponent(new URL(url).pathname).endsWith('_test'))throw new Error('Disposable _test database required');
process.env.DATABASE_URL=url??'postgresql://unused@localhost/unused_test';
process.env.CONTROL_PLANE_DATABASE_URL=process.env.DATABASE_URL;
process.env.JWT_SECRET='master-restart-test-secret-at-least-32-characters';
process.env.NODE_ENV='test';
process.env.SAAS_TENANCY_MODE='shared';
const enabled=Boolean(url),pool=new pg.Pool({connectionString:url});
const ids={customer:'50000000-0000-4000-8000-000000000001',vendor:'50000000-0000-4000-8000-000000000002',license:'50000000-0000-4000-8000-000000000003',certificate:'50000000-0000-4000-8000-000000000004'};
type Device={installation_id:string;public_key:string;privateKey:crypto.KeyObject};
const stable=(v:any):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`:JSON.stringify(v);
const signed=(action:string,d:Device,m?:any)=>{const nonce=crypto.randomUUID(),requested_at=new Date().toISOString(),raw={license_id:ids.license,certificate_id:ids.certificate,installation_id:d.installation_id,device_public_key:d.public_key,nonce,requested_at},line=(x:any)=>x==null?'':String(x),payload=['desktop-master-sync-v1',action,raw.license_id,raw.certificate_id,raw.installation_id,raw.device_public_key,nonce,requested_at,line(m?.client_id),line(m?.entity_type),line(m?.sync_id),line(m?.operation),line(m?.base_updated_at),m?stable(m.data):''].join('\n');return{...raw,device_proof:crypto.sign(null,Buffer.from(payload),d.privateKey).toString('base64url')}};

async function seedHosted(d:Device){
  await pool.query('truncate license_customers,businesses,saas_tenants restart identity cascade');
  await pool.query("insert into license_customers(id,name) values($1,'Restart sync')",[ids.customer]);
  await pool.query("insert into vendor_businesses(id,customer_id,name,business_type,status) values($1,$2,'Restart sync','cafe','active')",[ids.vendor,ids.customer]);
  await pool.query("insert into licenses(id,customer_id,vendor_business_id,business_type,status,allowed_features,max_devices,expires_at) values($1,$2,$3,'cafe','active','[\"pos\"]',1,now()+interval '30 days')",[ids.license,ids.customer,ids.vendor]);
  await pool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Restart','restart','cafe','MAD','fr-MA','Africa/Casablanca',$1)",[ids.vendor]);
  const deviceId=crypto.randomUUID();
  await pool.query("insert into license_devices(id,license_id,installation_id,device_public_key,device_fingerprint,channel,status) values($1,$2,$3,$4,$5,'desktop','active')",[deviceId,ids.license,d.installation_id,d.public_key,fingerprint(d.public_key)]);
  await pool.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'offline','approved',$4)",[ids.license,deviceId,ids.certificate,crypto.randomUUID()]);
}

test('master data restart/reconnect preserves an on-disk SQLite outbox and converges once',{skip:!enabled,concurrency:false},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-master-restart-'));
  const paths=ensureLocalPaths(resolveLocalPaths({BIMIK_DATA_DIR:root}));
  const keys=crypto.generateKeyPairSync('ed25519');
  const d:Device={installation_id:crypto.randomUUID(),public_key:JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey:keys.privateKey};
  const vendor=crypto.generateKeyPairSync('ed25519');
  const previousKey=process.env.LICENSE_SIGNING_PUBLIC_KEY;
  process.env.LICENSE_SIGNING_PUBLIC_KEY=vendor.publicKey.export({type:'spki',format:'pem'}).toString();
  let db:any,app:any,host:any;
  try{
    db=openLocalDatabase(paths);
    const stamp=new Date().toISOString(),password=await bcrypt.hash('1',4);
    db.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values(1,'Restart','restart','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?,?)").run(ids.vendor,stamp,stamp);
    db.prepare("insert into branches(id,business_id,name,code,active,created_at,updated_at) values(1,1,'Main','MAIN',1,?,?)").run(stamp,stamp);
    db.prepare("insert into users(name,email,password,role,is_active,business_id,branch_id,created_at,updated_at) values('Patron','restart@test.invalid','"+password+"','patron',1,1,1,?,?)").run(stamp,stamp);
    const certificate:LicenseCertificateV2={version:2,certificate_id:ids.certificate,license_id:ids.license,customer_id:ids.customer,vendor_business_id:ids.vendor,business_id:null,business_type:'cafe',plan:'business',features:['pos','inventory','product_variants'],installation_id:d.installation_id,device_fingerprint:fingerprint(d.public_key),issued_at:stamp,expires_at:new Date(Date.now()+86_400_000).toISOString(),offline_validity_days:30};
    db.prepare("update merchant_license_state set status='active',license_id=?,customer_id=?,vendor_business_id=?,business_type='cafe',allowed_features_json=?,certificate_id=?,certificate_version=2,certificate_json=?,certificate_signature=?,device_fingerprint=?,device_status='active',expires_at=?,offline_valid_until=?,last_validated_at=?,updated_at=? where id=1").run(ids.license,ids.customer,ids.vendor,JSON.stringify(certificate.features),ids.certificate,JSON.stringify(certificate),signCertificate(certificate,vendor.privateKey.export({type:'pkcs8',format:'pem'}).toString()),certificate.device_fingerprint,certificate.expires_at,new Date(Date.now()+30*86_400_000).toISOString(),stamp,stamp);
    app=await buildLocalApp({paths,database:db});
    let login=await app.inject({method:'POST',url:'/api/login',payload:{email:'restart@test.invalid',password:'1'}}),auth={authorization:`Bearer ${login.json().data.access_token}`};
    const categoryResponse=await app.inject({method:'POST',url:'/api/categories',headers:auth,payload:{name:'Offline category',is_public:true}});
    assert.equal(categoryResponse.statusCode,200,categoryResponse.body);
    const categoryId=Number(categoryResponse.json().data.id);
    const productResponse=await app.inject({method:'POST',url:'/api/products',headers:auth,payload:{category_id:categoryId,name:'Offline product',sale_price:12,stock:3,min_stock:0,track_stock:false,is_active:true,is_public:true,available:true}});
    assert.equal(productResponse.statusCode,200,productResponse.body);
    const productId=Number(productResponse.json().data.id);
    const variantId=Number(db.prepare("insert into product_variants(business_id,product_id,name,sku,barcode,price_delta_cents,active,created_at,updated_at) values(1,?,'Offline variant',null,null,250,1,?,?)").run(productId,stamp,stamp).lastInsertRowid);
    const pending=(await app.inject({method:'GET',url:'/api/sync/master-data/outbox',headers:auth})).json().data;
    assert.deepEqual(pending.map((m:any)=>m.payload.entity_type),['categories','products','product_variants']);
    assert.equal(pending[1].payload.data.category_sync_id,pending[0].payload.sync_id);
    assert.equal(pending[2].payload.data.product_sync_id,pending[1].payload.sync_id);
    const original={category:db.prepare('select name from categories where id=?').get(categoryId)?.name,product:db.prepare('select name,category_id from products where id=?').get(productId),variant:db.prepare('select name,product_id from product_variants where id=?').get(variantId)};
    await app.close();app=null;db.close();db=null;
    assert.ok(fs.existsSync(paths.database));
    db=openLocalDatabase(paths);app=await buildLocalApp({paths,database:db});
    login=await app.inject({method:'POST',url:'/api/login',payload:{email:'restart@test.invalid',password:'1'}});auth={authorization:`Bearer ${login.json().data.access_token}`};
    assert.equal(db.prepare('select name from categories where id=?').get(categoryId)?.name,original.category);
    assert.deepEqual(db.prepare('select name,category_id from products where id=?').get(productId),original.product);
    assert.deepEqual(db.prepare('select name,product_id from product_variants where id=?').get(variantId),original.variant);
    const afterRestart=(await app.inject({method:'GET',url:'/api/sync/master-data/outbox',headers:auth})).json().data;
    assert.deepEqual(afterRestart.map((m:any)=>m.client_id),pending.map((m:any)=>m.client_id));
    await seedHosted(d);
    const mod=await import('./desktop-master-data.js');host=Fastify();host.setErrorHandler((e:any,_r:any,r:any)=>r.code(e.statusCode??500).send({message:e.message,code:e.code}));await mod.registerDesktopMasterDataSync(host,{pool,controlPool:pool});await host.ready();
    const reconcile=async()=>{
      const queued=(await app.inject({method:'GET',url:'/api/sync/master-data/outbox',headers:auth})).json().data;
      for(const item of queued){const pushed=await host.inject({method:'POST',url:'/api/desktop-sync/master-data/push',payload:{device:signed('push',d,item.payload),mutation:item.payload}});assert.equal(pushed.statusCode,201,pushed.body);const acknowledged=await app.inject({method:'POST',url:`/api/sync/outbox/${item.client_id}/ack`,headers:auth});assert.equal(acknowledged.statusCode,200,acknowledged.body)}
      const state=(await app.inject({method:'GET',url:'/api/sync/master-data/state',headers:auth})).json().data;
      const pull=await host.inject({method:'GET',url:'/api/desktop-sync/master-data/pull',query:{...signed('pull',d),cursor:state.cursor??''}});assert.equal(pull.statusCode,200,pull.body);
      const applied=await app.inject({method:'POST',url:'/api/sync/master-data/apply',headers:auth,payload:{changes:pull.json().data.changes,cursor:pull.json().data.cursor??state.cursor}});assert.equal(applied.statusCode,200,applied.body);
      return {queued,pull:pull.json().data};
    };
    const first=await reconcile();assert.equal(first.queued.length,3);
    assert.equal((await pool.query('select count(*)::int n from categories')).rows[0].n,1);
    assert.equal((await pool.query('select count(*)::int n from products')).rows[0].n,1);
    assert.equal((await pool.query('select count(*)::int n from product_variants')).rows[0].n,1);
    assert.equal((await pool.query('select count(*)::int n from products p join categories c on c.id=p.category_id join product_variants v on v.product_id=p.id')).rows[0].n,1);
    const mappings=db.prepare("select entity_type,server_id,sync_status from master_sync_entities where entity_type in ('categories','products','product_variants') order by case entity_type when 'categories' then 1 when 'products' then 2 else 3 end").all();
    assert.equal(mappings.length,3);assert.ok(mappings.every((m:any)=>Number(m.server_id)>0&&m.sync_status==='synced'));
    assert.equal(Number(db.prepare("select count(*) n from sync_mutations where sync_status='synced' and entity_type in ('categories','products','product_variants')").get().n),3);
    const mutationCount=Number(db.prepare('select count(*) n from sync_mutations').get().n),cursor=(await app.inject({method:'GET',url:'/api/sync/master-data/state',headers:auth})).json().data.cursor;
    assert.ok(cursor);
    const second=await reconcile();assert.equal(second.queued.length,0);assert.equal(second.pull.changes.length,0);assert.equal(second.pull.cursor,cursor);
    assert.equal(Number(db.prepare('select count(*) n from sync_mutations').get().n),mutationCount);
    assert.equal((await pool.query('select count(*)::int n from categories')).rows[0].n,1);
    assert.equal((await pool.query('select count(*)::int n from products')).rows[0].n,1);
    assert.equal((await pool.query('select count(*)::int n from product_variants')).rows[0].n,1);
  }finally{if(host)await host.close();if(app)await app.close();if(db)db.close();if(previousKey===undefined)delete process.env.LICENSE_SIGNING_PUBLIC_KEY;else process.env.LICENSE_SIGNING_PUBLIC_KEY=previousKey;fs.rmSync(root,{recursive:true,force:true});}
});
