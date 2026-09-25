import crypto from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {config} from '../config.js';
import {fingerprint} from '../license/crypto.js';
import {activationRequestIsFresh} from '../license/policy.js';
import {tenantRuntime,type TenantRecord} from '../saas/tenant-context.js';
import {publishSyncRequired} from './desktop-realtime.js';
import {serializeUniversalV1Data,universalV1DataSchemas,universalV1Entities,type UniversalV1Entity} from './universal-v1-wire.js';

type Entity=UniversalV1Entity;
type Runtime={pool:pg.Pool;businessId:number;vendorBusinessId:string};
type Device=z.infer<typeof deviceSchema>;
type Mutation=z.infer<typeof mutationSchema>;

export const universalV1Registry={
  categories:{direction:'bidirectional',strategy:'versioned',delete:'tombstone',scope:'master'},
  units:{direction:'bidirectional',strategy:'versioned',delete:'tombstone',scope:'master'},
  customers:{direction:'bidirectional',strategy:'versioned',delete:'tombstone',scope:'master'},
} as const;

const entitySchema=z.enum(universalV1Entities);
const deviceSchema=z.object({
  license_id:z.string().uuid(), certificate_id:z.string().uuid(), installation_id:z.string().uuid(),
  device_public_key:z.string().min(40).max(5000), nonce:z.string().uuid(), requested_at:z.string().datetime(),
  device_proof:z.string().min(40).max(500),
}).strict();
const mutationSchema=z.object({
  client_id:z.string().uuid(), entity_type:entitySchema, sync_id:z.string().uuid(),
  operation:z.enum(['upsert','delete']), base_updated_at:z.string().datetime().nullable(),
  data:z.record(z.string(),z.unknown()).nullable(),
}).strict();
const requestSchema=z.object({device:deviceSchema,mutations:z.array(mutationSchema).min(1).max(100)}).strict();

const fail=(message:string,statusCode:number,code:string)=>Object.assign(new Error(message),{statusCode,code});
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value);
const verify=(key:string,payload:string,signature:string)=>{try{return crypto.verify(null,Buffer.from(payload),crypto.createPublicKey({key:JSON.parse(key),format:'jwk'}),Buffer.from(signature,'base64url'))}catch{return false}};
const proofPayload=(action:string,d:Device,mutations:Mutation[]=[])=>['desktop-universal-sync-v1',action,d.license_id,d.certificate_id,d.installation_id,d.device_public_key,d.nonce,d.requested_at,stable(mutations)].join('\n');
type Cursor={updatedAt:string;id:number};
const parseCursor=(value:unknown):Cursor|null=>{
  if(typeof value!=='string'||!value)return null;
  const separator=value.lastIndexOf('|'),updatedAt=separator<0?value:value.slice(0,separator),id=separator<0?0:Number(value.slice(separator+1));
  return Number.isNaN(Date.parse(updatedAt))||!Number.isInteger(id)||id<0?null:{updatedAt,id};
};

/* The entity selector is closed. Every query below has a literal table name. */
async function deleteEntity(client:pg.PoolClient,entity:Entity,id:number,businessId:number){
  if(entity==='categories')return client.query('delete from categories where id=$1 and business_id=$2',[id,businessId]);
  if(entity==='units')return client.query('delete from units where id=$1 and business_id=$2',[id,businessId]);
  return client.query('delete from customers where id=$1 and business_id=$2',[id,businessId]);
}
async function upsertEntity(client:pg.PoolClient,entity:Entity,id:number|undefined,businessId:number,data:unknown){
  const value=universalV1DataSchemas[entity].parse(data) as any;
  if(entity==='categories'){
    if(id)return Number((await client.query('update categories set name=$1,image=$2,is_public=$3,updated_at=now() where id=$4 and business_id=$5 returning id',[value.name,value.image??null,value.is_public,id,businessId])).rows[0].id);
    return Number((await client.query('insert into categories(business_id,name,image,is_public) values($1,$2,$3,$4) returning id',[businessId,value.name,value.image??null,value.is_public])).rows[0].id);
  }
  if(entity==='units'){
    if(id)return Number((await client.query('update units set code=$1,name=$2,precision=$3,active=$4,updated_at=now() where id=$5 and business_id=$6 returning id',[value.code,value.name,value.precision,value.active,id,businessId])).rows[0].id);
    return Number((await client.query('insert into units(business_id,code,name,precision,active) values($1,$2,$3,$4,$5) returning id',[businessId,value.code,value.name,value.precision,value.active])).rows[0].id);
  }
  if(id)return Number((await client.query('update customers set name=$1,phone=$2,email=$3,address=$4,notes=$5,active=$6,updated_at=now() where id=$7 and business_id=$8 returning id',[value.name,value.phone??null,value.email??null,value.address??null,value.notes??null,value.active,id,businessId])).rows[0].id);
  return Number((await client.query('insert into customers(business_id,name,phone,email,address,notes,active) values($1,$2,$3,$4,$5,$6,$7) returning id',[businessId,value.name,value.phone??null,value.email??null,value.address??null,value.notes??null,value.active])).rows[0].id);
}

