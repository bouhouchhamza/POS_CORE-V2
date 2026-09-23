import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {openLocalDatabase} from './database.js';
import {ensureLocalPaths,resolveLocalPaths} from './paths.js';
import {buildLocalApp} from './server.js';

process.env.NODE_ENV='test';
process.env.LICENSE_MODE='development';

const stamp='2026-09-01T10:00:00.000Z';
const remoteSale=(syncId:string,productSyncId:string,links:{order?:string;session?:number}={})=>({
  sync_id:syncId,server_id:Math.floor(Math.random()*100000)+1,updated_at:stamp,data:{branch_code:'MAIN',user_email:'owner@local.test',payment_method:'cash',note:null,
    order_client_id:links.order??null,cash_register_session_server_id:links.session??null,total_cents:500,profit_cents:400,
    items:[{product_sync_id:productSyncId,quantity:1,unit_price_cents:500,purchase_price_cents:100,total_cents:500,profit_cents:400}]},
});

test('sales pull fails closed when a linked local order or session is unavailable',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-sales-dependencies-')),
    paths=ensureLocalPaths(resolveLocalPaths({BIMIK_DATA_DIR:root}));
  let db:any,app:any;
  try{
    db=openLocalDatabase(paths);
    const password=await bcrypt.hash('secret',4),productSyncId=crypto.randomUUID();
    db.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,created_at,updated_at) values(1,'Local','local','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?)").run(stamp,stamp);
    db.prepare("insert into branches(id,business_id,name,code,active,created_at,updated_at) values(1,1,'Main','MAIN',1,?,?)").run(stamp,stamp);
    db.prepare("insert into users(id,business_id,branch_id,name,email,password,role,is_active,created_at,updated_at) values(1,1,1,'Owner','owner@local.test',?,'owner',1,?,?)").run(password,stamp,stamp);
    const product=Number(db.prepare("insert into products(business_id,name,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,is_active,is_public,available,created_at,updated_at) values(1,'Coffee',100,500,5,0,1,1,1,1,?,?)").run(stamp,stamp).lastInsertRowid);
    db.prepare("insert into master_sync_entities(entity_type,local_id,sync_id,server_id,sync_status) values('products',?,?,1,'synced')").run(product,productSyncId);
    app=await buildLocalApp({paths,database:db});
    const login=await app.inject({method:'POST',url:'/api/login',payload:{email:'owner@local.test',password:'secret'}}),headers={authorization:`Bearer ${login.json().data.access_token}`};
    const valid=remoteSale(crypto.randomUUID(),productSyncId),missingOrder=remoteSale(crypto.randomUUID(),productSyncId,{order:crypto.randomUUID()});
    const orderFailure=await app.inject({method:'POST',url:'/api/sync/sales/apply',headers,payload:{cursor:`${stamp}|2`,sales:[valid,missingOrder],returns:[]}});
    assert.equal(orderFailure.statusCode,409,orderFailure.body);
    assert.equal(orderFailure.json().code,'SYNC_DEPENDENCY_MISSING');
    assert.equal(db.prepare('select count(*) n from sales').get().n,0);
    assert.equal(db.prepare("select value from sync_state where key='sales_cursor'").get(),undefined);
    const localOrder=crypto.randomUUID();
    db.prepare("insert into orders(business_id,branch_id,client_id,order_number,source,type,user_id,status,subtotal_cents,discount_cents,tax_cents,total_cents,payment_status,sync_status,created_at,updated_at) values(1,1,?,'REMOTE-1','pos','retail',1,'pending',500,0,0,500,'unpaid','synced',?,?)").run(localOrder,stamp,stamp);
    const sessionFailure=await app.inject({method:'POST',url:'/api/sync/sales/apply',headers,payload:{cursor:`${stamp}|3`,sales:[remoteSale(crypto.randomUUID(),productSyncId,{order:localOrder,session:999})],returns:[]}});
    assert.equal(sessionFailure.statusCode,409,sessionFailure.body);
    assert.equal(sessionFailure.json().code,'SYNC_DEPENDENCY_MISSING');
    assert.equal(db.prepare('select count(*) n from sales').get().n,0);
    assert.equal(db.prepare("select value from sync_state where key='sales_cursor'").get(),undefined);
  }finally{if(app)await app.close();if(db)db.close();fs.rmSync(root,{recursive:true,force:true});}
});
