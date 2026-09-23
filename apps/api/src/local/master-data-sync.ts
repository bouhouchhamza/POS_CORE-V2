import type {DatabaseSync} from 'node:sqlite';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {z} from 'zod';

const now=()=>new Date().toISOString();
const one=(db:DatabaseSync,sql:string,...args:any[])=>db.prepare(sql).get(...args) as any;
const all=(db:DatabaseSync,sql:string,...args:any[])=>db.prepare(sql).all(...args) as any[];
const entities=['branches','settings','categories','units','products','product_variants','product_modifiers','customers','suppliers'] as const;
type Entity=typeof entities[number];
const entitySchema=z.enum(entities);
const tables:Record<Entity,string>={branches:'branches',settings:'settings',categories:'categories',units:'units',products:'products',product_variants:'product_variants',product_modifiers:'product_modifiers',customers:'customers',suppliers:'suppliers'};
const ordered:Entity[]=['branches','settings','categories','units','products','product_variants','product_modifiers','customers','suppliers'];
const cents=(value:unknown)=>Math.round(Number(value??0)*100);

function masterData(db:DatabaseSync,entity:Entity,localId:number){
  const row=one(db,`select * from ${tables[entity]} where id=?`,localId);if(!row)return null;
  const ref=(type:Entity,id:unknown)=>id==null?null:one(db,'select sync_id from master_sync_entities where entity_type=? and local_id=?',type,id)?.sync_id??null;
  if(entity==='products')return {...row,purchase_price:Number(row.purchase_price_cents??0)/100,sale_price:Number(row.sale_price_cents??0)/100,category_sync_id:ref('categories',row.category_id)};
  if(entity==='product_variants')return {...row,price_delta:Number(row.price_delta_cents??0)/100,product_sync_id:ref('products',row.product_id)};
  if(entity==='product_modifiers')return {...row,price:Number(row.price_cents??0)/100,product_sync_id:ref('products',row.product_id)};
  return row;
}
function pending(db:DatabaseSync,businessId:number,entity:Entity,localId:number){return one(db,"select id from sync_mutations where business_id=? and entity_type=? and entity_id=? and sync_status in ('pending','failed') limit 1",businessId,entity,String(localId));}
function localId(db:DatabaseSync,entity:Entity,syncId:string){return one(db,'select local_id from master_sync_entities where entity_type=? and sync_id=?',entity,syncId)?.local_id as number|undefined}
function setRemote(db:DatabaseSync,entity:Entity,id:number,syncId:string,serverId:number,updatedAt:string,deleted=false){db.prepare("insert into master_sync_entities(entity_type,local_id,sync_id,server_id,server_updated_at,sync_status,tombstoned) values(?,?,?,?,?,'synced',?) on conflict(entity_type,local_id) do update set sync_id=excluded.sync_id,server_id=excluded.server_id,server_updated_at=excluded.server_updated_at,sync_status='synced',tombstoned=excluded.tombstoned").run(entity,id,syncId,serverId,updatedAt,Number(deleted));}

