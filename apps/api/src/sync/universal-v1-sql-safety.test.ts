import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';

const localTestUrl=()=>{const value=new URL('postgresql://localhost');value.pathname=`/${crypto.randomUUID()}_test`;return value.toString();};
process.env.DATABASE_URL??=process.env.UNIVERSAL_V1_CONTROL_DATABASE_URL??localTestUrl();
process.env.CONTROL_PLANE_DATABASE_URL??=process.env.DATABASE_URL;
process.env.JWT_SECRET??=crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV='test';

const source=fs.readFileSync('src/sync/universal-v1.ts','utf8');

test('Universal V1 uses the three literal delete adapters and never interpolates a SQL identifier',()=>{
  assert.match(source,/delete from categories where id=\$1 and business_id=\$2/);
  assert.match(source,/delete from units where id=\$1 and business_id=\$2/);
  assert.match(source,/delete from customers where id=\$1 and business_id=\$2/);
  assert.doesNotMatch(source,/(?:from|update|delete from|insert into)\s+\$?\{[^}]+\}/i);
});

test('Universal V1 rejects an unknown or malicious entity before any hosted SQL executes',async()=>{
  const calls:{sql:string}[]=[];
  const pool={query:async(sql:string)=>{calls.push({sql});throw new Error('SQL must not run for an unknown entity');}} as any;
  const app=Fastify();
  const {registerUniversalSyncV1}=await import('./universal-v1.js');
  await registerUniversalSyncV1(app,{pool,controlPool:pool});
  await app.ready();
  try{
    const response=await app.inject({method:'POST',url:'/api/desktop-sync/v1/push',payload:{
      device:{license_id:'00000000-0000-4000-8000-000000000001',certificate_id:'00000000-0000-4000-8000-000000000002',installation_id:'00000000-0000-4000-8000-000000000003',device_public_key:'x'.repeat(40),nonce:'00000000-0000-4000-8000-000000000004',requested_at:new Date().toISOString(),device_proof:'x'.repeat(40)},
      mutations:[{client_id:'00000000-0000-4000-8000-000000000005',entity_type:'categories; drop table customers; --',sync_id:'00000000-0000-4000-8000-000000000006',operation:'delete',base_updated_at:null,data:null}],
    }});
    assert.equal(response.statusCode,422,response.body);
    assert.equal(calls.length,0);
  }finally{await app.close();}
});