export async function registerUniversalSyncV1(app:FastifyInstance,{pool,controlPool}:{pool:pg.Pool;controlPool:pg.Pool}){
  async function runtime(raw:unknown,action:string,mutations:Mutation[]=[]):Promise<Runtime>{
    const parsed=deviceSchema.safeParse(raw);
    if(!parsed.success)throw fail('Invalid universal sync request.',422,'SYNC_INPUT_INVALID');
    const device=parsed.data;
    if(!activationRequestIsFresh(device.requested_at))throw fail('Sync request timestamp is outside the allowed window.',422,'SYNC_REQUEST_STALE');
    if(!verify(device.device_public_key,proofPayload(action,device,mutations),device.device_proof))throw fail('Device sync proof is invalid.',403,'DEVICE_PROOF_INVALID');
    const binding=(await controlPool.query(`select d.id device_id,d.status device_status,d.channel,d.device_public_key,d.device_fingerprint,l.status license_status,l.expires_at,vb.id vendor_business_id,vb.status vendor_business_status,t.id tenant_id,t.control_business_id,t.slug,t.database_name,t.status tenant_status
      from license_devices d join licenses l on l.id=d.license_id join vendor_businesses vb on vb.id=l.vendor_business_id left join saas_tenants t on t.vendor_business_id=vb.id
      where d.license_id=$1 and d.installation_id=$2 and d.id in(select device_id from license_activations where license_id=$1 and certificate_id=$3 and status='approved') limit 1`,[device.license_id,device.installation_id,device.certificate_id])).rows[0];
    if(!binding||binding.channel!=='desktop'||binding.device_status!=='active')throw fail('Desktop device is not active.',403,'DEVICE_REVOKED');
    if(binding.device_public_key!==device.device_public_key||binding.device_fingerprint!==fingerprint(device.device_public_key))throw fail('Device identity mismatch.',403,'DEVICE_IDENTITY_MISMATCH');
    if(binding.license_status!=='active'||binding.vendor_business_status!=='active'||(binding.expires_at&&Date.parse(binding.expires_at)<=Date.now()))throw fail('License is not active.',403,'LICENSE_INACTIVE');
    let operational=pool;
    if(config.SAAS_TENANCY_MODE==='database_per_tenant'){
      if(!binding.tenant_id||binding.tenant_status!=='active')throw fail('Tenant runtime is unavailable.',403,'TENANT_INACTIVE');
      operational=tenantRuntime({id:binding.tenant_id,vendorBusinessId:binding.vendor_business_id,controlBusinessId:binding.control_business_id,slug:binding.slug,databaseName:binding.database_name,status:binding.tenant_status} as TenantRecord).pool;
    }
    const business=(await operational.query('select id from businesses where vendor_business_id=$1 limit 1',[binding.vendor_business_id])).rows[0];
    if(!business)throw fail('Licensed business runtime is unavailable.',409,'BUSINESS_RUNTIME_UNAVAILABLE');
    await controlPool.query('update license_devices set last_seen_at=now() where id=$1',[binding.device_id]);
    return{pool:operational,businessId:Number(business.id),vendorBusinessId:String(binding.vendor_business_id)};
  }

  app.post('/api/desktop-sync/v1/push',async(request,reply)=>{
    const parsed=requestSchema.safeParse(request.body);
    if(!parsed.success)throw fail('Invalid universal sync request.',422,'SYNC_INPUT_INVALID');
    const body=parsed.data,ctx=await runtime(body.device,'push',body.mutations),results:any[]=[];
    for(const mutation of body.mutations){
      const client=await ctx.pool.connect();
      try{
        await client.query('begin');
        const seen=(await client.query('select sync_status from sync_mutations where business_id=$1 and client_id=$2 for update',[ctx.businessId,mutation.client_id])).rows[0];
        if(seen){results.push({client_id:mutation.client_id,status:seen.sync_status==='conflict'?'conflict':'acked',replayed:true});await client.query('commit');continue;}
        const current=(await client.query('select entity_id,updated_at from master_sync_rows where business_id=$1 and entity_type=$2 and sync_id=$3 for update',[ctx.businessId,mutation.entity_type,mutation.sync_id])).rows[0];
        if(current&&mutation.base_updated_at&&Date.parse(current.updated_at)!==Date.parse(mutation.base_updated_at)){
          await client.query("insert into sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload,sync_status,error) values($1,$2,$3,$4,$5,$6,'conflict','MASTER_DATA_CONFLICT')",[ctx.businessId,mutation.client_id,mutation.entity_type,String(current.entity_id),mutation.operation,{outcome:'conflict'}]);
          results.push({client_id:mutation.client_id,status:'conflict',code:'MASTER_DATA_CONFLICT'});await client.query('commit');continue;
        }
        let entityId=current?Number(current.entity_id):undefined,changed=false;
        if(mutation.operation==='delete'){
          if(entityId!==undefined){const deleted=await deleteEntity(client,mutation.entity_type,entityId,ctx.businessId);changed=Boolean(deleted.rowCount);}
        }else{
          entityId=await upsertEntity(client,mutation.entity_type,entityId,ctx.businessId,mutation.data);
          changed=true;
          await client.query('update master_sync_rows set sync_id=$1 where business_id=$2 and entity_type=$3 and entity_id=$4',[mutation.sync_id,ctx.businessId,mutation.entity_type,entityId]);
        }
        const row=(await client.query('select entity_id,sync_id,payload,deleted,updated_at from master_sync_rows where business_id=$1 and entity_type=$2 and sync_id=$3',[ctx.businessId,mutation.entity_type,mutation.sync_id])).rows[0];
        const outcome={outcome:'applied',change:row?{entity_type:mutation.entity_type,sync_id:row.sync_id,server_id:Number(row.entity_id),deleted:row.deleted,updated_at:new Date(row.updated_at).toISOString(),data:row.deleted?null:serializeUniversalV1Data(mutation.entity_type,row.payload)}:null};
        await client.query("insert into sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload,sync_status) values($1,$2,$3,$4,$5,$6,'synced')",[ctx.businessId,mutation.client_id,mutation.entity_type,String(entityId??current?.entity_id),mutation.operation,outcome]);
        results.push({client_id:mutation.client_id,status:'acked',change:outcome.change});
        await client.query('commit');
        if(changed)publishSyncRequired(ctx.vendorBusinessId);
      }catch(error){
        await client.query('rollback');
        if(error instanceof z.ZodError){results.push({client_id:mutation.client_id,status:'conflict',code:'SYNC_INPUT_INVALID'});continue;}
        const typed=error as {code?:string};
        if(typed.code==='23503')results.push({client_id:mutation.client_id,status:'conflict',code:'SYNC_DELETE_BLOCKED'});
        else results.push({client_id:mutation.client_id,status:'retry',code:'TEMPORARY_FAILURE'});
      }finally{client.release();}
    }
    return reply.send({data:{results}});
  });

  app.get('/api/desktop-sync/v1/pull',async request=>{
    const raw=request.query as Record<string,unknown>,{cursor:rawCursor,...device}=raw,ctx=await runtime(device,'pull'),cursor=parseCursor(rawCursor);
    const rows=(await ctx.pool.query(`select r.id,r.entity_type,r.entity_id,r.sync_id,r.payload,r.deleted,r.updated_at,
      to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at
      from master_sync_rows r
      where r.business_id=$1 and r.entity_type in ('categories','units','customers')
        and ($2::timestamptz is null or r.updated_at>$2::timestamptz or (r.updated_at=$2::timestamptz and r.id>$3))
      order by r.updated_at,r.id limit 500`,[ctx.businessId,cursor?.updatedAt??null,cursor?.id??0])).rows;
    const last=rows.at(-1),next=last?`${last.cursor_at}|${last.id}`:(typeof rawCursor==='string'&&rawCursor?rawCursor:null);
    return{data:{changes:rows.map(row=>({entity_type:row.entity_type,sync_id:row.sync_id,server_id:Number(row.entity_id),deleted:row.deleted,updated_at:new Date(row.updated_at).toISOString(),data:row.deleted?null:serializeUniversalV1Data(entitySchema.parse(row.entity_type),row.payload)})),cursor:next}};
  });
}
