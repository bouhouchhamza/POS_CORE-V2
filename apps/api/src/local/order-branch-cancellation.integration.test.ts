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

test('business-wide cancellation attributes restored inventory and audit to the order branch',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corepos-cancel-branch-')),
    paths=ensureLocalPaths(resolveLocalPaths({BIMIK_DATA_DIR:root}));
  let db:any,app:any;
  try{
    const stamp=new Date().toISOString(),password=await bcrypt.hash('secret',4);
    db=openLocalDatabase(paths);
    db.prepare("insert into businesses(id,name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,created_at,updated_at) values(1,'Local','local','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?)").run(stamp,stamp);
    db.prepare("insert into branches(id,business_id,name,code,active,created_at,updated_at) values(1,1,'A','A',1,?,?),(2,1,'B','B',1,?,?)").run(stamp,stamp,stamp,stamp);
    db.prepare("insert into business_features(business_id,feature,created_at) values(1,'pos',?)").run(stamp);
    db.prepare("insert into users(id,business_id,branch_id,name,email,password,role,is_active,created_at,updated_at) values(1,1,1,'Owner A','owner@local.test',?,'owner',1,?,?)").run(password,stamp,stamp);
    const product=Number(db.prepare("insert into products(business_id,name,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,is_active,is_public,available,created_at,updated_at) values(1,'Stock',100,500,3,0,1,1,1,1,?,?)").run(stamp,stamp).lastInsertRowid);
    const order=Number(db.prepare("insert into orders(business_id,branch_id,client_id,order_number,source,type,user_id,status,subtotal_cents,discount_cents,tax_cents,total_cents,payment_status,sync_status,created_at,updated_at) values(1,2,?,'B-1','pos','retail',1,'pending',500,0,0,500,'unpaid','local',?,?)").run(crypto.randomUUID(),stamp,stamp).lastInsertRowid);
    db.prepare("insert into order_items(order_id,product_id,quantity,unit_price_cents,discount_cents,tax_cents,total_cents,created_at,updated_at) values(?,?,2,500,0,0,1000,?,?)").run(order,product,stamp,stamp);
    app=await buildLocalApp({paths,database:db});
    const login=await app.inject({method:'POST',url:'/api/login',payload:{email:'owner@local.test',password:'secret'}}),headers={authorization:`Bearer ${login.json().data.access_token}`};
    const cancelled=await app.inject({method:'PATCH',url:`/api/orders/${order}/status`,headers,payload:{status:'cancelled'}});
    assert.equal(cancelled.statusCode,200,cancelled.body);
    assert.equal(db.prepare('select stock from products where id=?').get(product).stock,5);
    const movement=db.prepare("select branch_id,user_id from stock_movements where type='order_cancel'").get();
    const audit=db.prepare("select branch_id,user_id from audit_logs where action='order.cancel'").get();
    assert.equal(movement.branch_id,2);
    assert.equal(movement.user_id,1);
    assert.equal(audit.branch_id,2);
    assert.equal(audit.user_id,1);
  }finally{if(app)await app.close();if(db)db.close();fs.rmSync(root,{recursive:true,force:true});}
});
