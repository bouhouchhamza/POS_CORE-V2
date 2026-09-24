import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';

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
const signed=(d:Device,mutations:any[])=>(()=>{const nonce=crypto.randomUUID(),requested_at=new Date().toISOString(),raw={license_id:ids.license,certificate_id:ids.certificate,installation_id:d.installation_id,device_public_key:d.public_key,nonce,requested_at};return{...raw,device_proof:crypto.sign(null,Buffer.from(['desktop-universal-sync-v1','push',raw.license_id,raw.certificate_id,raw.installation_id,raw.device_public_key,nonce,requested_at,stable(mutations)].join('\n')),d.privateKey).toString('base64url')}})();

test.before(async()=>{
  const {migrateTenantDatabase}=await import('../saas/tenant-provisioning.js');await migrateTenantDatabase(a);await migrateTenantDatabase(b);
  await a.query('truncate businesses restart identity cascade');await b.query('truncate businesses restart identity cascade');
  await control.query('truncate license_customers,businesses,saas_tenants restart identity cascade');
  await control.query("insert into license_customers(id,name) values($1,'Universal DPT')",[ids.customer]);
  for(const [vendor,tenant,database,pool] of [[ids.vendorA,ids.tenantA,databaseA,a],[ids.vendorB,ids.tenantB,databaseB,b]] as const){
    await control.query("insert into vendor_businesses(id,customer_id,name,business_type,status) values($1,$2,$3,'cafe','active')",[vendor,ids.customer,database]);
    await control.query('insert into saas_tenants(id,vendor_business_id,slug,database_name,status) values($1,$2,$3,$4,\'active\')',[tenant,vendor,database,database]);
    await pool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Universal DPT',$1,'cafe','MAD','fr-MA','Africa/Casablanca',$2)",[database,vendor]);
  }
  const keys=crypto.generateKeyPairSync('ed25519'),d:Device={installation_id:crypto.randomUUID(),public_key:JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey:keys.privateKey};(globalThis as any).device=d;
  await control.query("insert into licenses(id,customer_id,vendor_business_id,business_type,status,allowed_features,max_devices,expires_at) values($1,$2,$3,'cafe','active','[\"pos\"]',2,now()+interval '30 days')",[ids.license,ids.customer,ids.vendorA]);
  const deviceId=crypto.randomUUID(),fingerprint=crypto.createHash('sha256').update(d.public_key).digest('hex');
  await control.query("insert into license_devices(id,license_id,installation_id,device_public_key,device_fingerprint,channel,status) values($1,$2,$3,$4,$5,'desktop','active')",[deviceId,ids.license,d.installation_id,d.public_key,fingerprint]);
  await control.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values($1,$2,$3,'offline','approved',$4)",[ids.license,deviceId,ids.certificate,crypto.randomUUID()]);
  const {registerUniversalSyncV1}=await import('./universal-v1.js');app=Fastify();app.setErrorHandler((error:any,_request:any,reply:any)=>reply.code(error.statusCode??500).send({message:error.message,code:error.code}));await registerUniversalSyncV1(app,{pool:control,controlPool:control});await app.ready();
});
test.after(async()=>{if(app)await app.close();const{closeTenantPools}=await import('../saas/tenant-context.js');await closeTenantPools();await a.end();await b.end();await control.end()});

test('Universal V1 derives the database-per-tenant business from the bound device',async()=>{
  const d=(globalThis as any).device as Device,mutation={client_id:crypto.randomUUID(),entity_type:'categories',sync_id:crypto.randomUUID(),operation:'upsert',base_updated_at:null,data:{name:'Tenant A',image:null,is_public:true}};
  const response=await app.inject({method:'POST',url:'/api/desktop-sync/v1/push',payload:{device:signed(d,[mutation]),mutations:[mutation]}});assert.equal(response.statusCode,200,response.body);
  assert.equal(Number((await a.query('select count(*)::int n from categories where business_id=1')).rows[0].n),1);
  assert.equal(Number((await b.query('select count(*)::int n from categories where business_id=1')).rows[0].n),0);
  await control.query("update license_devices set status='revoked' where license_id=$1",[ids.license]);
  const replay={...mutation,client_id:crypto.randomUUID()};
  const denied=await app.inject({method:'POST',url:'/api/desktop-sync/v1/push',payload:{device:signed(d,[replay]),mutations:[replay]}});assert.equal(denied.statusCode,403,denied.body);assert.equal(denied.json().code,'DEVICE_REVOKED');
});
