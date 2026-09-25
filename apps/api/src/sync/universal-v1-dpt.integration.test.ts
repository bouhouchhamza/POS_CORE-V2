import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify,{type FastifyReply,type FastifyRequest} from 'fastify';
import websocket from '@fastify/websocket';
import pg from 'pg';
import {openLocalDatabase,immediate} from '../local/database.js';
import {ensureLocalPaths,resolveLocalPaths} from '../local/paths.js';
import {registerLocalUniversalV1Sync} from '../local/universal-v1-sync.js';
import {commitHostedMasterDataChange,insertHostedCategory,insertHostedCustomer,insertHostedUnit,updateHostedCategory} from './hosted-master-data.js';

const controlUrl=process.env.UNIVERSAL_V1_CONTROL_DATABASE_URL;
const tenantAUrl=process.env.UNIVERSAL_V1_TENANT_A_DATABASE_URL;
const tenantBUrl=process.env.UNIVERSAL_V1_TENANT_B_DATABASE_URL;
const tenantTemplate=process.env.UNIVERSAL_V1_TENANT_DATABASE_URL_TEMPLATE;
const tenantAdminUrl=process.env.UNIVERSAL_V1_TENANT_ADMIN_DATABASE_URL;
const testDatabaseName=(url:string|undefined)=>{
  if(!url)throw new Error('Universal V1 disposable database configuration is required.');
  const parsed=new URL(url),name=decodeURIComponent(parsed.pathname).slice(1);
  if(parsed.hostname!=='127.0.0.1'||!name.endsWith('_test'))throw new Error('Universal V1 databases must be local disposable _test databases.');
  return name;
};
const databaseA=testDatabaseName(tenantAUrl),databaseB=testDatabaseName(tenantBUrl);testDatabaseName(controlUrl);
if(!tenantTemplate?.includes('{database}'))throw new Error('Universal V1 tenant database template is required.');
if(!tenantAdminUrl||new URL(tenantAdminUrl).hostname!=='127.0.0.1')throw new Error('Universal V1 local tenant administrator database configuration is required.');
process.env.DATABASE_URL=controlUrl;process.env.CONTROL_PLANE_DATABASE_URL=controlUrl;process.env.JWT_SECRET??=crypto.randomBytes(32).toString('hex');process.env.NODE_ENV='test';process.env.SAAS_TENANCY_MODE='database_per_tenant';process.env.SAAS_TENANT_DATABASE_URL_TEMPLATE=tenantTemplate;process.env.SAAS_DATABASE_ADMIN_URL=tenantAdminUrl;
const control=new pg.Pool({connectionString:controlUrl}),a=new pg.Pool({connectionString:tenantAUrl}),b=new pg.Pool({connectionString:tenantBUrl});let app:ReturnType<typeof Fastify>;
const ids={customer:'92000000-0000-4000-8000-000000000001',vendorA:'92000000-0000-4000-8000-000000000002',vendorB:'92000000-0000-4000-8000-000000000003',license:'92000000-0000-4000-8000-000000000004',certificate:'92000000-0000-4000-8000-000000000005',tenantA:'92000000-0000-4000-8000-000000000006',tenantB:'92000000-0000-4000-8000-000000000007'};
type Device={installation_id:string;public_key:string;privateKey:crypto.KeyObject};
const stable=(value:any):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
const signed=(action:'pull'|'push',d:Device,mutations:any[]=[])=>{const nonce=crypto.randomUUID(),requested_at=new Date().toISOString(),raw={license_id:ids.license,certificate_id:ids.certificate,installation_id:d.installation_id,device_public_key:d.public_key,nonce,requested_at};return{...raw,device_proof:crypto.sign(null,Buffer.from(['desktop-universal-sync-v1',action,raw.license_id,raw.certificate_id,raw.installation_id,raw.device_public_key,nonce,requested_at,stable(mutations)].join('\n')),d.privateKey).toString('base64url')}};
const waitFor=async(predicate:()=>boolean,timeoutMs=4_000)=>{const deadline=Date.now()+timeoutMs;while(!predicate()){if(Date.now()>deadline)throw new Error('Timed out waiting for Universal V1 reconciliation.');await new Promise(resolve=>setTimeout(resolve,10));}};

