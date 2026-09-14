import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import { businessFeaturesSchema,businessSetupSchema,businessUpdateSchema,orderSchema,purchaseSchema,roomSchema,supplierSchema,tableSchema } from '@bimik/validation';
import {fingerprint,verifyCertificate,type LicenseCertificate} from '../license/crypto.js';
import {businessTypeAllowed,certificateDeadline,certificateIsCurrent,certificateStatus} from '../license/policy.js';

const now=()=>new Date().toISOString(),hash=(v:string)=>crypto.createHash('sha256').update(v).digest('hex'),cents=(v:number)=>Math.round(v*100),amount=(v:unknown)=>Number(v??0)/100;
const one=(db:DatabaseSync,sql:string,...args:any[])=>db.prepare(sql).get(...args) as any;
const all=(db:DatabaseSync,sql:string,...args:any[])=>db.prepare(sql).all(...args) as any[];
const storedCertificateSchema=z.object({version:z.literal(2),certificate_id:z.string().uuid(),license_id:z.string().uuid(),customer_id:z.string().uuid(),vendor_business_id:z.string().uuid(),business_id:z.number().int().positive().nullable(),business_type:z.string().min(1),plan:z.string().nullable(),features:z.array(z.string()),installation_id:z.string().uuid(),device_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),issued_at:z.string().datetime(),expires_at:z.string().datetime().nullable(),offline_validity_days:z.number().int().positive().nullable()}).strict();
const storedCertificate=(state:any):LicenseCertificate|null=>{if(!state?.certificate_json)return null;try{const parsed=storedCertificateSchema.safeParse(JSON.parse(state.certificate_json));return parsed.success?parsed.data:null}catch{return null}};
export function registerLocalCoreV2Routes(app:FastifyInstance,db:DatabaseSync,authenticate:(r:FastifyRequest,p:FastifyReply)=>Promise<unknown>){
  const user=(r:FastifyRequest)=>one(db,'select * from users where id=?',r.user.sub);
  const licenseState=()=>one(db,'select * from merchant_license_state where id=1');
  const activationAdmin=async(r:FastifyRequest,p:FastifyReply)=>{
    // Device licence activation must remain possible before a business
    // user session exists; otherwise an inactive configured installation
    // becomes impossible to activate.
    const authorization=String(r.headers.authorization??'').trim();

    // Pre-login activation flow.
    if(!authorization)return;

    // If a business user is already authenticated, only administrators
    // may manage device activation.
    await authenticate(r,p);
    if(p.sent)return;

    const u=user(r);
    if(!u||!['patron','owner','admin'].includes(u.role)){
      return p.code(403).send({
        message:'Only the Patron can manage activation.'
      });
    }
  };
  const storeCertificate=(certificate:LicenseCertificate,signature:string,status='active')=>{
    if(certificate.version!==2)return false;
    const offlineValidUntil=certificate.offline_validity_days?new Date(Date.parse(certificate.issued_at)+certificate.offline_validity_days*86_400_000).toISOString():null;
    db.prepare("update merchant_license_state set status=?,license_id=?,customer_id=?,vendor_business_id=?,business_type=?,allowed_features_json=?,certificate_id=?,certificate_version=?,certificate_json=?,certificate_signature=?,device_fingerprint=?,device_status='active',reason_code=null,expires_at=?,offline_valid_until=?,last_validated_at=?,updated_at=? where id=1").run(status,certificate.license_id,certificate.customer_id,certificate.vendor_business_id,certificate.business_type,JSON.stringify(certificate.features),certificate.certificate_id,certificate.version,JSON.stringify(certificate),signature,certificate.device_fingerprint,certificate.expires_at,offlineValidUntil,now(),now());
    db.prepare('update businesses set vendor_business_id=? where vendor_business_id is null').run(certificate.vendor_business_id);
    return true;
  };
  const allowed:Record<string,string[]>={pos:['patron','owner','admin','manager','worker','cashier','seller','waiter'],suppliers:['patron','owner','admin','manager','stock_manager'],purchases:['patron','owner','admin','manager','stock_manager'],customers:['patron','owner','admin','manager','cashier','seller'],tables:['patron','owner','admin','manager','waiter'],qr_menu:['patron','owner','admin','manager','waiter'],kitchen:['patron','owner','admin','kitchen']};
  const guard=(feature?:string)=>async(r:FastifyRequest,p:FastifyReply)=>{await authenticate(r,p);if(p.sent)return;const u=user(r);if(!u)return p.code(401).send({message:'Authentication required.'});if(feature&&!one(db,'select 1 ok from business_features where business_id=? and feature=?',u.business_id,feature))return p.code(403).send({message:`Feature '${feature}' is not enabled.`});if(feature&&allowed[feature]&&!allowed[feature].includes(u.role))return p.code(403).send({message:'Permission denied.'});if(feature&&!(process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')){const state=licenseState();const certificate=storedCertificate(state);if(certificate&&!certificate.features.includes(feature))return p.code(403).send({message:"Ce module n'est pas inclus dans votre licence.",code:'LICENSE_ENTITLEMENT_REQUIRED'});if(!['GET','HEAD','OPTIONS'].includes(r.method)){const derived=certificate?certificateStatus(certificate):null,reason=derived&&derived!=='active'?derived:certificate?state?.status:state?.status==='active'?'activation_required':state?.status;if(reason!=='active')return p.code(403).send({message:'Licence inactive: les donnees restent consultables et exportables.',code:reason==='offline_validity_exceeded'?'OFFLINE_VALIDITY_EXCEEDED':reason==='expired'?'LICENSE_EXPIRED':reason==='device_revoked'?'DEVICE_REVOKED':reason==='vendor_business_inactive'?'VENDOR_BUSINESS_INACTIVE':reason==='revoked'?'LICENSE_REVOKED':'LICENSE_INACTIVE'})}}};
  app.addHook('preHandler',async(r,p)=>{if(r.method!=='PUT'||r.url.split('?')[0]!=='/api/business/current/features'||process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')return;await authenticate(r,p);if(p.sent)return;const state=licenseState();const certificate=storedCertificate(state),denied=businessFeaturesSchema.parse(r.body).enabled_features.filter(feature=>!certificate?.features.includes(feature));if(denied.length)return p.code(403).send({message:"Ce module n'est pas inclus dans votre licence.",code:'LICENSE_ENTITLEMENT_REQUIRED',features:denied})});
  const tx=<T>(fn:()=>T)=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}};
  app.get('/api/setup/status',async()=>{const business=one(db,'select id,name,slug,logo,business_type from businesses order by id limit 1'),state=licenseState();return {data:{configured:Boolean(business),requires_license_activation:state?.status!=='active',business:business??null}}});
  app.post('/api/setup',async(r,p)=>{
    const input=businessSetupSchema.parse(r.body);
    if(one(db,'select 1 ok from businesses limit 1'))return p.code(409).send({message:'Business setup is already complete.'});
    const state=licenseState(),certificate=storedCertificate(state);
    if(!(process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')&&(!certificate||state.status!=='active'||certificate.version!==2||certificateStatus(certificate)!=='active'))return p.code(403).send({message:'A valid device licence is required before setup.',code:'LICENSE_REQUIRED'});
    if(certificate&&input.business.business_type!==certificate.business_type)return p.code(422).send({message:'Business type must match the licence.',code:'LICENSE_BUSINESS_TYPE_MISMATCH'});
    const entitled=certificate?new Set(certificate.features):new Set(input.enabled_features),enabled=[...new Set(input.enabled_features)].filter(feature=>entitled.has(feature));
    const password=await bcrypt.hash(input.admin.password,12),stamp=now(),slug=input.business.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'business';
    const data=tx(()=>{const b=db.prepare('insert into businesses(name,slug,business_type,logo,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values(?,?,?,?,?,?,?,\'{}\',\'{}\',?,?,?)').run(input.business.name,slug,certificate?.business_type??input.business.business_type,input.business.logo??null,input.business.currency.toUpperCase(),input.business.locale,input.business.timezone,certificate?.version===2?certificate.vendor_business_id:null,stamp,stamp),businessId=Number(b.lastInsertRowid);const branchResult=db.prepare("insert into branches(business_id,name,code,address,phone,active,created_at,updated_at) values(?,'Principal','MAIN',?,?,1,?,?)").run(businessId,input.business.address??null,input.business.phone??null,stamp,stamp),branchId=Number(branchResult.lastInsertRowid);for(const feature of enabled)db.prepare('insert into business_features(business_id,feature,created_at) values(?,?,?)').run(businessId,feature,stamp);const owner=db.prepare("insert into users(business_id,branch_id,name,email,password,role,is_active,created_at,updated_at) values(?,?,?,?,?,'owner',1,?,?)").run(businessId,branchId,input.admin.name,input.admin.email.toLowerCase(),password,stamp,stamp);return {business:one(db,'select * from businesses where id=?',businessId),branch:one(db,'select * from branches where id=?',branchId),owner:safeOwner(Number(owner.lastInsertRowid))}});function safeOwner(id:number){return one(db,'select id,name,email,role,is_active from users where id=?',id)}return p.code(201).send({data});
  });
  const orderDto=(id:number,businessId=1)=>{const o=one(db,'select o.*,t.name table_name,t.table_number,(select s.id from sales s where s.order_id=o.id limit 1) sale_id from orders o left join restaurant_tables t on t.id=o.table_id where o.id=? and o.business_id=?',id,businessId);if(!o)return null;const items=all(db,'select oi.*,p.name product_name,pv.name variant_name from order_items oi join products p on p.id=oi.product_id left join product_variants pv on pv.id=oi.variant_id where oi.order_id=?',id).map(i=>({...i,quantity:Number(i.quantity),unit_price:amount(i.unit_price_cents),discount:amount(i.discount_cents),tax:amount(i.tax_cents),total:amount(i.total_cents),modifiers:all(db,'select modifier_id id,name,price_cents from order_item_modifiers where order_item_id=?',i.id).map(m=>({...m,price:amount(m.price_cents)}))}));return {...o,subtotal:amount(o.subtotal_cents),discount:amount(o.discount_cents),tax:amount(o.tax_cents),total:amount(o.total_cents),items}};
  function createOrder(input:ReturnType<typeof orderSchema.parse>,u:any,table?:any){
    const businessId=u?.business_id??table.business_id,branchId=u?.branch_id??table.branch_id;
    const existing=one(db,'select id from orders where business_id=? and client_id=?',businessId,input.client_id);
    if(existing)return orderDto(existing.id,businessId);
    return tx(()=>{
      const targetTableId=input.table_id??table?.id;
      if(u&&targetTableId&&one(db,"select 1 ok from orders where business_id=? and table_id=? and status not in('completed','cancelled') limit 1",businessId,targetTableId))throw Object.assign(new Error('Cette table a dÃ©jÃ  une commande active.'),{statusCode:409});
      const lines=input.items.map(item=>{
        const p=one(db,`select * from products where id=? and business_id=? and is_active=1 and available=1${table?' and is_public=1':''}`,item.product_id,businessId);
        if(!p)throw Object.assign(new Error('Product unavailable.'),{statusCode:422});
        const variant=item.variant_id?one(db,'select * from product_variants where id=? and product_id=? and business_id=? and active=1',item.variant_id,item.product_id,businessId):null;
        const modifiers=item.modifier_ids.map(id=>one(db,'select * from product_modifiers where id=? and product_id=? and business_id=? and active=1',id,item.product_id,businessId));
        if(modifiers.some(value=>!value))throw Object.assign(new Error('Modifier unavailable.'),{statusCode:422});
        if(item.unit_price!==undefined||item.discount!==0||item.tax!==0)throw Object.assign(new Error('Line prices, taxes, and discounts are calculated by the server.'),{statusCode:422});
        const unit=cents(amount(p.sale_price_cents)+amount(variant?.price_delta_cents)+modifiers.reduce((sum,m)=>sum+amount(m.price_cents),0))/100;
        return {item,p,modifiers,unit,total:unit*item.quantity};
      });
      if(input.tax!==0)throw Object.assign(new Error('Order tax is calculated by the server.'),{statusCode:422});
      if(input.discount>0&&(!u||!['patron','owner','admin','manager','cashier'].includes(u.role)))throw Object.assign(new Error('Manual discounts require cash management permission.'),{statusCode:403});
      const subtotal=lines.reduce((sum,line)=>sum+line.total,0),discount=cents(input.discount)/100;
      if(discount>subtotal)throw Object.assign(new Error('Discount cannot exceed the order subtotal.'),{statusCode:422});
      const total=subtotal-discount,stamp=now(),number=`${stamp.slice(0,10).replaceAll('-','')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const result=db.prepare("insert into orders(business_id,branch_id,client_id,order_number,source,type,table_id,customer_id,user_id,status,subtotal_cents,discount_cents,tax_cents,total_cents,payment_status,sync_status,notes,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,'local',?,?,?)").run(businessId,branchId,input.client_id,number,input.source,input.type,input.table_id??table?.id??null,input.customer_id??null,u?.id??null,cents(subtotal),cents(discount),0,cents(total),'unpaid',input.notes??null,stamp,stamp);
      const orderId=Number(result.lastInsertRowid);
      for(const line of lines){
        const itemResult=db.prepare('insert into order_items(order_id,product_id,variant_id,quantity,unit_price_cents,discount_cents,tax_cents,total_cents,notes,preparation_status,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,line.item.product_id,line.item.variant_id??null,line.item.quantity,cents(line.unit),cents(line.item.discount),cents(line.item.tax),cents(line.total),line.item.notes??null,input.type==='retail'?null:'pending',stamp,stamp);
        for(const modifier of line.modifiers)db.prepare('insert into order_item_modifiers values(?,?,?,?)').run(Number(itemResult.lastInsertRowid),modifier.id,modifier.name,modifier.price_cents);
      }
      const stockUserId=u?.id??one(db,"select id from users where business_id=? and role in ('owner','patron','admin') and is_active=1 order by id limit 1",businessId)?.id;
      for(const line of lines){
        if(!line.p.track_stock)continue;
        const before=Number(line.p.stock);
        if(before<line.item.quantity)throw Object.assign(new Error(`Insufficient stock for ${line.p.name}.`),{statusCode:409});
        const after=before-line.item.quantity;
        db.prepare('update products set stock=?,updated_at=? where id=? and business_id=?').run(after,stamp,line.item.product_id,businessId);
        if(stockUserId)db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'sale',?,?,?,?,?,?)").run(businessId,branchId,line.item.product_id,stockUserId,line.item.quantity,before,after,`Order ${number}`,stamp,stamp);
      }
      db.prepare("insert into sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) values(?,?,?,?,? ,?,'pending',?,?)").run(businessId,input.client_id,'order',String(orderId),'create',JSON.stringify(input),stamp,stamp);
      if(input.table_id??table?.id)db.prepare("update restaurant_tables set status='occupied',updated_at=? where id=?").run(stamp,input.table_id??table.id);
      return orderDto(orderId,businessId);
    });
  }


  const appendOrderSchema=orderSchema.pick({items:true}).extend({client_id:z.string().uuid()});
  function appendOrderItems(orderId:number,input:ReturnType<typeof appendOrderSchema.parse>,u:any){
    return tx(()=>{
      const order=one(db,'select * from orders where id=? and business_id=?',orderId,u.business_id);
      if(!order)throw Object.assign(new Error('Order not found.'),{statusCode:404});
      if(one(db,"select 1 ok from audit_logs where business_id=? and action='order.append' and entity_type='order_append' and entity_id=?",u.business_id,input.client_id))return orderDto(orderId,u.business_id);
      if(order.payment_status==='paid'||['completed','cancelled'].includes(order.status))throw Object.assign(new Error('Order can no longer be modified.'),{statusCode:409});
      const lines=input.items.map(item=>{
        const p=one(db,'select * from products where id=? and business_id=? and is_active=1 and available=1',item.product_id,u.business_id);
        if(!p)throw Object.assign(new Error('Product unavailable.'),{statusCode:422});
        const variant=item.variant_id?one(db,'select * from product_variants where id=? and product_id=? and business_id=? and active=1',item.variant_id,item.product_id,u.business_id):null;
        if(item.variant_id&&!variant)throw Object.assign(new Error('Variant unavailable.'),{statusCode:422});
        const modifiers=item.modifier_ids.map(id=>one(db,'select * from product_modifiers where id=? and product_id=? and business_id=? and active=1',id,item.product_id,u.business_id));
        if(modifiers.some(value=>!value))throw Object.assign(new Error('Modifier unavailable.'),{statusCode:422});
        if(item.unit_price!==undefined||item.discount!==0||item.tax!==0)throw Object.assign(new Error('Line prices, taxes, and discounts are calculated by the server.'),{statusCode:422});
        const unit=cents(amount(p.sale_price_cents)+amount(variant?.price_delta_cents)+modifiers.reduce((sum,m)=>sum+amount(m.price_cents),0))/100;
        return {item,p,modifiers,unit,total:unit*item.quantity};
      });
      const stamp=now(),addedSubtotalCents=lines.reduce((sum,line)=>sum+cents(line.total),0);
      for(const line of lines){
        const prep=order.type==='retail'?null:'pending';
        const itemResult=db.prepare('insert into order_items(order_id,product_id,variant_id,quantity,unit_price_cents,discount_cents,tax_cents,total_cents,notes,preparation_status,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,line.item.product_id,line.item.variant_id??null,line.item.quantity,cents(line.unit),cents(line.item.discount),cents(line.item.tax),cents(line.total),line.item.notes??null,prep,stamp,stamp);
        for(const modifier of line.modifiers)db.prepare('insert into order_item_modifiers values(?,?,?,?)').run(Number(itemResult.lastInsertRowid),modifier.id,modifier.name,modifier.price_cents);
      }
      for(const line of lines){
        const current=one(db,'select stock,track_stock,name from products where id=? and business_id=?',line.item.product_id,u.business_id);
        if(!current)throw Object.assign(new Error('Product unavailable.'),{statusCode:422});
        if(!current.track_stock)continue;
        const before=Number(current.stock);
        if(before<line.item.quantity)throw Object.assign(new Error(`Insufficient stock for ${current.name}.`),{statusCode:409});
        const after=before-line.item.quantity;
        db.prepare('update products set stock=?,updated_at=? where id=? and business_id=?').run(after,stamp,line.item.product_id,u.business_id);
        db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'sale',?,?,?,?,?,?)").run(u.business_id,order.branch_id,line.item.product_id,u.id,line.item.quantity,before,after,`Order ${order.order_number}`,stamp,stamp);
      }
      const nextSubtotalCents=Number(order.subtotal_cents)+addedSubtotalCents,nextTotalCents=Math.max(0,nextSubtotalCents-Number(order.discount_cents)+Number(order.tax_cents)),nextStatus=order.type==='retail'?order.status:'pending';
      db.prepare('update orders set subtotal_cents=?,total_cents=?,status=?,updated_at=? where id=? and business_id=?').run(nextSubtotalCents,nextTotalCents,nextStatus,stamp,orderId,u.business_id);
      if(order.table_id)db.prepare("update restaurant_tables set status='occupied',updated_at=? where id=? and business_id=?").run(stamp,order.table_id,u.business_id);
      db.prepare("insert into audit_logs(business_id,branch_id,user_id,action,entity_type,entity_id,description,created_at) values(?,?,?,'order.append','order_append',?,?,?)").run(u.business_id,order.branch_id,u.id,input.client_id,`Appended ${lines.length} item line(s) to order ${order.order_number}`,stamp);
      return orderDto(orderId,u.business_id);
    });
  }

  app.get('/api/business/current',{preHandler:guard()},async r=>{const u=user(r),b=one(db,'select * from businesses where id=?',u.business_id);return {data:{...b,enabled_features:all(db,'select feature from business_features where business_id=? order by feature',u.business_id).map(x=>x.feature),branch:one(db,'select id,name,code from branches where id=?',u.branch_id)}}});
  app.put('/api/business/current',{preHandler:guard()},async(r,p)=>{const u=user(r);if(!['patron','owner','admin'].includes(u.role))return p.code(403).send({message:'Permission denied.'});const v=businessUpdateSchema.parse(r.body),b=one(db,'select * from businesses where id=?',u.business_id);db.prepare('update businesses set name=?,business_type=?,currency=?,locale=?,timezone=?,updated_at=? where id=?').run(v.name??b.name,v.business_type??b.business_type,v.currency??b.currency,v.locale??b.locale,v.timezone??b.timezone,now(),u.business_id);return {data:{...one(db,'select * from businesses where id=?',u.business_id),enabled_features:all(db,'select feature from business_features where business_id=?',u.business_id).map(x=>x.feature),branch:one(db,'select id,name,code from branches where id=?',u.branch_id)}}});
  app.put('/api/business/current/features',{preHandler:guard()},async(r,p)=>{const u=user(r);if(!['patron','owner','admin'].includes(u.role))return p.code(403).send({message:'Permission denied.'});const input=businessFeaturesSchema.parse(r.body),disabled=(f:string)=>!input.enabled_features.includes(f as any);if(disabled('tables')&&one(db,"select 1 ok from orders where business_id=? and table_id is not null and status not in('completed','cancelled') limit 1",u.business_id))return p.code(409).send({message:'Close active table orders before disabling tables.'});if(disabled('purchases')&&one(db,"select 1 ok from purchases where business_id=? and status not in('received','cancelled') limit 1",u.business_id))return p.code(409).send({message:'Complete active purchases before disabling purchases.'});tx(()=>{db.prepare('delete from business_features where business_id=?').run(u.business_id);for(const f of input.enabled_features)db.prepare('insert into business_features values(?,?,?)').run(u.business_id,f,now())});return {data:{...one(db,'select * from businesses where id=?',u.business_id),enabled_features:input.enabled_features,branch:one(db,'select id,name,code from branches where id=?',u.branch_id)}}});
  app.get('/api/orders',{preHandler:guard('pos')},async r=>{const u=user(r);return {data:all(db,'select id from orders where business_id=? order by created_at desc limit 250',u.business_id).map(o=>orderDto(o.id,u.business_id))}});
  app.post('/api/orders',{preHandler:guard('pos')},async(r,p)=>p.code(201).send({data:createOrder(orderSchema.parse(r.body),user(r))}));
  app.post('/api/orders/:id/items',{preHandler:guard('pos')},async(r,p)=>{const u=user(r),orderId=Number((r.params as any).id),input=appendOrderSchema.parse(r.body);return p.code(201).send({data:appendOrderItems(orderId,input,u)})});
  app.patch('/api/orders/:id/status',{preHandler:guard('pos')},async(r,p)=>{const u=user(r),orderId=Number((r.params as any).id),requested=z.object({status:z.enum(['accepted','preparing','ready','served','cancelled'])}).parse(r.body).status,order=one(db,'select * from orders where id=? and business_id=?',orderId,u.business_id);if(!order)return p.code(404).send({message:'Order not found.'});if(order.payment_status==='paid'||['completed','cancelled'].includes(order.status))return p.code(409).send({message:'Paid, completed, or cancelled orders cannot change status.'});const transitions:Record<string,string>={pending:'accepted',accepted:'preparing',preparing:'ready',ready:'served'};if(requested!=='cancelled'&&transitions[order.status]!==requested)return p.code(409).send({message:'Invalid order status transition.'});return {data:tx(()=>{const current=one(db,'select * from orders where id=? and business_id=?',orderId,u.business_id);if(!current||current.payment_status==='paid'||['completed','cancelled'].includes(current.status))throw Object.assign(new Error('Order cannot change status.'),{statusCode:409});const stamp=now();if(requested==='cancelled'){for(const line of all(db,'select oi.product_id,oi.quantity,p.stock,p.track_stock,p.name from order_items oi join products p on p.id=oi.product_id where oi.order_id=? and p.business_id=?',orderId,u.business_id)){if(!line.track_stock)continue;const before=Number(line.stock),after=before+Number(line.quantity);db.prepare('update products set stock=?,updated_at=? where id=? and business_id=?').run(after,stamp,line.product_id,u.business_id);db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'order_cancel',?,?,?,?,?,?)").run(u.business_id,u.branch_id,line.product_id,u.id,Number(line.quantity),before,after,`Cancelled order ${current.order_number}`,stamp,stamp)}db.prepare("update orders set status='cancelled',updated_at=? where id=? and business_id=?").run(stamp,orderId,u.business_id);if(current.table_id)db.prepare("update restaurant_tables set status='available',updated_at=? where id=? and business_id=?").run(stamp,current.table_id,u.business_id);db.prepare("insert into audit_logs(business_id,branch_id,user_id,action,entity_type,entity_id,description,created_at) values(?,?,?,'order.cancel','order',?,?,?)").run(u.business_id,u.branch_id,u.id,String(orderId),`Cancelled unpaid order ${current.order_number}`,stamp)}else db.prepare('update orders set status=?,updated_at=? where id=? and business_id=?').run(requested,stamp,orderId,u.business_id);return orderDto(orderId,u.business_id)})}});
  app.post('/api/orders/:id/pay',{preHandler:guard('pos')},async(r,p)=>{const u=user(r);if(!['patron','owner','admin','manager','worker','cashier'].includes(u.role))return p.code(403).send({message:'Permission denied.'});const orderId=Number((r.params as any).id),payment=z.object({payment_method:z.enum(['cash','card','other']).default('cash')}).parse(r.body),order=one(db,'select * from orders where id=? and business_id=?',orderId,u.business_id);if(!order)return p.code(404).send({message:'Order not found.'});const existing=one(db,'select id from sales where order_id=? and business_id=?',orderId,u.business_id);if(existing)return {data:{order:orderDto(orderId,u.business_id),sale_id:existing.id,replayed:true}};const register=one(db,"select id from cash_register_sessions where business_id=? and branch_id=? and status='open' order by opened_at desc limit 1",u.business_id,u.branch_id);if(!register)return p.code(409).send({message:'La caisse doit ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âªtre ouverte avant encaissement.'});return {data:tx(()=>{const lines=all(db,'select oi.*,p.purchase_price_cents from order_items oi join products p on p.id=oi.product_id where oi.order_id=?',orderId),profit=lines.reduce((sum,line)=>sum+(line.unit_price_cents-line.purchase_price_cents)*Number(line.quantity)-line.discount_cents,0),stamp=now(),sale=db.prepare('insert into sales(business_id,branch_id,order_id,user_id,cash_register_session_id,payment_method,note,total_cents,profit_cents,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,orderId,u.id,register.id,payment.payment_method,`Order ${order.order_number}`,order.total_cents,profit,stamp,stamp),saleId=Number(sale.lastInsertRowid);for(const line of lines)db.prepare('insert into sale_items(sale_id,product_id,quantity,unit_price_cents,purchase_price_cents,total_cents,profit_cents,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)').run(saleId,line.product_id,line.quantity,line.unit_price_cents,line.purchase_price_cents,line.total_cents,(line.unit_price_cents-line.purchase_price_cents)*Number(line.quantity)-line.discount_cents,stamp,stamp);db.prepare("update orders set payment_status='paid',status='completed',updated_at=? where id=?").run(stamp,orderId);if(order.table_id){db.prepare("update restaurant_tables set status='available',updated_at=? where id=? and business_id=?").run(stamp,order.table_id,u.business_id);db.prepare("update table_events set status='resolved',resolved_by_user_id=?,resolved_at=? where business_id=? and table_id=? and type='request_bill' and status='pending'").run(u.id,stamp,u.business_id,order.table_id)}return {order:orderDto(orderId,u.business_id),sale_id:saleId,replayed:false}})}});
  app.get('/api/suppliers',{preHandler:guard('suppliers')},async r=>({data:all(db,"select s.*,(select count(*) from purchases p where p.supplier_id=s.id and p.business_id=s.business_id) purchase_count,(select count(*) from purchases p where p.supplier_id=s.id and p.status='received') received_count,(select coalesce(sum(p.total_cents),0) from purchases p where p.supplier_id=s.id and p.status='received') received_total_cents,(select max(p.created_at) from purchases p where p.supplier_id=s.id) last_purchase_at,(select coalesce(sum(r.total_cents),0) from purchase_returns r join purchases p on p.id=r.purchase_id where p.supplier_id=s.id) returned_total_cents from suppliers s where s.business_id=? order by s.name",user(r).business_id).map(s=>({...s,received_total:amount(s.received_total_cents),returned_total:amount(s.returned_total_cents)}))}));
  app.post('/api/suppliers',{preHandler:guard('suppliers')},async(r,p)=>{const u=user(r),v=supplierSchema.parse(r.body),stamp=now();const x=db.prepare('insert into suppliers(business_id,name,contact,phone,email,address,notes,active,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)').run(u.business_id,v.name,v.contact??null,v.phone??null,v.email??null,v.address??null,v.notes??null,Number(v.active),stamp,stamp);return p.code(201).send({data:one(db,'select * from suppliers where id=?',Number(x.lastInsertRowid))})});
  app.get('/api/customers',{preHandler:guard('customers')},async r=>({data:all(db,"select c.*,(select count(*) from orders o where o.customer_id=c.id and o.business_id=c.business_id) order_count,(select coalesce(sum(o.total_cents),0) from orders o where o.customer_id=c.id and o.status='completed') total_spent_cents,(select max(o.created_at) from orders o where o.customer_id=c.id) last_purchase_at from customers c where c.business_id=? order by c.name",user(r).business_id).map(c=>({...c,total_spent:amount(c.total_spent_cents)}))}));
  app.post('/api/customers',{preHandler:guard('customers')},async(r,p)=>{const u=user(r),v=supplierSchema.pick({name:true,phone:true,email:true,address:true,notes:true,active:true}).parse(r.body),stamp=now();const x=db.prepare('insert into customers(business_id,name,phone,email,address,notes,active,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)').run(u.business_id,v.name,v.phone??null,v.email??null,v.address??null,v.notes??null,Number(v.active),stamp,stamp);return p.code(201).send({data:one(db,'select * from customers where id=?',Number(x.lastInsertRowid))})});
  app.get('/api/rooms',{preHandler:guard('tables')},async r=>({data:all(db,'select * from rooms where business_id=? and branch_id=? order by sort_order,name',user(r).business_id,user(r).branch_id)}));
  app.post('/api/rooms',{preHandler:guard('tables')},async(r,p)=>{const u=user(r),v=roomSchema.parse(r.body),stamp=now();const x=db.prepare('insert into rooms(business_id,branch_id,name,sort_order,active,created_at,updated_at) values(?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,v.name,v.sort_order,Number(v.active),stamp,stamp);return p.code(201).send({data:one(db,'select * from rooms where id=?',Number(x.lastInsertRowid))})});
  app.get('/api/tables',{preHandler:guard('tables')},async r=>{const u=user(r);tx(()=>{for(const table of all(db,'select id from restaurant_tables where business_id=? and branch_id=? and qr_public_token is null',u.business_id,u.branch_id))db.prepare('update restaurant_tables set qr_public_token=? where id=? and qr_public_token is null').run(crypto.randomBytes(32).toString('base64url'),table.id)});return {data:all(db,'select t.*,t.qr_public_token qr_token,r.name room_name from restaurant_tables t join rooms r on r.id=t.room_id where t.business_id=? and t.branch_id=? order by r.sort_order,t.table_number',u.business_id,u.branch_id)}});
  app.post('/api/tables',{preHandler:guard('tables')},async(r,p)=>{const u=user(r),v=tableSchema.parse(r.body),token=crypto.randomBytes(32).toString('base64url'),stamp=now();if(!one(db,'select 1 ok from rooms where id=? and business_id=?',v.room_id,u.business_id))return p.code(422).send({message:'Room not found.'});const x=db.prepare('insert into restaurant_tables(business_id,branch_id,room_id,table_number,name,capacity,status,qr_token_hash,qr_token_hint,qr_public_token,active,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,v.room_id,v.table_number,v.name,v.capacity,v.status,hash(token),token.slice(-8),token,Number(v.active),stamp,stamp);return p.code(201).send({data:{...one(db,'select * from restaurant_tables where id=?',Number(x.lastInsertRowid)),qr_token:token}})});
  app.post('/api/tables/:id/qr-token',{preHandler:guard('qr_menu')},async(r,p)=>{const u=user(r),token=crypto.randomBytes(32).toString('base64url'),tableId=Number((r.params as any).id);const result=db.prepare('update restaurant_tables set qr_public_token=?,qr_token_hash=?,qr_token_hint=?,updated_at=? where id=? and business_id=?').run(token,hash(token),token.slice(-8),now(),tableId,u.business_id);return result.changes?{data:{...one(db,'select * from restaurant_tables where id=?',tableId),qr_token:token}}:p.code(404).send({message:'Table not found.'})});
  app.get('/api/table-events',{preHandler:guard('tables')},async r=>({data:all(db,"select e.*,t.name table_name,t.table_number from table_events e join restaurant_tables t on t.id=e.table_id where e.business_id=? and e.status='pending' order by e.created_at",user(r).business_id)}));
  app.patch('/api/table-events/:id/resolve',{preHandler:guard('tables')},async(r,p)=>{const u=user(r),eventId=Number((r.params as any).id),result=db.prepare("update table_events set status='resolved',resolved_by_user_id=?,resolved_at=? where id=? and business_id=? and status='pending'").run(u.id,now(),eventId,u.business_id);return result.changes?{data:one(db,'select * from table_events where id=?',eventId)}:p.code(404).send({message:'Request not found.'})});
  app.get('/api/kitchen/orders',{preHandler:guard('kitchen')},async r=>({data:all(db,"select id from orders where business_id=? and type<>'retail' and status not in('completed','cancelled') order by created_at",user(r).business_id).map(o=>orderDto(o.id,user(r).business_id))}));
  app.patch('/api/kitchen/items/:id',{preHandler:guard('kitchen')},async(r,p)=>{const u=user(r),status=(r.body as any)?.status;if(!['pending','accepted','preparing','ready','served','cancelled'].includes(status))return p.code(422).send({message:'Invalid status.'});const itemId=Number((r.params as any).id),item=one(db,'select oi.* from order_items oi join orders o on o.id=oi.order_id where oi.id=? and o.business_id=?',itemId,u.business_id);if(!item)return p.code(404).send({message:'Order item not found.'});db.prepare('update order_items set preparation_status=?,updated_at=? where id=?').run(status,now(),itemId);const states=all(db,'select preparation_status from order_items where order_id=? and preparation_status is not null',item.order_id).map(row=>row.preparation_status),orderStatus=states.every(value=>value==='served'||value==='cancelled')?'served':states.every(value=>['ready','served','cancelled'].includes(value))?'ready':states.some(value=>['accepted','preparing'].includes(value))?'preparing':'pending';db.prepare('update orders set status=?,updated_at=? where id=?').run(orderStatus,now(),item.order_id);return {data:{...item,preparation_status:status}}});
  app.get('/api/purchases',{preHandler:guard('purchases')},async r=>({data:all(db,'select p.*,s.name supplier_name from purchases p join suppliers s on s.id=p.supplier_id where p.business_id=? order by p.created_at desc',user(r).business_id)}));
  app.post('/api/purchases',{preHandler:guard('purchases')},async(r,p)=>{const u=user(r),v=purchaseSchema.parse(r.body),subtotal=v.items.reduce((s,i)=>s+i.quantity*i.purchase_price,0),stamp=now();const row=tx(()=>{const x=db.prepare('insert into purchases(business_id,branch_id,supplier_id,reference,status,subtotal_cents,tax_cents,total_cents,payment_status,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,v.supplier_id,v.reference,v.status,cents(subtotal),cents(v.tax),cents(subtotal+v.tax),v.payment_status,stamp,stamp);for(const i of v.items)db.prepare('insert into purchase_items(purchase_id,product_id,quantity,purchase_price_cents,tax_cents,total_cents) values(?,?,?,?,?,?)').run(Number(x.lastInsertRowid),i.product_id,i.quantity,cents(i.purchase_price),cents(i.tax),cents(i.quantity*i.purchase_price+i.tax));return one(db,'select * from purchases where id=?',Number(x.lastInsertRowid))});return p.code(201).send({data:row})});
  app.post('/api/purchases/:id/receive',{preHandler:guard('purchases')},async(r,p)=>{const u=user(r),purchaseId=Number((r.params as any).id),purchase=one(db,"select * from purchases where id=? and business_id=? and status not in('received','cancelled')",purchaseId,u.business_id);if(!purchase)return p.code(409).send({message:'Purchase cannot be received.'});const result=tx(()=>{for(const item of all(db,'select * from purchase_items where purchase_id=?',purchaseId)){const product=one(db,'select * from products where id=? and business_id=?',item.product_id,u.business_id),quantity=Number(item.quantity)-Number(item.received_quantity);if(quantity<=0)continue;const before=Number(product.stock),after=before+quantity;db.prepare('update products set stock=?,purchase_price_cents=?,updated_at=? where id=?').run(after,item.purchase_price_cents,now(),item.product_id);db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'purchase',?,?,?,?,?,?)").run(u.business_id,u.branch_id,item.product_id,u.id,quantity,before,after,`Purchase ${purchase.reference}`,now(),now());db.prepare('update purchase_items set received_quantity=quantity where id=?').run(item.id)}db.prepare("update purchases set status='received',received_at=?,updated_at=? where id=?").run(now(),now(),purchaseId);return one(db,'select * from purchases where id=?',purchaseId)});return {data:result}});
  app.get('/api/purchases/:id',{preHandler:guard('purchases')},async(r,p)=>{const u=user(r),purchaseId=Number((r.params as any).id),purchase=one(db,'select p.*,s.name supplier_name from purchases p join suppliers s on s.id=p.supplier_id where p.id=? and p.business_id=?',purchaseId,u.business_id);return purchase?{data:{...purchase,items:all(db,'select i.*,p.name product_name,coalesce((select sum(quantity) from purchase_returns r where r.purchase_item_id=i.id),0) returned_quantity from purchase_items i join products p on p.id=i.product_id where i.purchase_id=?',purchaseId),returns:all(db,'select r.*,p.name product_name from purchase_returns r join products p on p.id=r.product_id where r.purchase_id=? order by r.created_at desc',purchaseId)}}:p.code(404).send({message:'Purchase not found.'})});
  app.post('/api/purchases/:id/returns',{preHandler:guard('purchases')},async(r,p)=>{const u=user(r),purchaseId=Number((r.params as any).id),input=z.object({purchase_item_id:z.number().int().positive(),quantity:z.coerce.number().positive(),reason:z.string().trim().min(2).max(500)}).parse(r.body),item=one(db,'select i.*,x.business_id,p.stock,p.name product_name from purchase_items i join purchases x on x.id=i.purchase_id join products p on p.id=i.product_id where i.id=? and i.purchase_id=? and x.business_id=?',input.purchase_item_id,purchaseId,u.business_id);if(!item)return p.code(404).send({message:'Purchase item not found.'});const returned=Number(one(db,'select coalesce(sum(quantity),0) quantity from purchase_returns where purchase_item_id=?',item.id)?.quantity??0),available=Number(item.received_quantity)-returned;if(input.quantity>available)return p.code(409).send({message:`Return quantity exceeds received quantity for ${item.product_name}.`});if(input.quantity>Number(item.stock))return p.code(409).send({message:`Insufficient current stock for ${item.product_name}.`});return p.code(201).send({data:tx(()=>{const stamp=now(),before=Number(item.stock),after=before-input.quantity,total=cents(input.quantity*amount(item.purchase_price_cents)),created=db.prepare('insert into purchase_returns(business_id,branch_id,purchase_id,purchase_item_id,product_id,user_id,quantity,reason,total_cents,created_at) values(?,?,?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,purchaseId,item.id,item.product_id,u.id,input.quantity,input.reason,total,stamp),returnId=Number(created.lastInsertRowid);db.prepare('update products set stock=?,updated_at=? where id=?').run(after,stamp,item.product_id);db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'purchase_return',?,?,?,?,?,?)").run(u.business_id,u.branch_id,item.product_id,u.id,input.quantity,before,after,`Purchase return #${purchaseId}: ${input.reason}`,stamp,stamp);db.prepare("insert into audit_logs(business_id,branch_id,user_id,action,entity_type,entity_id,description,created_at) values(?,?,?,'purchase.return','purchase',?,?,?)").run(u.business_id,u.branch_id,u.id,String(purchaseId),`${input.quantity} x ${item.product_name}: ${input.reason}`,stamp);return one(db,'select * from purchase_returns where id=?',returnId)})})});
  app.get('/api/sales/:id/returns',{preHandler:guard('pos')},async r=>{const u=user(r),saleId=Number((r.params as any).id);return {data:all(db,'select * from sale_returns where business_id=? and sale_id=? order by created_at desc',u.business_id,saleId).map(row=>({...row,total:amount(row.total_cents),items:all(db,'select * from sale_return_items where return_id=?',row.id).map(item=>({...item,unit_price:amount(item.unit_price_cents),total:amount(item.total_cents)}))}))}});
  app.post('/api/sales/:id/returns',{preHandler:guard('inventory')},async(r,p)=>{
    const u=user(r),saleId=Number((r.params as any).id),input=z.object({reason:z.string().trim().min(2).max(500),refund_method:z.enum(['original','cash','card','other']).default('original'),items:z.array(z.object({sale_item_id:z.number().int().positive(),quantity:z.coerce.number().positive()})).min(1)}).parse(r.body);
    if(!one(db,'select 1 ok from sales where id=? and business_id=?',saleId,u.business_id))return p.code(404).send({message:'Sale not found.'});
    const data=tx(()=>{
      let total=0;
      const lines=input.items.map(requested=>{const item=one(db,'select si.*,p.track_stock,p.name product_name from sale_items si join products p on p.id=si.product_id where si.id=? and si.sale_id=? and p.business_id=?',requested.sale_item_id,saleId,u.business_id);if(!item)throw Object.assign(new Error('Sale item not found.'),{statusCode:422});const returned=Number(one(db,'select coalesce(sum(quantity),0) quantity from sale_return_items where sale_item_id=?',item.id)?.quantity??0);if(requested.quantity>Number(item.quantity)-returned)throw Object.assign(new Error(`Return quantity exceeds remaining quantity for ${item.product_name}.`),{statusCode:409});const lineTotal=item.unit_price_cents*requested.quantity;total+=lineTotal;return {item,quantity:requested.quantity,total:lineTotal}});
      const stamp=now(),created=db.prepare('insert into sale_returns(business_id,branch_id,sale_id,user_id,reason,refund_method,total_cents,created_at) values(?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,saleId,u.id,input.reason,input.refund_method,total,stamp),returnId=Number(created.lastInsertRowid);
      for(const line of lines){db.prepare('insert into sale_return_items(return_id,sale_item_id,product_id,quantity,unit_price_cents,total_cents) values(?,?,?,?,?,?)').run(returnId,line.item.id,line.item.product_id,line.quantity,line.item.unit_price_cents,line.total);if(line.item.track_stock){const product=one(db,'select stock from products where id=?',line.item.product_id),before=Number(product.stock),after=before+line.quantity;db.prepare('update products set stock=?,updated_at=? where id=?').run(after,stamp,line.item.product_id);db.prepare("insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,'sale_return',?,?,?,?,?,?)").run(u.business_id,u.branch_id,line.item.product_id,u.id,line.quantity,before,after,`Return sale #${saleId}: ${input.reason}`,stamp,stamp)}}
      db.prepare("insert into audit_logs(business_id,branch_id,user_id,action,entity_type,entity_id,description,created_at) values(?,?,?,'sale.return','sale',?,?,?)").run(u.business_id,u.branch_id,u.id,String(saleId),`Refund ${amount(total)}: ${input.reason}`,stamp);
      return {...one(db,'select * from sale_returns where id=?',returnId),total:amount(total)};
    });
    return p.code(201).send({data});
  });
  app.get('/api/inventory-counts',{preHandler:guard('inventory')},async r=>({data:all(db,'select c.*,(select count(*) from inventory_count_items where count_id=c.id) item_count,(select count(*) from inventory_count_items where count_id=c.id and counted_stock is not null) counted_count from inventory_counts c where business_id=? order by created_at desc',user(r).business_id)}));
  app.post('/api/inventory-counts',{preHandler:guard('inventory')},async(r,p)=>{const u=user(r),reason=z.object({reason:z.string().trim().max(500).nullable().optional()}).parse(r.body).reason,stamp=now();return p.code(201).send({data:tx(()=>{const created=db.prepare('insert into inventory_counts(business_id,branch_id,user_id,reason,created_at) values(?,?,?,?,?)').run(u.business_id,u.branch_id,u.id,reason??null,stamp),countId=Number(created.lastInsertRowid);db.prepare('insert into inventory_count_items(count_id,product_id,expected_stock) select ?,id,stock from products where business_id=? and track_stock=1 and is_active=1').run(countId,u.business_id);return one(db,'select * from inventory_counts where id=?',countId)})})});
  app.get('/api/inventory-counts/:id',{preHandler:guard('inventory')},async(r,p)=>{const u=user(r),countId=Number((r.params as any).id),count=one(db,'select * from inventory_counts where id=? and business_id=?',countId,u.business_id);return count?{data:{...count,items:all(db,'select i.*,p.name,p.sku,p.barcode,p.unit from inventory_count_items i join products p on p.id=i.product_id where i.count_id=? order by p.name',countId)}}:p.code(404).send({message:'Inventory count not found.'})});
  app.put('/api/inventory-counts/:id/items',{preHandler:guard('inventory')},async(r,p)=>{const u=user(r),countId=Number((r.params as any).id),input=z.object({items:z.array(z.object({product_id:z.number().int().positive(),counted_stock:z.coerce.number().nonnegative()})).min(1)}).parse(r.body);if(!one(db,"select 1 ok from inventory_counts where id=? and business_id=? and status='draft'",countId,u.business_id))return p.code(409).send({message:'Inventory count is not editable.'});for(const item of input.items)db.prepare('update inventory_count_items set counted_stock=? where count_id=? and product_id=?').run(item.counted_stock,countId,item.product_id);return {data:{updated:input.items.length}}});
  app.post('/api/inventory-counts/:id/confirm',{preHandler:guard('inventory')},async(r,p)=>{const u=user(r),countId=Number((r.params as any).id),count=one(db,"select * from inventory_counts where id=? and business_id=? and status='draft'",countId,u.business_id);if(!count)return p.code(409).send({message:'Inventory count cannot be confirmed.'});return {data:tx(()=>{const stamp=now(),items=all(db,'select i.*,p.stock,p.name from inventory_count_items i join products p on p.id=i.product_id where i.count_id=? and i.counted_stock is not null',countId);for(const item of items){const before=Number(item.stock),after=Number(item.counted_stock),difference=after-before;if(!difference)continue;db.prepare('update products set stock=?,updated_at=? where id=?').run(after,stamp,item.product_id);db.prepare('insert into stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?)').run(u.business_id,u.branch_id,item.product_id,u.id,difference>0?'adjustment_in':'adjustment_out',Math.abs(difference),before,after,`Inventory #${countId}${count.reason?`: ${count.reason}`:''}`,stamp,stamp)}db.prepare("update inventory_counts set status='confirmed',confirmed_at=? where id=?").run(stamp,countId);db.prepare("insert into audit_logs(business_id,branch_id,user_id,action,entity_type,entity_id,description,created_at) values(?,?,?,'inventory.confirm','inventory_count',?,?,?)").run(u.business_id,u.branch_id,u.id,String(countId),`Confirmed ${items.length} counted products`,stamp);return {id:countId,status:'confirmed'}})}});
  app.get('/api/audit-logs',{preHandler:guard()},async(r,p)=>{const u=user(r);if(!['patron','owner','admin'].includes(u.role))return p.code(403).send({message:'Permission denied.'});return {data:all(db,'select a.*,u.name user_name from audit_logs a left join users u on u.id=a.user_id where a.business_id=? order by a.created_at desc limit 250',u.business_id)}});
  const verifyDeviceProof=(publicKey:string,payload:string,signature:string)=>{
    try{
      const key=crypto.createPublicKey({key:JSON.parse(publicKey),format:'jwk'});
      return crypto.verify(
        null,
        Buffer.from(payload,'utf8'),
        key,
        Buffer.from(signature,'base64url')
      );
    }catch{
      return false;
    }
  };

  const offlineProofPayload=(input:{
    installation_id:string;
    device_public_key:string;
    device_name:string;
    app_version:string;
    business_type:string;
    nonce:string;
    requested_at:string;
  })=>[
    'posreq-v1',
    input.installation_id,
    input.device_public_key,
    input.device_name,
    input.app_version,
    input.business_type,
    input.nonce,
    input.requested_at
  ].join('\n');

  const importProofPayload=(certificateId:string,installationId:string)=>
    ['poslic-import-v1',certificateId,installationId].join('\n');


  const licenseServerUrl=()=>{
    const raw=process.env.LICENSE_SERVER_URL?.trim()||'https://pos.workflowtools.space';
    const url=new URL(raw);

    const loopback=
      url.hostname==='127.0.0.1'||
      url.hostname==='localhost';

    if(url.protocol!=='https:'&&!(
      process.env.NODE_ENV!=='production'&&
      loopback
    )){
      throw Object.assign(
        new Error('License server must use HTTPS.'),
        {statusCode:503}
      );
    }

    return raw.replace(/\/+$/,'');
  };
  app.get('/api/license/status',async()=>{
    if(process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')
      return{data:{status:'development',features:'all',development:true}};

    const state=one(db,'select * from merchant_license_state where id=1');

    if(!state)return{data:{status:'activation_required',features:[]}};
    const certificate=storedCertificate(state);
    const derived=certificate?certificateStatus(certificate):null;
    return{data:{
      ...state,
      status:derived&&derived!=='active'?derived:certificate?(state.status==='legacy'?'activation_required':state.status):(state.status==='active'||state.status==='legacy'?'activation_required':state.status),
      expires_at:certificate&&Number.isFinite(certificateDeadline(certificate))?new Date(certificateDeadline(certificate)).toISOString():state.expires_at,
      features:certificate?.features??[],
      certificate
    }};
  });


  app.post('/api/license/activate',{preHandler:activationAdmin},async(r,p)=>{

    const input=z.object({
      license_key:z.string().min(20).max(200),
      installation_id:z.string().uuid(),
      device_public_key:z.string().min(40).max(5000),
      device_name:z.string().min(1).max(200),
      app_version:z.string().min(1).max(100),
      nonce:z.string().min(16).max(200),
      requested_at:z.string().datetime(),
      device_proof:z.string().min(40).max(500)
    }).parse(r.body);

    let response:Response;

    try{
      response=await fetch(
        `${licenseServerUrl()}/api/license/device-activate`,
        {
          method:'POST',
          headers:{
            'content-type':'application/json',
            accept:'application/json'
          },
          body:JSON.stringify(input),
          signal:AbortSignal.timeout(10000)
        }
      );
    }catch{
      return p.code(503).send({
        message:'License server is unavailable.',
        code:'LICENSE_SERVER_UNAVAILABLE'
      });
    }

    const body=await response.json().catch(()=>null) as any;

    if(!response.ok){
      return p.code(response.status).send({
        message:
          body?.message||
          'Online license activation failed.',
        code:body?.code
      });
    }

    const signed=body?.data??body;

    const parsed=z.object({
      certificate:z.any(),
      signature:z.string().min(40)
    }).safeParse(signed);

    if(!parsed.success)
      return p.code(502).send({
        message:'License server returned an invalid response.'
      });

    const certificate=
      parsed.data.certificate as LicenseCertificate;

    const publicKey=
      process.env.LICENSE_SIGNING_PUBLIC_KEY
        ?.replaceAll('\\n','\n');

    if(!publicKey)
      return p.code(503).send({
        message:'License verification key is not configured.'
      });

    if(!verifyCertificate(
      certificate,
      parsed.data.signature,
      publicKey
    )){
      return p.code(502).send({
        message:'License signature is invalid.'
      });
    }

    if(
      certificate.installation_id!==input.installation_id||
      certificate.device_fingerprint!==
        fingerprint(input.device_public_key)
    ){
      return p.code(403).send({
        message:'License certificate belongs to another device.'
      });
    }

    if(!certificateIsCurrent(certificate)){
      return p.code(422).send({
        message:'License has expired.'
      });
    }

    if(certificate.version!==2)
      return p.code(422).send({message:'A version 2 commercial certificate is required.',code:'LICENSE_CERTIFICATE_VERSION_UNSUPPORTED'});
    const configuredBusiness=one(db,'select business_type,vendor_business_id from businesses order by id limit 1');
    if(configuredBusiness&&!businessTypeAllowed(certificate.business_type,configuredBusiness.business_type))
      return p.code(422).send({message:'License is not compatible with this business type.'});
    if(configuredBusiness?.vendor_business_id&&configuredBusiness.vendor_business_id!==certificate.vendor_business_id)
      return p.code(409).send({message:'License belongs to another Vendor Business.',code:'LICENSE_VENDOR_BUSINESS_MISMATCH'});

    storeCertificate(certificate,parsed.data.signature);

    return{
      data:{
        status:'active',
        certificate
      }
    };
  });
  app.post('/api/license/revalidate',{preHandler:activationAdmin},async(r,p)=>{
    const input=z.object({
      installation_id:z.string().uuid(),
      device_public_key:z.string().min(40).max(5000),
      device_name:z.string().min(1).max(200),
      app_version:z.string().min(1).max(100),
      nonce:z.string().min(16).max(200),
      requested_at:z.string().datetime(),
      device_proof:z.string().min(40).max(500)
    }).strict().parse(r.body);
    const state=licenseState(),cached=storedCertificate(state);
    if(!cached||cached.version!==2)return p.code(409).send({message:'No device certificate is available for validation.',code:'LICENSE_REQUIRED'});
    if(cached.installation_id!==input.installation_id||cached.device_fingerprint!==fingerprint(input.device_public_key))return p.code(403).send({message:'Device identity mismatch.',code:'DEVICE_IDENTITY_MISMATCH'});
    const outbound={license_id:cached.license_id,certificate_id:cached.certificate_id,...input};
    let response:Response;
    try{response=await fetch(`${licenseServerUrl()}/api/license/device-validate`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(outbound),signal:AbortSignal.timeout(10000)});}catch{return p.code(503).send({message:'License server is unavailable; the cached offline deadline still applies.',code:'LICENSE_SERVER_UNAVAILABLE'});}
    const body=await response.json().catch(()=>null) as any;
    if(!response.ok){
      const terminal:Record<string,string>={LICENSE_REVOKED:'revoked',LICENSE_INACTIVE:'suspended',LICENSE_EXPIRED:'expired',DEVICE_REVOKED:'device_revoked',VENDOR_BUSINESS_INACTIVE:'vendor_business_inactive'};
      if(body?.code&&terminal[body.code])db.prepare("update merchant_license_state set status=?,device_status=?,reason_code=?,updated_at=? where id=1").run(terminal[body.code],body.code==='DEVICE_REVOKED'?'revoked':state.device_status,body.code,now());
      return p.code(response.status).send({message:body?.message||'Online license validation failed.',code:body?.code});
    }
    const signed=body?.data??body,certificate=signed?.certificate as LicenseCertificate,signature=signed?.signature;
    const publicKey=process.env.LICENSE_SIGNING_PUBLIC_KEY?.replaceAll('\\n','\n');
    if(!certificate||certificate.version!==2||typeof signature!=='string'||!publicKey||!verifyCertificate(certificate,signature,publicKey))return p.code(502).send({message:'License server returned an invalid certificate.',code:'LICENSE_SIGNATURE_INVALID'});
    if(certificate.installation_id!==input.installation_id||certificate.device_fingerprint!==fingerprint(input.device_public_key))return p.code(403).send({message:'Device identity mismatch.',code:'DEVICE_IDENTITY_MISMATCH'});
    if(!certificateIsCurrent(certificate))return p.code(422).send({message:'License has expired.',code:certificateStatus(certificate)==='offline_validity_exceeded'?'OFFLINE_VALIDITY_EXCEEDED':'LICENSE_EXPIRED'});
    storeCertificate(certificate,signature);
    return{data:{status:'active',certificate}};
  });
  app.post('/api/license/offline-request',{preHandler:activationAdmin},async(r,p)=>{

    const input=z.object({
      installation_id:z.string().uuid(),
      device_public_key:z.string().min(40).max(5000),
      device_name:z.string().min(1).max(200),
      app_version:z.string().min(1).max(100),
      business_type:z.enum(['cafe','restaurant','library','grocery','drugstore','retail','custom']),
      nonce:z.string().min(16).max(200),
      requested_at:z.string().datetime(),
      device_proof:z.string().min(40).max(500)
    }).parse(r.body);

    const proofPayload=offlineProofPayload(input);

    const configuredBusiness=one(db,'select business_type from businesses order by id limit 1');
    if(configuredBusiness&&configuredBusiness.business_type!==input.business_type)
      return p.code(422).send({message:'Activation request business type mismatch.'});

    if(!verifyDeviceProof(
      input.device_public_key,
      proofPayload,
      input.device_proof
    )){
      return p.code(403).send({
        message:'Device identity proof is invalid.',
        code:'DEVICE_PROOF_INVALID'
      });
    }

    return{
      data:{
        version:1,
        installation_id:input.installation_id,
        device_public_key:input.device_public_key,
        device_name:input.device_name,
        app_version:input.app_version,
        business_type:input.business_type,
        nonce:input.nonce,
        requested_at:input.requested_at,
        device_proof:input.device_proof
      }
    };
  });

  app.post('/api/license/import',{preHandler:activationAdmin},async(r,p)=>{

    const input=z.object({
      certificate:z.any(),
      signature:z.string().min(40),
      installation_id:z.string().uuid(),
      device_public_key:z.string().min(40).max(5000),
      device_proof:z.string().min(40).max(500)
    }).parse(r.body);

    const certificate=input.certificate as LicenseCertificate;

    if(!certificate?.certificate_id)
      return p.code(422).send({message:'License certificate is invalid.'});
    if(certificate.version!==2)
      return p.code(422).send({message:'A version 2 commercial certificate is required.',code:'LICENSE_CERTIFICATE_VERSION_UNSUPPORTED'});

    if(!verifyDeviceProof(
      input.device_public_key,
      importProofPayload(certificate.certificate_id,input.installation_id),
      input.device_proof
    )){
      return p.code(403).send({
        message:'Device identity proof is invalid.',
        code:'DEVICE_PROOF_INVALID'
      });
    }

    const publicKey=process.env.LICENSE_SIGNING_PUBLIC_KEY?.replaceAll('\\n','\n');

    if(!publicKey)
      return p.code(503).send({message:'License verification key is not configured.'});

    if(!verifyCertificate(certificate,input.signature,publicKey))
      return p.code(422).send({message:'License signature is invalid.'});

    if(
      certificate.installation_id!==input.installation_id||
      certificate.device_fingerprint!==fingerprint(input.device_public_key)
    ){
      return p.code(403).send({message:'This license belongs to another device.'});
    }

    if(!certificateIsCurrent(certificate))
      return p.code(422).send({message:'License has expired.'});

    const configuredBusiness=one(db,'select business_type,vendor_business_id from businesses order by id limit 1');
    if(configuredBusiness&&!businessTypeAllowed(certificate.business_type,configuredBusiness.business_type))
      return p.code(422).send({message:'License is not compatible with this business type.'});
    if(configuredBusiness?.vendor_business_id&&configuredBusiness.vendor_business_id!==certificate.vendor_business_id)
      return p.code(409).send({message:'License belongs to another Vendor Business.',code:'LICENSE_VENDOR_BUSINESS_MISMATCH'});

    storeCertificate(certificate,input.signature);

    return{data:{status:'active',certificate}};
  });
  app.get('/api/sync/status',{preHandler:guard()},async r=>({data:one(db,"select max(updated_at) last_sync_at,count(*) filter(where sync_status in('failed','conflict')) failed_count from sync_mutations where business_id=?",user(r).business_id)}));
  app.get('/api/sync/outbox',{preHandler:guard()},async r=>({data:all(db,"select * from sync_mutations where business_id=? and sync_status in('pending','failed') order by id limit 100",user(r).business_id).map(x=>({...x,payload:JSON.parse(x.payload_json)}))}));
  app.post('/api/sync/outbox/:clientId/ack',{preHandler:guard()},async r=>{const u=user(r);db.prepare("update sync_mutations set sync_status='synced',last_error=null,updated_at=? where business_id=? and client_id=?").run(now(),u.business_id,(r.params as any).clientId);return {message:'Acknowledged.'}});
  app.post('/api/sync/outbox/:clientId/retry',{preHandler:guard()},async r=>{const u=user(r);db.prepare("update sync_mutations set sync_status='pending',last_error=null,updated_at=? where business_id=? and client_id=?").run(now(),u.business_id,(r.params as any).clientId);return {message:'Queued.'}});
  const table=(slug:string,token:string,requiredFeatures=['qr_menu'])=>{const result=one(db,"select t.*,b.name business_name,b.slug,b.currency,b.vendor_business_id,r.name room_name from restaurant_tables t join businesses b on b.id=t.business_id join rooms r on r.id=t.room_id join business_features f on f.business_id=b.id and f.feature='qr_menu' where b.slug=? and (t.qr_public_token=? or t.qr_token_hash=?) and t.active=1",slug,token,hash(token));if(!result||process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')return result;const state=licenseState(),certificate=storedCertificate(state);if(state?.status!=='active'||!certificate||!result.vendor_business_id||result.vendor_business_id!==state.vendor_business_id)return null;return certificateIsCurrent(certificate)&&requiredFeatures.every(feature=>certificate.features.includes(feature))?result:null};
  app.get('/api/public/menu/:slug/table/:token',async(r,p)=>{const q=r.params as any,t=table(q.slug,q.token);if(!t)return p.code(404).send({message:'Menu not found.'});return {data:{business:{name:t.business_name,slug:t.slug,currency:t.currency},table:{id:t.id,name:t.name,number:t.table_number,room:t.room_name},categories:all(db,'select * from categories where business_id=? and is_public=1 order by name',t.business_id),products:all(db,'select id,category_id,name,sale_price_cents,image,available from products where business_id=? and is_public=1 and is_active=1 and available=1 order by name',t.business_id).map(x=>({...x,sale_price:amount(x.sale_price_cents),variants:all(db,'select id,name,price_delta_cents from product_variants where business_id=? and product_id=? and active=1 order by id',t.business_id,x.id).map(v=>({...v,price:amount(v.price_delta_cents)})),modifiers:all(db,'select id,name,price_cents from product_modifiers where business_id=? and product_id=? and active=1 order by id',t.business_id,x.id).map(m=>({...m,price:amount(m.price_cents)}))}))}}});
  app.post('/api/public/menu/:slug/table/:token/orders',async(r,p)=>{const q=r.params as any,t=table(q.slug,q.token,['qr_menu','pos']);if(!t)return p.code(404).send({message:'Menu not found.'});const input=orderSchema.parse({...r.body as object,source:'qr_table',type:'dine_in',table_id:t.id});return p.code(201).send({data:createOrder(input,null,t)})});
  app.post('/api/public/menu/:slug/table/:token/events',async(r,p)=>{const q=r.params as any,t=table(q.slug,q.token),type=(r.body as any)?.type;if(!t)return p.code(404).send({message:'Menu not found.'});if(!['call_waiter','request_bill'].includes(type))return p.code(422).send({message:'Invalid event.'});db.prepare('insert into table_events(business_id,table_id,type,status,created_at) values(?,?,?,\'pending\',?)').run(t.business_id,t.id,type,now());if(type==='request_bill')db.prepare("update restaurant_tables set status='bill_requested',updated_at=? where id=?").run(now(),t.id);return p.code(202).send({message:'Request received.'})});
}
