import crypto from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {config} from '../config.js';
import {activationRequestIsFresh} from '../license/policy.js';
import {fingerprint} from '../license/crypto.js';
import {tenantRuntime,type TenantRecord} from '../saas/tenant-context.js';

type Device={licenseId:string;certificateId:string;installationId:string;publicKey:string;nonce:string;requestedAt:string;proof:string};
type Runtime={pool:pg.Pool;businessId:number};
const deviceSchema=z.object({license_id:z.string().uuid(),certificate_id:z.string().uuid(),installation_id:z.string().uuid(),device_public_key:z.string().min(40).max(5000),nonce:z.string().uuid(),requested_at:z.string().datetime(),device_proof:z.string().min(40).max(500)}).strict();
const mutationSchema=z.object({client_id:z.string().uuid(),operation:z.enum(['open','close']),local_session_id:z.number().int().positive(),server_session_id:z.number().int().positive().nullable().optional(),user_email:z.string().email(),branch_code:z.string().trim().max(40).nullable(),opening_cash:z.number().finite().nonnegative().optional(),opening_note:z.string().max(500).nullable().optional(),opened_at:z.string().datetime().optional(),actual_cash:z.number().finite().nonnegative().optional(),closing_note:z.string().max(500).nullable().optional(),closed_at:z.string().datetime().optional()}).strict();
const proofPayload=(action:string,d:Device,m?:z.infer<typeof mutationSchema>)=>[
  'desktop-sync-v1',action,d.licenseId,d.certificateId,d.installationId,d.publicKey,d.nonce,d.requestedAt,
  m?.client_id??'',m?.operation??'',String(m?.local_session_id??''),String(m?.server_session_id??''),m?.user_email?.toLowerCase()??'',m?.branch_code??'',String(m?.opening_cash??''),m?.opening_note??'',m?.opened_at??'',String(m?.actual_cash??''),m?.closing_note??'',m?.closed_at??''
].join('\n');
const verify=(key:string,payload:string,signature:string)=>{try{return crypto.verify(null,Buffer.from(payload),crypto.createPublicKey({key:JSON.parse(key),format:'jwk'}),Buffer.from(signature,'base64url'))}catch{return false}};
const cents=(value:number)=>Math.round(value*100)/100;
const input=<T>(schema:{safeParse:(value:unknown)=>{success:true;data:T}|{success:false}},value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw Object.assign(new Error('Invalid desktop sync request.'),{statusCode:422,code:'SYNC_INPUT_INVALID'});return parsed.data};
type PullCursor={updatedAt:string;id:number};
/** Cursors include the immutable row id because a timestamp by itself both
 * replays the final row forever (>=) and can skip a tied update (>). */
function pullCursor(value:unknown):PullCursor|null{if(typeof value!=='string'||!value)return null;const marker=value.lastIndexOf('|');if(marker<0)return Number.isNaN(Date.parse(value))?null:{updatedAt:value,id:0};const updatedAt=value.slice(0,marker),id=Number(value.slice(marker+1));return Number.isNaN(Date.parse(updatedAt))||!Number.isInteger(id)||id<0?null:{updatedAt,id}}

/** Device-authenticated reconciliation. It never accepts a tenant or business id
 * from Desktop; both are resolved from the active commercial device binding. */