test.before(async()=>{
  const {migrateTenantDatabase}=await import('../saas/tenant-provisioning.js');await migrateTenantDatabase(a);await migrateTenantDatabase(b);
  await a.query('truncate businesses restart identity cascade');await b.query('truncate businesses restart identity cascade');
  await control.query('truncate license_customers,businesses,saas_tenants restart identity cascade');
  await control.query("insert into license_customers(id,name) values($1,'Universal DPT')",[ids.customer]);
  for(const [vendor,tenant,database,pool] of [[ids.vendorA,ids.tenantA,databaseA,a],[ids.vendorB,ids.tenantB,databaseB,b]] as const){
    await control.query("insert into vendor_businesses(id,customer_id,name,business_type,status) values($1,$2,$3,'cafe','active')",[vendor,ids.customer,database]);
    await control.query("insert into saas_tenants(id,vendor_business_id,slug,database_name,status) values($1,$2,$3,$4,'active')",[tenant,vendor,database,database]);
    await pool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Universal DPT',$1,'cafe','MAD','fr-MA','Africa/Casablanca',$2)",[database,vendor]);
  }
  const keys=crypto.generateKeyPairSync('ed25519'),d:Device={installation_id:crypto.randomUUID(),public_key:JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey:keys.privateKey};(globalThis as any).device=d;
  await control.query("insert into licenses(id,customer_id,vendor_business_id,business_type,status,allowed_features,max_devices,expires_at) values($1,$2,$3,'cafe','active','[\"pos\"]',2,now()+interval '30 days')",[ids.license,ids.customer,ids.vendorA]);
  const deviceId=crypto.randomUUID(),fingerprint=crypto.createHash('sha256').update(d.public_key).digest('hex');
  await control.query("insert into license_devices(id,license_id,installation_id,device_public_key,device_fingerprint,channel,status) values($1,$2,$3,$4,$5,'desktop','active')",[deviceId,ids.license,d.installation_id,d.public_key,fingerprint]);
  await control.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'offline','approved',$4)",[ids.license,deviceId,ids.certificate,crypto.randomUUID()]);
  const {registerUniversalSyncV1}=await import('./universal-v1.js'),{registerDesktopRealtime}=await import('./desktop-realtime.js');
  app=Fastify();app.setErrorHandler((error:any,_request:any,reply:any)=>reply.code(error.statusCode??500).send({message:error.message,code:error.code}));
  await app.register(websocket,{options:{maxPayload:16*1024,perMessageDeflate:false}});
  registerDesktopRealtime(app,{authenticate:async()=>({channelKey:ids.vendorA})});
  await registerUniversalSyncV1(app,{pool:control,controlPool:control});
  // These are the exact committed service/repository functions called by the
  // production Hosted category, unit, and customer API routes.
  app.post('/api/categories',async(request:FastifyRequest,reply:FastifyReply)=>{const input=request.body as any,result=await commitHostedMasterDataChange(a,1,client=>insertHostedCategory(client,1,{name:input.name,image:input.image??null,is_public:input.is_public}));return reply.code(201).send({data:result.rows[0]})});
  app.put('/api/categories/:id',async(request:FastifyRequest,reply:FastifyReply)=>{const input=request.body as any,id=Number((request.params as any).id),result=await commitHostedMasterDataChange(a,1,client=>updateHostedCategory(client,1,id,{name:input.name,image:input.image??null,is_public:input.is_public}));return reply.send({data:result.rows[0]})});
  app.post('/api/units',async(request:FastifyRequest,reply:FastifyReply)=>{const input=request.body as any,result=await commitHostedMasterDataChange(a,1,client=>insertHostedUnit(client,1,input));return reply.code(201).send({data:result.rows[0]})});
  app.post('/api/customers',async(request:FastifyRequest,reply:FastifyReply)=>{const input=request.body as any,result=await commitHostedMasterDataChange(a,1,client=>insertHostedCustomer(client,1,input));return reply.code(201).send({data:result.rows[0]})});
  await app.ready();
});
test.after(async()=>{if(app)await app.close();const{closeTenantPools}=await import('../saas/tenant-context.js');await closeTenantPools();await a.end();await b.end();await control.end()});