function write(db:DatabaseSync,entity:Entity,businessId:number,data:any,syncId:string,serverId:number,updatedAt:string){
  let id=localId(db,entity,syncId);
  const ref=(type:Entity,value:any)=>value?localId(db,type,String(value))??null:null;
  const stamp=data.updated_at??updatedAt;
  if(entity==='branches'){
    if(id)db.prepare('update branches set name=?,code=?,address=?,phone=?,active=?,updated_at=? where id=? and business_id=?').run(data.name,data.code,data.address??null,data.phone??null,Number(data.active),stamp,id,businessId);
    else id=Number(db.prepare('insert into branches(business_id,name,code,address,phone,active,created_at,updated_at) values(?,?,?,?,?,?,?,?)').run(businessId,data.name,data.code,data.address??null,data.phone??null,Number(data.active),data.created_at??stamp,stamp).lastInsertRowid);
  }else if(entity==='settings'){
    if(id)db.prepare('update settings set key=?,value=?,updated_at=? where id=? and business_id=?').run(data.key,data.value??null,stamp,id,businessId);
    else id=Number(db.prepare('insert into settings(business_id,key,value,created_at,updated_at) values(?,?,?,?,?)').run(businessId,data.key,data.value??null,data.created_at??stamp,stamp).lastInsertRowid);
  }else if(entity==='categories'){
    if(id)db.prepare('update categories set name=?,image=?,is_public=?,updated_at=? where id=? and business_id=?').run(data.name,data.image??null,Number(data.is_public),stamp,id,businessId);
    else id=Number(db.prepare('insert into categories(business_id,name,image,is_public,created_at,updated_at) values(?,?,?,?,?,?)').run(businessId,data.name,data.image??null,Number(data.is_public),data.created_at??stamp,stamp).lastInsertRowid);
  }else if(entity==='units'){
    if(id)db.prepare('update units set code=?,name=?,precision=?,active=?,updated_at=? where id=? and business_id=?').run(data.code,data.name,Number(data.precision),Number(data.active),stamp,id,businessId);
    else id=Number(db.prepare('insert into units(business_id,code,name,precision,active,created_at,updated_at) values(?,?,?,?,?,?,?)').run(businessId,data.code,data.name,Number(data.precision),Number(data.active),data.created_at??stamp,stamp).lastInsertRowid);
  }else if(entity==='products'){
    const category=ref('categories',data.category_sync_id);
    if(data.category_sync_id&&!category)throw Object.assign(new Error('Synchronized product category is unavailable locally.'),{statusCode:409,code:'SYNC_DEPENDENCY_MISSING'});
    const values=[category,data.name,data.sku??null,data.barcode??null,data.unit??'piece',Number(data.tax_rate??0),cents(data.purchase_price),cents(data.sale_price),Number(data.stock??0),Number(data.min_stock??0),Number(data.track_stock),data.image??null,Number(data.is_active),Number(data.is_public),Number(data.available),stamp];
    if(id)db.prepare('update products set category_id=?,name=?,sku=?,barcode=?,unit=?,tax_rate=?,purchase_price_cents=?,sale_price_cents=?,stock=?,min_stock=?,track_stock=?,image=?,is_active=?,is_public=?,available=?,updated_at=? where id=? and business_id=?').run(...values,id,businessId);
    else id=Number(db.prepare('insert into products(business_id,category_id,name,sku,barcode,unit,tax_rate,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,image,is_active,is_public,available,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(businessId,...values.slice(0,-1),data.created_at??stamp,stamp).lastInsertRowid);
  }else if(entity==='product_variants'||entity==='product_modifiers'){
    const product=ref('products',data.product_sync_id);if(!product)throw Object.assign(new Error('Synchronized product dependency is unavailable locally.'),{statusCode:409,code:'SYNC_DEPENDENCY_MISSING'});
    if(entity==='product_variants'){const values=[product,data.name,data.sku??null,data.barcode??null,cents(data.price_delta),Number(data.active),stamp];if(id)db.prepare('update product_variants set product_id=?,name=?,sku=?,barcode=?,price_delta_cents=?,active=?,updated_at=? where id=? and business_id=?').run(...values,id,businessId);else id=Number(db.prepare('insert into product_variants(business_id,product_id,name,sku,barcode,price_delta_cents,active,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)').run(businessId,...values.slice(0,-1),data.created_at??stamp,stamp).lastInsertRowid)}
    else {const values=[product,data.name,cents(data.price),Number(data.active),stamp];if(id)db.prepare('update product_modifiers set product_id=?,name=?,price_cents=?,active=?,updated_at=? where id=? and business_id=?').run(...values,id,businessId);else id=Number(db.prepare('insert into product_modifiers(business_id,product_id,name,price_cents,active,created_at,updated_at) values(?,?,?,?,?,?,?)').run(businessId,...values.slice(0,-1),data.created_at??stamp,stamp).lastInsertRowid)}
  }else if(entity==='customers'||entity==='suppliers'){
    const cols=entity==='customers'?['name','phone','email','address','notes','active']:['name','contact','phone','email','address','notes','active'];const values=cols.map(k=>k==='active'?Number(data[k]):data[k]??null);
    if(id)db.prepare(`update ${tables[entity]} set ${cols.map(k=>`${k}=?`).join(',')},updated_at=? where id=? and business_id=?`).run(...values,stamp,id,businessId);
    else id=Number(db.prepare(`insert into ${tables[entity]}(business_id,${cols.join(',')},created_at,updated_at) values(?,${cols.map(()=>'?').join(',')},?,?)`).run(businessId,...values,data.created_at??stamp,stamp).lastInsertRowid);
  }
  setRemote(db,entity,id!,syncId,serverId,updatedAt);return id!;
}

export function registerLocalMasterDataSync(app:FastifyInstance,db:DatabaseSync,guard:(r:FastifyRequest,p:FastifyReply)=>Promise<unknown>,user:(r:FastifyRequest)=>any,tx:<T>(fn:()=>T)=>T){
  app.get('/api/sync/master-data/state',{preHandler:guard},async()=>({data:{cursor:one(db,"select value from sync_state where key='master_data_cursor'")?.value??null}}));
  app.get('/api/sync/master-data/outbox',{preHandler:guard},async r=>{
    const businessId=user(r).business_id;
    const rows=all(db,"select * from sync_mutations where business_id=? and entity_type in ('branches','settings','categories','units','products','product_variants','product_modifiers','customers','suppliers') and sync_status in ('pending','failed') order by id limit 100",businessId)
      .map(m=>{const meta=JSON.parse(m.payload_json),{local_id,...payload}=meta,entity=entitySchema.parse(payload.entity_type),identity=one(db,'select sync_id,server_updated_at from master_sync_entities where entity_type=? and local_id=?',entity,local_id);return {...m,payload:{client_id:m.client_id,...payload,base_updated_at:identity?.server_updated_at??null,data:payload.operation==='delete'?null:masterData(db,entity,local_id)}}})
      .filter(m=>m.payload.sync_id);
    return {data:rows};
  });
  app.post('/api/sync/master-data/conflict',{preHandler:guard},async r=>{const u=user(r),input=z.object({client_id:z.string().uuid()}).parse(r.body);tx(()=>{const m=one(db,'select entity_type,entity_id from sync_mutations where business_id=? and client_id=?',u.business_id,input.client_id);if(m){db.prepare("update sync_mutations set sync_status='conflict',last_error='MASTER_DATA_CONFLICT',updated_at=? where business_id=? and client_id=?").run(now(),u.business_id,input.client_id);db.prepare("update master_sync_entities set sync_status='conflict' where entity_type=? and local_id=?").run(m.entity_type,Number(m.entity_id))}});return{message:'Conflict recorded.'};});
  const change=z.object({entity_type:entitySchema,sync_id:z.string().uuid(),server_id:z.number().int().positive(),deleted:z.boolean(),updated_at:z.string(),data:z.record(z.string(),z.unknown())});
  app.post('/api/sync/master-data/apply',{preHandler:guard},async r=>{const u=user(r),input=z.object({cursor:z.string().nullable().optional(),changes:z.array(change).max(500)}).parse(r.body);tx(()=>{db.prepare("update master_sync_runtime set value='1' where key='remote_apply'").run();try{for(const entity of ordered)for(const remote of input.changes.filter(x=>x.entity_type===entity)){const id=localId(db,entity,remote.sync_id);if(id&&pending(db,u.business_id,entity,id)){db.prepare("update master_sync_entities set sync_status='conflict' where entity_type=? and local_id=?").run(entity,id);db.prepare("update sync_mutations set sync_status='conflict',last_error='REMOTE_MASTER_DATA_CONFLICT',updated_at=? where business_id=? and entity_type=? and entity_id=? and sync_status in ('pending','failed')").run(now(),u.business_id,entity,String(id));continue}if(remote.deleted){if(id){try{db.prepare(`delete from ${tables[entity]} where id=? and business_id=?`).run(id,u.business_id)}catch{db.prepare("update master_sync_entities set tombstoned=1,sync_status='synced' where entity_type=? and local_id=?").run(entity,id)}}continue}write(db,entity,u.business_id,remote.data,remote.sync_id,remote.server_id,remote.updated_at)}if(input.cursor)db.prepare("insert into sync_state(key,value,updated_at) values('master_data_cursor',?,?) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at").run(input.cursor,now())}finally{db.prepare("update master_sync_runtime set value='0' where key='remote_apply'").run()}});return{message:'Applied.'};});
}
