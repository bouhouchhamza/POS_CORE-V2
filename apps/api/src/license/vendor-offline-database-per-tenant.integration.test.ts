import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import pg from 'pg';
import {offlineProofPayload,type OfflineRequest} from '@corepos/shared-types';
import {verifyCertificate} from './crypto.js';

const controlUrl=process.env.TEST_DATABASE_URL;
if(controlUrl&&!decodeURIComponent(new URL(controlUrl).pathname).endsWith('_test'))throw new Error('Disposable _test database required');
if(process.env.REQUIRE_POSTGRES_INTEGRATION==='true'&&!controlUrl)throw new Error('TEST_DATABASE_URL required');
const tenantDatabase='corepos_bootstrap_tenant_test';
const databaseUrl=(name:string)=>{const value=new URL(controlUrl!);value.pathname=`/${name}`;return value.toString().replace('%7Bdatabase%7D','{database}').replace('%7bdatabase%7d','{database}')};
const tenantUrl=controlUrl?databaseUrl(tenantDatabase):undefined;
const keys=crypto.generateKeyPairSync('ed25519');
const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();

if(controlUrl){
  process.env.DATABASE_URL=controlUrl;
  process.env.CONTROL_PLANE_DATABASE_URL=controlUrl;
  process.env.SAAS_TENANCY_MODE='database_per_tenant';
  process.env.SAAS_TENANT_DATABASE_URL_TEMPLATE=databaseUrl('{database}');
  process.env.SAAS_DATABASE_ADMIN_URL=controlUrl;
  process.env.LICENSE_SIGNING_PRIVATE_KEY=privateKey;
  process.env.LICENSE_SIGNING_PUBLIC_KEY=publicKey;
  process.env.VENDOR_ADMIN_TOKEN=crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET='database-per-tenant-bootstrap-test-secret';
  process.env.NODE_ENV='test';
}

const headers={authorization:`Bearer ${process.env.VENDOR_ADMIN_TOKEN}`};
const controlPool=new pg.Pool({connectionString:controlUrl});
const app=Fastify();
app.setErrorHandler((error:unknown,_request,reply)=>{const value=error as {statusCode?:number;code?:string;message?:string};return reply.code(value.statusCode??500).send({message:value.message,code:value.code})});

function request(){const device=crypto.generateKeyPairSync('ed25519');const facts={version:2 as const,installation_id:crypto.randomUUID(),device_public_key:JSON.stringify(device.publicKey.export({format:'jwk'})),device_name:'Database-per-tenant test desktop',app_version:'2.0.9',platform:'win32',nonce:crypto.randomUUID(),requested_at:new Date().toISOString()};return{facts,device,body:{...facts,device_proof:crypto.sign(null,Buffer.from(offlineProofPayload(facts)),device.privateKey).toString('base64url')} satisfies OfflineRequest}}

test.before(async()=>{
  if(!controlUrl)return;
  await controlPool.query(`drop database if exists ${tenantDatabase} with (force)`);
  await controlPool.query(`create database ${tenantDatabase}`);
  const tenantPool=new pg.Pool({connectionString:tenantUrl});
  try{
    const {migrateTenantDatabase}=await import('../saas/tenant-provisioning.js');
    await migrateTenantDatabase(tenantPool);
  }finally{await tenantPool.end()}
  await app.register(cookie);
  const {registerLicenseRoutes}=await import('./routes.js');
  await registerLicenseRoutes(app,{pool:controlPool,operationalPool:controlPool,authenticate:async(_request,reply)=>{reply.code(401).send()},resolveUser:async()=>null});
  await app.ready();
});

test.after(async()=>{
  await app.close();
  if(!controlUrl){await controlPool.end();return}
  const {closeTenantPools}=await import('../saas/tenant-context.js');
  await closeTenantPools();
  if(controlUrl)await controlPool.query(`drop database if exists ${tenantDatabase} with (force)`);
  await controlPool.end();
});

test('database-per-tenant bootstrap selects the licensed tenant profile verifier',{skip:!controlUrl},async()=>{
  const customer=(await controlPool.query("insert into license_customers(name) values('Tenant bootstrap customer') returning id")).rows[0];
  const vendorBusiness=(await controlPool.query("insert into vendor_businesses(customer_id,name,business_type,status) values($1,'Tenant bootstrap business','cafe','active') returning id",[customer.id])).rows[0];
  const shadow=(await controlPool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Shadow','shadow-bootstrap','cafe','MAD','fr-MA','Africa/Casablanca',$1) returning id",[vendorBusiness.id])).rows[0];
  await controlPool.query("insert into saas_tenants(vendor_business_id,control_business_id,slug,database_name,status) values($1,$2,'tenant-bootstrap',$3,'active')",[vendorBusiness.id,shadow.id,tenantDatabase]);
  const license=(await controlPool.query("insert into licenses(customer_id,vendor_business_id,plan_id,status,business_type,allowed_features,max_devices,max_desktop_devices,expires_at,offline_validity_days) values($1,$2,(select id from license_plans where code='business'),'active','cafe','[\"pos\"]',2,2,now()+interval '30 days',30) returning id",[customer.id,vendorBusiness.id])).rows[0];
  const password='tenant-authoritative-password',verifier=await argon2.hash(password),tenantPool=new pg.Pool({connectionString:tenantUrl});
  try{
    const runtime=(await tenantPool.query("insert into businesses(name,slug,business_type,currency,locale,timezone,vendor_business_id) values('Tenant runtime','tenant-runtime','cafe','MAD','fr-MA','Africa/Casablanca',$1) returning id",[vendorBusiness.id])).rows[0];
    const branch=(await tenantPool.query("insert into branches(business_id,name,code) values($1,'Tenant main','MAIN') returning id",[runtime.id])).rows[0];
    await tenantPool.query("insert into users(business_id,branch_id,name,email,password,role,is_active) values($1,$2,'Tenant Hamza','tenant-hamza@test.invalid',$3,'owner',true)",[runtime.id,branch.id,verifier]);
    const req=request();
    const issued=await app.inject({method:'POST',url:'/api/vendor/offline-activations/issue',headers,payload:{license_id:license.id,request:req.body}});
    assert.equal(issued.statusCode,201,issued.body);
    const signed=issued.json().data;
    assert.equal(verifyCertificate(signed.certificate,signed.signature,publicKey),true);
    assert.equal(signed.certificate.bootstrap.users.length,1);
    assert.deepEqual(signed.certificate.bootstrap.users[0],{name:'Tenant Hamza',email:'tenant-hamza@test.invalid',password:verifier,role:'owner',is_active:true});
    assert.equal(JSON.stringify(signed.certificate).includes(password),false);
  }finally{await tenantPool.end()}
});