test('real Hosted CRUD projects canonical V1 data, realtime reconciles SQLite, and polling recovers',async()=>{
  const d=(globalThis as any).device as Device,root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-universal-real-e2e-')),paths=ensureLocalPaths(resolveLocalPaths({BIMIK_DATA_DIR:root}));
  const localDb=openLocalDatabase(paths),local=Fastify(),pullPayloads:any[]=[],events:any[]=[];
  registerLocalUniversalV1Sync(local,localDb,async()=>{},()=>({business_id:1}),operation=>immediate(localDb,operation));
  local.setErrorHandler((error:any,_request:any,reply:any)=>reply.code(error.statusCode??500).send({message:error.message,code:error.code}));await local.ready();
  const stamp=new Date().toISOString();localDb.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values(1,'Universal','universal','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?,?)").run(ids.vendorA,stamp,stamp);
  let cursor:string|null=null;
  const reconcile=async()=>{const response=await app.inject({method:'GET',url:'/api/desktop-sync/v1/pull',query:{...signed('pull',d),cursor:cursor??''}});assert.equal(response.statusCode,200,response.body);const payload=response.json().data;pullPayloads.push(payload);const applied=await local.inject({method:'POST',url:'/api/sync/v1/apply',payload});assert.equal(applied.statusCode,200,applied.body);cursor=payload.cursor;return payload};
  const socket=await app.injectWS('/api/desktop-sync/realtime');let queue=Promise.resolve();socket.on('message',(raw:any)=>{const event=JSON.parse(raw.toString());events.push(event);if(event.type==='sync_required')queue=queue.then(()=>reconcile())});socket.send(JSON.stringify({type:'authenticate',device:{}}));await waitFor(()=>events.some(event=>event.type==='ready'));
  try{
    const category=await app.inject({method:'POST',url:'/api/categories',payload:{name:'Hosted Web Category',image:null,is_public:true}});
    const unit=await app.inject({method:'POST',url:'/api/units',payload:{code:'ea',name:'Each',precision:0,active:true}});
    const customer=await app.inject({method:'POST',url:'/api/customers',payload:{name:'Hosted Customer',phone:null,email:'hosted@example.test',address:null,notes:null,active:true}});
    for(const response of [category,unit,customer])assert.equal(response.statusCode,201,response.body);
    await waitFor(()=>Boolean(localDb.prepare("select value from sync_state where key='universal_v1_cursor'").get()?.value)&&Number(localDb.prepare('select count(*) n from categories where business_id=1').get()?.n)===1&&Number(localDb.prepare('select count(*) n from units where business_id=1').get()?.n)===1&&Number(localDb.prepare('select count(*) n from customers where business_id=1').get()?.n)===1);
    await queue;
    const projected=(await a.query("select entity_type,entity_id,sync_id,payload,deleted,updated_at from master_sync_rows where business_id=1 and entity_type in ('categories','units','customers') order by id")).rows;
    assert.equal(projected.length,3);assert.ok(projected.every(row=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.sync_id)));
    assert.deepEqual(Object.keys(projected.find(row=>row.entity_type==='categories').payload).sort(),['business_id','created_at','image','is_public','name','updated_at']);
    assert.deepEqual(Object.keys(projected.find(row=>row.entity_type==='units').payload).sort(),['active','business_id','code','created_at','name','precision','updated_at']);
    assert.deepEqual(Object.keys(projected.find(row=>row.entity_type==='customers').payload).sort(),['active','address','business_id','created_at','email','name','notes','phone','updated_at']);
    const allChanges=pullPayloads.flatMap(payload=>payload.changes),latest=new Map(allChanges.map((change:any)=>[change.entity_type,change]));
    assert.deepEqual(latest.get('categories')?.data,{name:'Hosted Web Category',image:null,is_public:true});
    assert.deepEqual(latest.get('units')?.data,{code:'ea',name:'Each',precision:0,active:true});
    assert.deepEqual(latest.get('customers')?.data,{name:'Hosted Customer',phone:null,email:'hosted@example.test',address:null,notes:null,active:true});
    assert.equal(localDb.prepare("select name from categories where business_id=1").get()?.name,'Hosted Web Category');
    assert.equal(localDb.prepare("select name from units where business_id=1").get()?.name,'Each');
    assert.equal(localDb.prepare("select name from customers where business_id=1").get()?.name,'Hosted Customer');
    assert.equal(localDb.prepare("select value from sync_state where key='universal_v1_cursor'").get()?.value,cursor);
    const next=await reconcile();assert.equal(next.changes.length,0);assert.equal(next.cursor,cursor);
    const categoryProjection=projected.find(row=>row.entity_type==='categories'),originalCategorySyncId=categoryProjection.sync_id;
    const updated=await app.inject({method:'PUT',url:`/api/categories/${categoryProjection.entity_id}`,payload:{name:'Hosted Web Category Updated',image:null,is_public:true}});assert.equal(updated.statusCode,200,updated.body);
    await waitFor(()=>localDb.prepare("select name from categories where business_id=1").get()?.name==='Hosted Web Category Updated');await queue;
    assert.equal((await a.query("select sync_id from master_sync_rows where business_id=1 and entity_type='categories' and entity_id=$1",[categoryProjection.entity_id])).rows[0].sync_id,originalCategorySyncId);
    const beforeRollback=events.filter(event=>event.type==='sync_required').length;
    const rolledBack=await app.inject({method:'POST',url:'/api/units',payload:{code:'ea',name:'Duplicate',precision:0,active:true}});assert.equal(rolledBack.statusCode,500,rolledBack.body);await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='sync_required').length,beforeRollback);
    socket.terminate();
    const pollingOnly=await app.inject({method:'POST',url:'/api/categories',payload:{name:'Polling Recovery',image:null,is_public:true}});assert.equal(pollingOnly.statusCode,201,pollingOnly.body);
    assert.equal(localDb.prepare("select count(*) n from categories where name='Polling Recovery'").get()?.n,0);
    const recovered=await reconcile();assert.equal(recovered.changes.length,1);assert.equal(recovered.changes[0].data.name,'Polling Recovery');assert.equal(localDb.prepare("select count(*) n from categories where name='Polling Recovery'").get()?.n,1);
    assert.equal(Number((await b.query("select count(*)::int n from master_sync_rows where entity_type in ('categories','units','customers')")).rows[0].n),0);
  }finally{socket.terminate();await local.close();localDb.close();fs.rmSync(root,{recursive:true,force:true})}
});
