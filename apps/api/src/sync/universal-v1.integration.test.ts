import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import websocket from '@fastify/websocket';

const url=process.env.UNIVERSAL_V1_CONTROL_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||!decodeURIComponent(new URL(url).pathname).endsWith('_test'))throw new Error('A local disposable _test database is required.');
process.env.DATABASE_URL=url;process.env.CONTROL_PLANE_DATABASE_URL=url;process.env.JWT_SECRET??=crypto.randomBytes(32).toString('hex');process.env.NODE_ENV='test';process.env.SAAS_TENANCY_MODE='shared';
const pool=new pg.Pool({connectionString:url});let app:ReturnType<typeof Fastify>;
const ids={customer:'91000000-0000-4000-8000-000000000001',vendor:'91000000-0000-4000-8000-000000000002',license:'91000000-0000-4000-8000-000000000003',certificate:'91000000-0000-4000-8000-000000000004'};
type Device={installation_id:string;public_key:string;privateKey:crypto.KeyObject};
const stable=(value:any):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);
const device=():Device=>{const keys=crypto.generateKeyPairSync('ed25519');return{installation_id:crypto.randomUUID(),public_key:JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey:keys.privateKey}};
const signed=(action:string,d:Device,mutations:any[]=[])=>(()=>{const nonce=crypto.randomUUID(),requested_at=new Date().toISOString(),raw={license_id:ids.license,certificate_id:ids.certificate,installation_id:d.installation_id,device_public_key:d.public_key,nonce,requested_at};return{...raw,device_proof:crypto.sign(null,Buffer.from(['desktop-universal-sync-v1',action,raw.license_id,raw.certificate_id,raw.installation_id,raw.device_public_key,nonce,requested_at,stable(mutations)].join('\n')),d.privateKey).toString('base64url')}})();
async function seed(d:Device){
  await pool.query('truncate license_customers,businesses,saas_tenants restart identity cascade');
  await pool.query("insert into license_customers(id,name) values($1,'Universal V1')",[ids.customer]);
  await pool.query("insert into vendor_businesses(id,customer_id,name,business_type,status) values($1,$2,'Universal V1','cafe','active')",[ids.vendor,ids.customer]);
  await pool.query("insert into licenses(id,customer_id,vendor_business_id,business_type,status,allowed_features,max_devices,expires_at) values($1,$2,$3,'cafe','active','[\"pos\"]',2,now()+interval '30 days')",[ids.license,ids.customer,ids.vendor]);
  await pool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Universal','universal','cafe','MAD','fr-MA','Africa/Casablanca',$1)",[ids.vendor]);
  const deviceId=crypto.randomUUID(),fingerprint=crypto.createHash('sha256').update(d.public_key).digest('hex');
  await pool.query("insert into license_devices(id,license_id,installation_id,device_public_key,device_fingerprint,channel,status) values($1,$2,$3,$4,$5,'desktop','active')",[deviceId,ids.license,d.installation_id,d.public_key,fingerprint]);
  await pool.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'offline','approved',$4)",[ids.license,deviceId,ids.certificate,crypto.randomUUID()]);
}
test.before(async()=>{const {registerUniversalSyncV1}=await import('./universal-v1.js'),{registerDesktopRealtime}=await import('./desktop-realtime.js');app=Fastify();app.setErrorHandler((error:any,_request:any,reply:any)=>reply.code(error.statusCode??500).send({message:error.message,code:error.code}));await app.register(websocket,{options:{maxPayload:16*1024,perMessageDeflate:false}});registerDesktopRealtime(app,{authenticate:async()=>({channelKey:ids.vendor})});await registerUniversalSyncV1(app,{pool,controlPool:pool});await app.ready()});
test.after(async()=>{await app.close();await pool.end()});