export async function registerDesktopCashRegisterSync(app:FastifyInstance,{pool,controlPool}:{pool:pg.Pool;controlPool:pg.Pool}){
  async function runtime(raw:unknown,action:string,mutation?:z.infer<typeof mutationSchema>):Promise<Runtime>{
    const parsed=input(deviceSchema,raw),d:Device={licenseId:parsed.license_id,certificateId:parsed.certificate_id,installationId:parsed.installation_id,publicKey:parsed.device_public_key,nonce:parsed.nonce,requestedAt:parsed.requested_at,proof:parsed.device_proof};
    if(!activationRequestIsFresh(d.requestedAt))throw Object.assign(new Error('Sync request timestamp is outside the allowed window.'),{statusCode:422,code:'SYNC_REQUEST_STALE'});
    if(!verify(d.publicKey,proofPayload(action,d,mutation),d.proof))throw Object.assign(new Error('Device sync proof is invalid.'),{statusCode:403,code:'DEVICE_PROOF_INVALID'});
    const row=(await controlPool.query(`select d.id device_id,d.status device_status,d.channel,d.device_public_key,d.device_fingerprint,l.id license_id,l.status license_status,l.expires_at,vb.id vendor_business_id,vb.status vendor_business_status,t.id tenant_id,t.control_business_id,t.slug,t.database_name,t.status tenant_status
      from license_devices d join licenses l on l.id=d.license_id join vendor_businesses vb on vb.id=l.vendor_business_id left join saas_tenants t on t.vendor_business_id=vb.id
      where d.license_id=$1 and d.installation_id=$2 and d.id in (select device_id from license_activations where license_id=$1 and certificate_id=$3 and status='approved') limit 1`,[d.licenseId,d.installationId,d.certificateId])).rows[0];
    if(!row||row.channel!=='desktop'||row.device_status!=='active')throw Object.assign(new Error('Desktop device is not active.'),{statusCode:403,code:'DEVICE_REVOKED'});
    if(row.device_public_key!==d.publicKey||row.device_fingerprint!==fingerprint(d.publicKey))throw Object.assign(new Error('Device identity mismatch.'),{statusCode:403,code:'DEVICE_IDENTITY_MISMATCH'});
    if(row.license_status!=='active'||row.vendor_business_status!=='active'||(row.expires_at&&Date.parse(row.expires_at)<=Date.now()))throw Object.assign(new Error('License is not active.'),{statusCode:403,code:'LICENSE_INACTIVE'});
    let operational=pool;
    if(config.SAAS_TENANCY_MODE==='database_per_tenant'){
      if(!row.tenant_id||row.tenant_status!=='active')throw Object.assign(new Error('Tenant runtime is unavailable.'),{statusCode:403,code:'TENANT_INACTIVE'});
      const tenant:TenantRecord={id:row.tenant_id,vendorBusinessId:row.vendor_business_id,controlBusinessId:row.control_business_id,slug:row.slug,databaseName:row.database_name,status:row.tenant_status};
      operational=tenantRuntime(tenant).pool;
    }
    const business=(await operational.query('select id from businesses where vendor_business_id=$1 limit 1',[row.vendor_business_id])).rows[0];
    if(!business)throw Object.assign(new Error('Licensed Business runtime is unavailable.'),{statusCode:409,code:'BUSINESS_RUNTIME_UNAVAILABLE'});
    await controlPool.query('update license_devices set last_seen_at=now() where id=$1',[row.device_id]);
    return{pool:operational,businessId:business.id};
  }
  app.get('/api/desktop-sync/cash-registers/pull',async(request)=>{
    const raw=request.query as Record<string,unknown>,{cursor:rawCursor,...device}=raw,context=await runtime(device,'pull'),cursor=pullCursor(rawCursor);
    const rows=(await context.pool.query(`select s.id,s.business_date::text,s.status,s.opened_at,s.opening_cash,s.opening_note,s.closed_at,s.actual_cash,s.closing_note,s.updated_at,to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') sync_updated_at,b.code branch_code
      from cash_register_sessions s left join branches b on b.id=s.branch_id where s.business_id=$1 and ($2::timestamptz is null or s.updated_at>$2::timestamptz or (s.updated_at=$2::timestamptz and s.id>$3)) order by s.updated_at,s.id limit 500`,[context.businessId,cursor?.updatedAt??null,cursor?.id??0])).rows;
    const last=rows.at(-1),next=last?`${last.sync_updated_at}|${last.id}`:(typeof rawCursor==='string'&&rawCursor?rawCursor:null);
    return{data:{sessions:rows.map(row=>({...row,opening_cash:Number(row.opening_cash),actual_cash:row.actual_cash===null?null:Number(row.actual_cash),opened_at:new Date(row.opened_at).toISOString(),closed_at:row.closed_at?new Date(row.closed_at).toISOString():null,updated_at:new Date(row.updated_at).toISOString()})),cursor:next}};
  });
  app.post('/api/desktop-sync/cash-registers/push',async(request,reply)=>{
    const body=input(z.object({device:deviceSchema,mutation:mutationSchema}).strict(),request.body),context=await runtime(body.device,'push',body.mutation),client=await context.pool.connect();
    try{await client.query('begin');const existing=(await client.query('select payload,sync_status from sync_mutations where business_id=$1 and client_id=$2 for update',[context.businessId,body.mutation.client_id])).rows[0];if(existing){await client.query('commit');const outcome=existing.payload;return reply.code(outcome?.outcome==='conflict'?409:200).send({data:outcome,replayed:true});}
      const profile=(await client.query("select id,role,branch_id from users where business_id=$1 and lower(email)=lower($2) and is_active=true limit 1",[context.businessId,body.mutation.user_email])).rows[0];
      if(!profile||!['patron','owner','admin','manager','worker','cashier'].includes(profile.role))throw Object.assign(new Error('The selected local profile is not allowed to manage cash.'),{statusCode:403,code:'SYNC_PROFILE_NOT_ALLOWED'});
      const branch=body.mutation.branch_code?(await client.query('select id from branches where business_id=$1 and code=$2 and active=true limit 1',[context.businessId,body.mutation.branch_code])).rows[0]:(profile.branch_id===null?null:{id:profile.branch_id});
      if(body.mutation.branch_code&&!branch)throw Object.assign(new Error('Branch does not belong to this Business.'),{statusCode:409,code:'SYNC_BRANCH_NOT_FOUND'});
      if((profile.branch_id??null)!==(branch?.id??null))throw Object.assign(new Error('Cash register branch does not match the signed-in profile.'),{statusCode:403,code:'SYNC_BRANCH_MISMATCH'});
      let session:any;
      if(body.mutation.operation==='open'){
        const open=(await client.query("select * from cash_register_sessions where business_id=$1 and branch_id is not distinct from $2 and status='open' limit 1 for update",[context.businessId,branch?.id??null])).rows[0];
        if(open){const outcome={outcome:'conflict',session:open};await client.query("insert into sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload,sync_status,error) values($1,$2,'cash_register_session',$3,'open',$4,'conflict','CASH_REGISTER_ALREADY_OPEN')",[context.businessId,body.mutation.client_id,String(open.id),outcome]);await client.query('commit');return reply.code(409).send({data:outcome});}
        session=(await client.query("insert into cash_register_sessions(business_id,branch_id,business_date,status,opened_at,opened_by_user_id,opening_cash,opening_note) values($1,$2,$3,'open',$4,$5,$6,$7) returning *",[context.businessId,branch?.id??null,new Date(body.mutation.opened_at!).toISOString().slice(0,10),body.mutation.opened_at,profile.id,cents(body.mutation.opening_cash!),body.mutation.opening_note??null])).rows[0];
      }else{
        if(!body.mutation.server_session_id)throw Object.assign(new Error('A locally created session must be synchronized before it can close.'),{statusCode:409,code:'SYNC_OPEN_PENDING'});
        session=(await client.query("update cash_register_sessions set status='closed',closed_at=$1,closed_by_user_id=$2,actual_cash=$3,closing_note=$4,updated_at=now() where id=$5 and business_id=$6 and status='open' returning *",[body.mutation.closed_at,profile.id,cents(body.mutation.actual_cash!),body.mutation.closing_note??null,body.mutation.server_session_id,context.businessId])).rows[0]??(await client.query('select * from cash_register_sessions where id=$1 and business_id=$2',[body.mutation.server_session_id,context.businessId])).rows[0];
        if(!session)throw Object.assign(new Error('Hosted cash session was not found.'),{statusCode:404,code:'SYNC_SESSION_NOT_FOUND'});
      }
      const outcome={outcome:'applied',session};await client.query("insert into sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload,sync_status) values($1,$2,'cash_register_session',$3,$4,$5,'synced')",[context.businessId,body.mutation.client_id,String(session.id),body.mutation.operation,outcome]);await client.query('commit');return reply.code(201).send({data:outcome});
    }catch(error){await client.query('rollback');throw error}finally{client.release()}
  });
}
