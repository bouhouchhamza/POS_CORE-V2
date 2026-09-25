import type pg from 'pg';
import {publishSyncRequired} from './desktop-realtime.js';

/**
 * Runs a hosted master-data write in a real PostgreSQL transaction and emits
 * only after COMMIT. A rejected operation rolls back and cannot invalidate a
 * Desktop through realtime; polling remains authoritative.
 */
export async function commitHostedMasterDataChange<T>(
  pool:pg.Pool,
  businessId:number,
  operation:(client:pg.PoolClient)=>Promise<T>,
):Promise<T>{
  const client=await pool.connect();
  let value:T;
  let channelKey:string|null=null;
  try{
    await client.query('begin');
    const business=(await client.query('select vendor_business_id from businesses where id=$1',[businessId])).rows[0];
    channelKey=business?.vendor_business_id?String(business.vendor_business_id):null;
    value=await operation(client);
    await client.query('commit');
  }catch(error){
    await client.query('rollback');
    throw error;
  }finally{
    client.release();
  }
  if(channelKey)publishSyncRequired(channelKey);
  return value;
}

export function insertHostedCategory(client:pg.PoolClient,businessId:number,input:{name:string;image:string|null;is_public:boolean}){
  return client.query(`insert into categories(business_id,name,image,is_public) values($1,$2,$3,$4)
    returning id,business_id as "businessId",name,image,is_public as "isPublic",created_at as "createdAt",updated_at as "updatedAt"`,[businessId,input.name,input.image,input.is_public]);
}

export function updateHostedCategory(client:pg.PoolClient,businessId:number,id:number,input:{name:string;image:string|null;is_public:boolean}){
  return client.query(`update categories set name=$1,image=$2,is_public=$3,updated_at=now() where id=$4 and business_id=$5
    returning id,business_id as "businessId",name,image,is_public as "isPublic",created_at as "createdAt",updated_at as "updatedAt"`,[input.name,input.image,input.is_public,id,businessId]);
}

export function deleteHostedCategory(client:pg.PoolClient,businessId:number,id:number){
  return client.query('delete from categories where id=$1 and business_id=$2 returning id,image',[id,businessId]);
}

export function insertHostedUnit(client:pg.PoolClient,businessId:number,input:{code:string;name:string;precision:number;active:boolean}){
  return client.query('insert into units(business_id,code,name,precision,active) values($1,$2,$3,$4,$5) returning *',[businessId,input.code,input.name,input.precision,input.active]);
}

export function insertHostedCustomer(client:pg.PoolClient,businessId:number,input:{name:string;phone?:string|null;email?:string|null;address?:string|null;notes?:string|null;active:boolean}){
  return client.query('insert into customers(business_id,name,phone,email,address,notes,active) values($1,$2,$3,$4,$5,$6,$7) returning *',[businessId,input.name,input.phone??null,input.email??null,input.address??null,input.notes??null,input.active]);
}