test('Universal V1 hosted push uses static pilot adapters, is idempotent, and pull paginates without skips',async()=>{
  const d=device();await seed(d);
  const socket=await app.injectWS('/api/desktop-sync/realtime'),events:any[]=[];socket.on('message',(raw:any)=>events.push(JSON.parse(raw.toString())));socket.send(JSON.stringify({type:'authenticate',device:{}}));while(!events.some(event=>event.type==='ready'))await new Promise(resolve=>setImmediate(resolve));
  const records:any[]=[
    ['categories',{name:'Food',image:null,is_public:true}],
    ['units',{code:'pc',name:'Piece',precision:0,active:true}],
    ['customers',{name:'Ada',phone:null,email:null,address:null,notes:null,active:true}],
  ].map(([entity_type,data])=>({client_id:crypto.randomUUID(),entity_type,sync_id:crypto.randomUUID(),operation:'upsert',base_updated_at:null,data}));
  const push=async(mutations:any[])=>app.inject({method:'POST',url:'/api/desktop-sync/v1/push',payload:{device:signed('push',d,mutations),mutations}});
  const first=await push(records);assert.equal(first.statusCode,200,first.body);assert.deepEqual(first.json().data.results.map((result:any)=>result.status),['acked','acked','acked']);
  while(events.filter(event=>event.type==='sync_required').length<3)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(events.filter(event=>event.type==='sync_required').every(event=>Array.isArray(event.scopes)&&event.scopes.length===1&&event.scopes[0]==='master'));
  const replay=await push(records);assert.equal(replay.statusCode,200,replay.body);assert.ok(replay.json().data.results.every((result:any)=>result.replayed));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='sync_required').length,3);
  const conflict={...records[0],client_id:crypto.randomUUID(),base_updated_at:'2000-01-01T00:00:00.000Z',data:{name:'Stale',image:null,is_public:true}};
  const conflicted=await push([conflict]);assert.equal(conflicted.statusCode,200,conflicted.body);assert.equal(conflicted.json().data.results[0].code,'MASTER_DATA_CONFLICT');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='sync_required').length,3);
  assert.equal(Number((await pool.query('select count(*)::int n from categories where business_id=1')).rows[0].n),1);
  assert.equal(Number((await pool.query('select count(*)::int n from units where business_id=1')).rows[0].n),1);
  assert.equal(Number((await pool.query('select count(*)::int n from customers where business_id=1')).rows[0].n),1);
  const deletes=records.map(record=>({...record,client_id:crypto.randomUUID(),operation:'delete',data:null}));
  assert.deepEqual((await push(deletes)).json().data.results.map((result:any)=>result.status),['acked','acked','acked']);
  assert.equal(Number((await pool.query('select count(*)::int n from categories where business_id=1')).rows[0].n),0);
  assert.equal(Number((await pool.query('select count(*)::int n from units where business_id=1')).rows[0].n),0);
  assert.equal(Number((await pool.query('select count(*)::int n from customers where business_id=1')).rows[0].n),0);
  const malicious={...records[0],client_id:crypto.randomUUID(),entity_type:'categories; drop table customers; --',operation:'delete',data:null};
  const rejected=await app.inject({method:'POST',url:'/api/desktop-sync/v1/push',payload:{device:signed('push',d,[malicious]),mutations:[malicious]}});assert.equal(rejected.statusCode,422,rejected.body);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='sync_required').length,6);
  const invalid={...records[0],client_id:crypto.randomUUID(),sync_id:crypto.randomUUID(),data:{name:'',image:null,is_public:true}};
  const rolledBack=await push([invalid]);assert.equal(rolledBack.statusCode,200,rolledBack.body);assert.equal(rolledBack.json().data.results[0].code,'SYNC_INPUT_INVALID');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='sync_required').length,6);
  await pool.query("insert into categories(business_id,name,is_public) select 1,'Category '||n,true from generate_series(1,501) n");
  const pull=async(cursor='')=>app.inject({method:'GET',url:'/api/desktop-sync/v1/pull',query:{...signed('pull',d),cursor}});
  const pageOne=await pull();assert.equal(pageOne.statusCode,200,pageOne.body);assert.equal(pageOne.json().data.changes.length,500);
  const pageTwo=await pull(pageOne.json().data.cursor);assert.equal(pageTwo.statusCode,200,pageTwo.body);assert.ok(pageTwo.json().data.changes.length>=4);
  const idsPulled=[...pageOne.json().data.changes,...pageTwo.json().data.changes].map((change:any)=>change.sync_id);assert.equal(new Set(idsPulled).size,idsPulled.length);
  await pool.query('update license_devices set status=\'revoked\' where license_id=$1',[ids.license]);
  assert.equal((await pull()).statusCode,403);socket.terminate();
});
