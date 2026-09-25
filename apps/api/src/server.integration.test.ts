import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import WebSocket from "ws";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl && /_test(?:\?|$)/.test(databaseUrl));
if (process.env.REQUIRE_POSTGRES_INTEGRATION === "true" && !enabled) {
  throw new Error("REQUIRE_POSTGRES_INTEGRATION=true requires TEST_DATABASE_URL ending in _test.");
}
if (enabled) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.CONTROL_PLANE_DATABASE_URL = databaseUrl;
  process.env.SAAS_TENANCY_MODE = 'shared';
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "integration-test-secret-at-least-32-characters";
  process.env.CORS_ORIGINS = "http://127.0.0.1:5173";
  process.env.UPLOAD_DIR = "../../uploads-test";
}

let app: Awaited<typeof import("./server.js")>["app"];
let pool: Awaited<typeof import("./db/index.js")>["pool"];

test.before(async () => {
  if (!enabled) return;
  ({ app } = await import("./server.js"));
  ({ pool } = await import("./db/index.js"));
  await app.ready();
  const actual=(await pool.query('select current_database() name')).rows[0].name;
  assert.ok(String(actual).endsWith('_test'),'Refusing cleanup outside a disposable test database');
});

test.beforeEach(async () => {
  if (!enabled) return;
  // This suite shares the disposable PostgreSQL database with the licensing
  // integration suites.  Start from the two control-plane/runtime roots, not
  // only POS tables: a licence device created by a preceding test can otherwise
  // be selected by tenant resolution and make an unrelated login hit its quota.
  // `license_plans` deliberately remains seeded by migrations.
  await pool.query("truncate license_customers, businesses, saas_tenants restart identity cascade");
  // Fresh migrations deliberately do not seed a commercial business. Tests
  // explicitly provision their own licensed tenant, just as production does.
  await pool.query(`insert into license_customers(id,name) values('00000000-0000-4000-8000-000000000001','API test customer') on conflict(id) do nothing`);
  await pool.query(`insert into vendor_businesses(id,customer_id,name,business_type,status) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','API test business','cafe','active') on conflict(id) do nothing`);
  await pool.query(`insert into licenses(id,customer_id,vendor_business_id,business_type,status,allowed_features,max_devices,expires_at) values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','cafe','active','["pos","inventory","tables","qr_menu","kitchen"]',1000,now()+interval '30 days') on conflict(id) do nothing`);
  await pool.query(`insert into businesses(id,name,slug,business_type,currency,locale,timezone,vendor_business_id) values(1,'API test business','api-test-business','cafe','MAD','fr-MA','Africa/Casablanca','00000000-0000-4000-8000-000000000002') on conflict(id) do nothing`);
  await pool.query(`insert into branches(id,business_id,name,code) values(1,1,'Test branch','MAIN') on conflict(id) do nothing`);
  await pool.query("select setval(pg_get_serial_sequence('branches','id'),greatest((select max(id) from branches),1))");
  await pool.query(`insert into business_features(business_id,feature) select 1,unnest(array['pos','inventory','tables','qr_menu','kitchen']) on conflict do nothing`);
  await pool.query("delete from businesses where slug='tenant-two-test'");
  await pool.query("select setval(pg_get_serial_sequence('businesses','id'),greatest((select max(id) from businesses),1))");
  const hash = await bcrypt.hash("1", 4);
  await pool.query("insert into users(name,email,password,role,is_active) values ('Patron','patron@test.local',$1,'patron',true),('Worker','worker@test.local',$1,'worker',true),('Unused','unused@test.local',$1,'worker',true)", [hash]);
  await pool.query("insert into cash_register_sessions(business_date,status,opened_by_user_id,opening_cash) values (current_date,'open',1,0)");
  await pool.query("insert into categories(name) values ('Café')");
  await pool.query("insert into products(category_id,name,purchase_price,sale_price,stock,min_stock) values (1,'Thé',0,5.00,10,2),(1,'Café',0,10.00,1,1)");
});

test.after(async () => {
  if (!enabled) return;
  await app.close();
  await pool.end();
});

async function login(email = "patron@test.local") {
  const response = await app.inject({ method: "POST", url: "/api/login", payload: { email, password: "1" } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ token: string }>().token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
type RealtimeTestDevice={installationId:string;publicKey:string;privateKey:crypto.KeyObject;certificateId:string};
function realtimeProof(device:RealtimeTestDevice){const nonce=crypto.randomUUID(),requested_at=new Date().toISOString(),raw={license_id:'00000000-0000-4000-8000-000000000003',certificate_id:device.certificateId,installation_id:device.installationId,device_public_key:device.publicKey,nonce,requested_at},payload=['desktop-sync-v1','realtime',raw.license_id,raw.certificate_id,raw.installation_id,raw.device_public_key,nonce,requested_at,...Array(12).fill('')].join('\n');return{...raw,device_proof:crypto.sign(null,Buffer.from(payload),device.privateKey).toString('base64url')}}
async function seedRealtimeDevice():Promise<RealtimeTestDevice>{const keys=crypto.generateKeyPairSync('ed25519'),device={installationId:crypto.randomUUID(),publicKey:JSON.stringify(keys.publicKey.export({format:'jwk'})),privateKey:keys.privateKey,certificateId:crypto.randomUUID()},deviceId=crypto.randomUUID(),fingerprint=crypto.createHash('sha256').update(device.publicKey).digest('hex');await pool.query("insert into license_devices(id,license_id,installation_id,device_public_key,device_fingerprint,channel,status) values($1,'00000000-0000-4000-8000-000000000003',$2,$3,$4,'desktop','active')",[deviceId,device.installationId,device.publicKey,fingerprint]);await pool.query("insert into license_activations(license_id,device_id,certificate_id,kind,status,request_nonce) values('00000000-0000-4000-8000-000000000003',$1,$2,'offline','approved',$3)",[deviceId,device.certificateId,crypto.randomUUID()]);return device}
function waitForRealtime(socket:any,predicate:(event:any)=>boolean){return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Timed out waiting for realtime event.'))},2_000),listener=(raw:Buffer)=>{const event=JSON.parse(raw.toString());if(!predicate(event))return;clearTimeout(timer);socket.off('message',listener);resolve(event)};socket.on('message',listener)})}
function multipart(fields: Record<string, string>, file?: { bytes: Buffer; mime: string; field?: string; filename?: string }) {
  const boundary = `----bimik-${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field ?? 'image'}"; filename="${file.filename ?? 'image.png'}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, Buffer.from("\r\n"));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
function pdfFixture(lines:string[]) { return new Promise<Buffer>((resolve,reject)=>{const document=new PDFDocument({margin:40}),chunks:Buffer[]=[];document.on('data',(chunk:Buffer)=>chunks.push(chunk));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);for(const line of lines)document.text(line);document.end()}) }
function pagedPdfFixture(pageCount:number,withText=true) { return new Promise<Buffer>((resolve,reject)=>{const document=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[];document.on('data',(chunk:Buffer)=>chunks.push(chunk));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);for(let page=1;page<=pageCount;page++){document.addPage();if(withText)document.text(`Page ${page}`)}document.end()}) }

test("menu PDF validation rejects MIME spoofing, fake, oversized, scanned and excessive pages", { skip: !enabled }, async()=>{
  const token=await login();
  async function status(bytes:Buffer,mime:string,filename:string){const form=multipart({}, {bytes,mime,field:'pdf',filename});return app.inject({method:'POST',url:'/api/menu-import/preview',headers:{...auth(token),...form.headers},payload:form.payload})}
  const missing=multipart({note:'aucun fichier'});const missingResponse=await app.inject({method:'POST',url:'/api/menu-import/preview',headers:{...auth(token),...missing.headers},payload:missing.payload});assert.equal(missingResponse.statusCode,422);assert.equal(missingResponse.json().message,'Sélectionnez un fichier PDF.');
  const unexpected=multipart({}, {bytes:Buffer.from('%PDF-fake'),mime:'application/pdf',field:'menu',filename:'menu.pdf'});const unexpectedResponse=await app.inject({method:'POST',url:'/api/menu-import/preview',headers:{...auth(token),...unexpected.headers},payload:unexpected.payload});assert.equal(unexpectedResponse.statusCode,422);assert.match(unexpectedResponse.json().message,/champ « pdf »/i);
  assert.equal((await status(Buffer.from('%PDF-fake'),'text/plain','menu.pdf')).statusCode,422);
  assert.equal((await status(Buffer.from('not pdf'),'application/pdf','menu.pdf')).statusCode,422);
  assert.equal((await status(Buffer.alloc(5*1024*1024+1),'application/pdf','menu.pdf')).statusCode,413);
  const scanned=await pagedPdfFixture(1,false),scannedResponse=await status(scanned,'application/pdf','scan.pdf');assert.equal(scannedResponse.statusCode,422);assert.equal(scannedResponse.json().code,'SCANNED_PDF');
  const excessive=await pagedPdfFixture(31),excessiveResponse=await status(excessive,'application/pdf','long.pdf');assert.equal(excessiveResponse.statusCode,422);assert.equal(excessiveResponse.json().code,'TOO_MANY_PAGES');
});

test("menu preview is Patron-only and confirmation is transactional and idempotent", { skip: !enabled }, async () => {
  const patronToken=await login(),workerToken=await login('worker@test.local'),pdf=await pdfFixture(['Boissons froides','Jus Orange 12,50 DH','Eau 5 DH']);
  const form=()=>multipart({}, {bytes:pdf,mime:'application/pdf',field:'pdf',filename:'menu.pdf'});
  const unauthorized=form();assert.equal((await app.inject({method:'POST',url:'/api/menu-import/preview',headers:unauthorized.headers,payload:unauthorized.payload})).statusCode,401);
  const worker=form();assert.equal((await app.inject({method:'POST',url:'/api/menu-import/preview',headers:{...auth(workerToken),...worker.headers},payload:worker.payload})).statusCode,403);
  const before=(await pool.query('select (select count(*) from categories)::int categories,(select count(*) from products)::int products')).rows[0];
  const request=form(),previewResponse=await app.inject({method:'POST',url:'/api/menu-import/preview',headers:{...auth(patronToken),...request.headers},payload:request.payload});assert.equal(previewResponse.statusCode,200,previewResponse.body);
  const preview=previewResponse.json().data;assert.equal(preview.categories[0].name,'Sans catégorie');assert.equal(preview.categories[0].products[0].sale_price,'12.50');assert.deepEqual((await pool.query('select (select count(*) from categories)::int categories,(select count(*) from products)::int products')).rows[0],before);
  assert.equal(preview.categories[0].products.every((product:any)=>product.track_stock===false),true);preview.categories[0].products[0].track_stock=true;preview.categories[0].products[0].initial_stock=3;
  const confirmed=await app.inject({method:'POST',url:'/api/menu-import/confirm',headers:auth(patronToken),payload:{session_id:preview.session_id,categories:preview.categories}});assert.equal(confirmed.statusCode,200,confirmed.body);assert.equal(confirmed.json().data.products.created,2);assert.deepEqual((await pool.query("select name,stock,track_stock from products where name='Jus Orange'")).rows[0],{name:'Jus Orange',stock:'3.000',track_stock:true});
  const replayed=await app.inject({method:'POST',url:'/api/menu-import/confirm',headers:auth(patronToken),payload:{session_id:preview.session_id,categories:preview.categories}});assert.equal(replayed.statusCode,200,replayed.body);assert.equal(replayed.json().data.replayed,true);assert.equal((await pool.query("select count(*)::int count from products where name in ('Jus Orange','Eau')")).rows[0].count,2);
});

test("explicit product update preserves stock and unexpected failure rolls back", { skip: !enabled }, async () => {
  const token=await login();
  const session=(await pool.query("insert into menu_import_sessions(id,user_id,preview) values(gen_random_uuid(),1,'{}') returning id")).rows[0].id;
  const product={client_id:crypto.randomUUID(),name:'Café',sale_price:'11.00',description:null,variant:null,currency:'MAD',requires_review:false,decision:'update_existing',existing_product_id:2,duplicate_kind:'exact'};
  const response=await app.inject({method:'POST',url:'/api/menu-import/confirm',headers:auth(token),payload:{session_id:session,categories:[{client_id:crypto.randomUUID(),name:'Café',decision:'use_existing',existing_category_id:1,duplicate_kind:'exact',products:[product]}]}});assert.equal(response.statusCode,200,response.body);assert.deepEqual((await pool.query('select sale_price,stock,track_stock from products where id=2')).rows[0],{sale_price:'11.00',stock:'1.000',track_stock:true});
  const failing=(await pool.query("insert into menu_import_sessions(id,user_id,preview) values(gen_random_uuid(),1,'{}') returning id")).rows[0].id;
  const bad={...product,client_id:crypto.randomUUID(),name:'Introuvable',existing_product_id:999};const failed=await app.inject({method:'POST',url:'/api/menu-import/confirm',headers:auth(token),payload:{session_id:failing,categories:[{client_id:crypto.randomUUID(),name:'Nouvelle avant échec',decision:'create',existing_category_id:null,duplicate_kind:'none',products:[bad]}]}});assert.equal(failed.statusCode,422,failed.body);assert.equal((await pool.query("select count(*)::int count from categories where name='Nouvelle avant échec'")).rows[0].count,0);
});

test("product tracking validates strict booleans, defaults safely, and toggles without changing stock", { skip: !enabled }, async()=>{
  const token=await login();
  const tracked=await app.inject({method:'POST',url:'/api/products',headers:auth(token),payload:{name:'Bouteille',sale_price:8,stock:7,min_stock:2,track_stock:true,is_active:true}});assert.equal(tracked.statusCode,201,tracked.body);assert.equal(tracked.json().data.track_stock,true);
  const untracked=await app.inject({method:'POST',url:'/api/products',headers:auth(token),payload:{name:'Espresso',sale_price:10,stock:4,min_stock:0,track_stock:false,is_active:true}});assert.equal(untracked.statusCode,201,untracked.body);assert.equal(untracked.json().data.track_stock,false);
  const invalid=await app.inject({method:'POST',url:'/api/products',headers:auth(token),payload:{name:'Invalide',sale_price:1,track_stock:'yes'}});assert.equal(invalid.statusCode,422);
  const id=untracked.json().data.id;await app.inject({method:'PUT',url:`/api/products/${id}`,headers:auth(token),payload:{name:'Espresso court'}});let row=(await pool.query('select stock,track_stock from products where id=$1',[id])).rows[0];assert.deepEqual(row,{stock:'4.000',track_stock:false});
  await app.inject({method:'PUT',url:`/api/products/${id}`,headers:auth(token),payload:{track_stock:true}});row=(await pool.query('select stock,track_stock from products where id=$1',[id])).rows[0];assert.deepEqual(row,{stock:'4.000',track_stock:true});
  await app.inject({method:'PUT',url:`/api/products/${id}`,headers:auth(token),payload:{track_stock:false}});row=(await pool.query('select stock,track_stock from products where id=$1',[id])).rows[0];assert.deepEqual(row,{stock:'4.000',track_stock:false});
});

test("untracked and mixed-cart sales mutate only tracked stock and rollback atomically", { skip: !enabled }, async()=>{
  const token=await login('worker@test.local');await pool.query('update products set track_stock=false,stock=0 where id=1');
  const untracked=await app.inject({method:'POST',url:'/api/sales',headers:auth(token),payload:{items:[{product_id:1,quantity:5}]}});assert.equal(untracked.statusCode,201,untracked.body);assert.equal((await pool.query('select stock from products where id=1')).rows[0].stock,'0.000');assert.equal((await pool.query("select count(*)::int count from stock_movements where product_id=1 and type='sale'")).rows[0].count,0);assert.equal(untracked.json().data.items[0].quantity,5);
  const mixed=await app.inject({method:'POST',url:'/api/sales',headers:auth(token),payload:{items:[{product_id:1,quantity:2},{product_id:2,quantity:1}]}});assert.equal(mixed.statusCode,201,mixed.body);assert.equal((await pool.query('select stock from products where id=2')).rows[0].stock,'0.000');assert.equal((await pool.query("select count(*)::int count from stock_movements where type='sale'")).rows[0].count,1);
  const before=(await pool.query('select (select count(*) from sales)::int sales,(select count(*) from sale_items)::int items')).rows[0];const failed=await app.inject({method:'POST',url:'/api/sales',headers:auth(token),payload:{items:[{product_id:1,quantity:1},{product_id:2,quantity:1}]}});assert.equal(failed.statusCode,422);assert.deepEqual((await pool.query('select (select count(*) from sales)::int sales,(select count(*) from sale_items)::int items')).rows[0],before);
  const low=await app.inject({method:'GET',url:'/api/products-low-stock',headers:auth(token)});assert.equal(low.statusCode,200);assert.equal(low.json().data.some((product:any)=>product.id===1),false);assert.equal(low.json().data.some((product:any)=>product.id===2),true);
  const patronToken=await login();const stockChange=await app.inject({method:'POST',url:'/api/products/1/stock/increase',headers:auth(patronToken),payload:{quantity:1}});assert.equal(stockChange.statusCode,422);assert.equal(stockChange.json().message,'Le suivi du stock est désactivé pour ce produit.');
  const report=await app.inject({method:'GET',url:'/api/reports/today',headers:auth(patronToken)});assert.equal(report.statusCode,200);assert.equal(report.json().total_products_sold,8);const dashboard=await app.inject({method:'GET',url:'/api/dashboard',headers:auth(patronToken)});assert.equal(dashboard.json().low_stock_count,1);
});

test("single shared cash register controls opening, sales, reporting and closing", {skip:!enabled},async()=>{
  const patron=await login(),worker=await login('worker@test.local');
  await pool.query("delete from cash_register_sessions");
  const emptyReport=await app.inject({method:'GET',url:'/api/reports/today',headers:auth(patron)});assert.equal(emptyReport.statusCode,200);assert.equal(emptyReport.json().session,null);assert.equal(emptyReport.json().total_orders,0);assert.deepEqual(emptyReport.json().commandes,[]);
  const blocked=await app.inject({method:'POST',url:'/api/sales',headers:auth(worker),payload:{items:[{product_id:1,quantity:1}]}});assert.equal(blocked.statusCode,422);assert.match(blocked.json().errors.items[0],/Ouvrez la caisse/);
  const negative=await app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(worker),payload:{opening_cash:'-1'}});assert.equal(negative.statusCode,422);
  const [first,second]=await Promise.all([
    app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(worker),payload:{opening_cash:'100.00',opening_note:'Matin'}}),
    app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(patron),payload:{opening_cash:'100.00'}}),
  ]);
  assert.deepEqual([first.statusCode,second.statusCode].sort(),[201,409]);
  const current=(first.statusCode===201?first:second).json().data;assert.equal(current.opening_cash,100);
  const sale1=await app.inject({method:'POST',url:'/api/sales',headers:auth(worker),payload:{payment_method:'cash',items:[{product_id:1,quantity:1}]}});assert.equal(sale1.statusCode,201,sale1.body);
  const sale2=await app.inject({method:'POST',url:'/api/sales',headers:auth(patron),payload:{payment_method:'card',items:[{product_id:1,quantity:1}]}});assert.equal(sale2.statusCode,201,sale2.body);
  assert.equal(sale1.json().data.cash_register_session_id,current.id);assert.equal(sale2.json().data.cash_register_session_id,current.id);
  assert.deepEqual((await pool.query('select distinct cash_register_session_id from sales')).rows,[{cash_register_session_id:current.id}]);
  await pool.query("update cash_register_sessions set business_date='2026-08-26',opened_at='2026-08-26 22:00:00+00' where id=$1",[current.id]);
  await pool.query("update sales set created_at=case id when $1 then '2026-08-26 23:59:00+00'::timestamptz else '2026-08-27 00:01:00+00'::timestamptz end",[sale1.json().data.id]);
  const provisional=await app.inject({method:'GET',url:'/api/cash-register/sessions/'+current.id+'/report',headers:auth(patron)});assert.equal(provisional.statusCode,200);assert.equal(provisional.json().period.date,'2026-08-26');assert.equal(provisional.json().total_orders,2);assert.equal(provisional.json().session.provisional,true);
  const workerReport=await app.inject({method:'GET',url:'/api/reports/today?worker_id=2',headers:auth(patron)});assert.equal(workerReport.statusCode,200);assert.equal(workerReport.json().session.id,current.id);assert.equal(workerReport.json().period.status,'open');assert.equal(workerReport.json().period.worker_name,'Worker');assert.equal(workerReport.json().total_orders,1);assert.equal(workerReport.json().commandes[0].user.name,'Worker');assert.equal(workerReport.json().commandes[0].payment_method,'cash');
  const closed=await app.inject({method:'POST',url:'/api/cash-register/close',headers:auth(worker),payload:{actual_cash:'106.00'}});assert.equal(closed.statusCode,200,closed.body);
  assert.equal(closed.json().data.expected_cash,105);assert.equal(closed.json().data.actual_cash,106);assert.equal(closed.json().data.difference,1);assert.equal(closed.json().data.closed_by.id,2);
  const finalReport=await app.inject({method:'GET',url:'/api/reports/today',headers:auth(patron)});assert.equal(finalReport.json().session.status,'closed');assert.equal(finalReport.json().session.provisional,false);assert.equal(finalReport.json().session.expected_cash,105);assert.equal(finalReport.json().session.actual_cash,106);assert.equal(finalReport.json().session.difference,1);assert.equal(finalReport.json().total_orders,2);
  assert.equal((await app.inject({method:'POST',url:'/api/cash-register/close',headers:auth(patron),payload:{actual_cash:'106'}})).statusCode,422);
  assert.equal((await app.inject({method:'POST',url:'/api/sales',headers:auth(worker),payload:{items:[{product_id:1,quantity:1}]}})).statusCode,422);
  const reopened=await app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(patron),payload:{opening_cash:'0'}});assert.equal(reopened.statusCode,201,reopened.body);assert.notEqual(reopened.json().data.id,current.id);
  await pool.query("update users set is_active=false where id=2");
  assert.equal((await app.inject({method:'POST',url:'/api/cash-register/close',headers:auth(worker),payload:{actual_cash:'0'}})).statusCode,401);
});

test('hosted cash open and close emit realtime invalidations only after successful changes',{skip:!enabled},async()=>{
  const patron=await login(),device=await seedRealtimeDevice(),address=await app.listen({host:'127.0.0.1',port:0}),socket=new WebSocket(`${address.replace(/^http/,'ws')}/api/desktop-sync/realtime`),events:any[]=[];await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});socket.on('message',(raw:any)=>events.push(JSON.parse(raw.toString())));
  try{
    const ready=waitForRealtime(socket,event=>event.type==='ready');socket.send(JSON.stringify({type:'authenticate',device:realtimeProof(device)}));await ready;
    await pool.query('delete from cash_register_sessions');
    let changed=waitForRealtime(socket,event=>event.type==='cash_register_changed');const opened=await app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(patron),payload:{opening_cash:10}});assert.equal(opened.statusCode,201,opened.body);assert.equal((await changed).type,'cash_register_changed');
    const beforeConflict=events.filter(event=>event.type==='cash_register_changed').length,conflict=await app.inject({method:'POST',url:'/api/cash-register/open',headers:auth(patron),payload:{opening_cash:20}});assert.equal(conflict.statusCode,409,conflict.body);await new Promise(resolve=>setImmediate(resolve));assert.equal(events.filter(event=>event.type==='cash_register_changed').length,beforeConflict);
    changed=waitForRealtime(socket,event=>event.type==='cash_register_changed');const closed=await app.inject({method:'POST',url:'/api/cash-register/close',headers:auth(patron),payload:{actual_cash:10}});assert.equal(closed.statusCode,200,closed.body);assert.equal((await changed).type,'cash_register_changed');
  }finally{socket.terminate()}
});

test("CORS preflight permits PUT and DELETE only for an allowed origin", { skip: !enabled }, async () => {
  for (const method of ["PUT", "DELETE"]) {
    const response = await app.inject({ method: "OPTIONS", url: "/api/users/2", headers: { origin: "http://127.0.0.1:5173", "access-control-request-method": method, "access-control-request-headers": "authorization,content-type" } });
    assert.equal(response.statusCode, 204);
    assert.match(response.headers["access-control-allow-methods"] ?? "", new RegExp(method));
  }
  const denied = await app.inject({ method: "OPTIONS", url: "/api/users/2", headers: { origin: "https://evil.example", "access-control-request-method": "DELETE" } });
  assert.equal(denied.statusCode, 403);
  assert.notEqual(denied.headers["access-control-allow-origin"], "https://evil.example");
});

test("capitalized role updates, nullable/omitted passwords, and activation preserve history", { skip: !enabled }, async () => {
  const token = await login();
  await pool.query("insert into sales(user_id,total,profit) values (2,5,5)");
  await pool.query("insert into stock_movements(product_id,user_id,type,quantity,before_stock,after_stock) values (1,2,'in',1,9,10)");
  const before = await pool.query("select password from users where id=2");
  const response = await app.inject({ method: "PUT", url: "/api/users/2", headers: auth(token), payload: { role: "  Worker  ", is_active: false, password: null } });
  assert.equal(response.statusCode, 200, response.body);
  const after = await pool.query("select password,is_active,role from users where id=2");
  assert.equal(after.rows[0].password, before.rows[0].password);
  assert.equal(after.rows[0].is_active, false);
  assert.equal(after.rows[0].role, "worker");
  assert.deepEqual((await pool.query("select (select count(*) from sales where user_id=2)::int sales,(select count(*) from stock_movements where user_id=2)::int movements")).rows[0], { sales: 1, movements: 1 });
  assert.equal((await app.inject({ method: "POST", url: "/api/login", payload: { email: "worker@test.local", password: "1" } })).statusCode, 422);
  const activated = await app.inject({ method: "PUT", url: "/api/users/2", headers: auth(token), payload: { role: "Worker", is_active: true } });
  assert.equal(activated.statusCode, 200, activated.body);
  const active = await pool.query("select password,is_active,role from users where id=2");
  assert.equal(active.rows[0].password, before.rows[0].password);
  assert.equal(active.rows[0].is_active, true);
  assert.equal(active.rows[0].role, "worker");
  assert.equal((await app.inject({ method: "POST", url: "/api/login", payload: { email: "worker@test.local", password: "1" } })).statusCode, 200);
  const invalid = await app.inject({ method: "PUT", url: "/api/users/2", headers: auth(token), payload: { role: "unrecognized_role" } });
  assert.equal(invalid.statusCode, 422);
  assert.ok(invalid.json().errors.role.length > 0);
});

test("user deletion enforces current, historical, and last-patron constraints", { skip: !enabled }, async (t) => {
  const token = await login();
  await t.test("unused Worker", async () => assert.equal((await app.inject({ method: "DELETE", url: "/api/users/3", headers: auth(token) })).statusCode, 200));
  await t.test("current user", async () => assert.equal((await app.inject({ method: "DELETE", url: "/api/users/1", headers: auth(token) })).statusCode, 422));
  await t.test("Worker with sales", async () => { await pool.query("insert into sales(user_id,total,profit) values (2,1,1)"); assert.equal((await app.inject({ method: "DELETE", url: "/api/users/2", headers: auth(token) })).statusCode, 422); await pool.query("delete from sales where user_id=2"); });
  await t.test("Worker with stock movements", async () => { await pool.query("insert into stock_movements(product_id,user_id,type,quantity,before_stock,after_stock) values (1,2,'in',1,9,10)"); assert.equal((await app.inject({ method: "DELETE", url: "/api/users/2", headers: auth(token) })).statusCode, 422); });
  await t.test("last active Patron cannot be deactivated", async () => { const response = await app.inject({ method: "PUT", url: "/api/users/1", headers: auth(token), payload: { role: " Patron ", is_active: false, password: null } }); assert.equal(response.statusCode, 422); });
});

test("sales group duplicates, snapshot price, update stock atomically, and roll back failures", { skip: !enabled }, async () => {
  const token = await login("worker@test.local");
  const created = await app.inject({ method: "POST", url: "/api/sales", headers: auth(token), payload: { items: [{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }] } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().data.total, 15);
  assert.equal(created.json().data.items[0].quantity, 3);
  assert.equal(created.json().data.items[0].unit_price, 5);
  assert.equal((await pool.query("select stock from products where id=1")).rows[0].stock, '7.000');
  const before = await pool.query("select (select count(*) from sales) sales,(select count(*) from stock_movements) movements");
  const failed = await app.inject({ method: "POST", url: "/api/sales", headers: auth(token), payload: { items: [{ product_id: 1, quantity: 1 }, { product_id: 999, quantity: 1 }] } });
  assert.equal(failed.statusCode, 422);
  const after = await pool.query("select (select count(*) from sales) sales,(select count(*) from stock_movements) movements");
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("dashboard and stock resources match React/Laravel field contracts", { skip: !enabled }, async () => {
  const patronToken = await login();
  const workerToken = await login("worker@test.local");
  const denied = await app.inject({ method: "POST", url: "/api/products/1/stock/decrease", headers: auth(workerToken), payload: { quantity: 2, note: "service" } });
  assert.equal(denied.statusCode, 403, denied.body);
  await pool.query("update users set role='stock_manager',business_id=1,branch_id=1 where email='worker@test.local'");
  const stockManagerToken = await login("worker@test.local");
  const changed = await app.inject({ method: "POST", url: "/api/products/1/stock/decrease", headers: auth(stockManagerToken), payload: { quantity: 2, note: "service" } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().product.stock, 8);
  assert.equal(changed.json().movement.before_stock, 10);
  assert.equal(changed.json().movement.after_stock, 8);
  assert.equal(changed.json().movement.user.name, "Worker");
  const movements = (await app.inject({ method: "GET", url: "/api/stock-movements", headers: auth(patronToken) })).json().data;
  assert.deepEqual(Object.keys(movements[0]).sort(), ["after_stock","before_stock","created_at","id","note","product","product_id","quantity","type","updated_at","user","user_id"].sort());
  const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard", headers: auth(patronToken) })).json();
  assert.deepEqual(Object.keys(dashboard).sort(), ["low_stock_count","low_stock_products","today_sales","today_tickets"].sort());
  assert.equal(dashboard.low_stock_count, 1);
});

test("daily and monthly reports preserve Laravel response shape and worker aggregation", { skip: !enabled }, async () => {
  const token = await login();
  await pool.query("insert into sales(user_id,cash_register_session_id,total,profit,created_at) values (2,1,15,15,now()) returning id");
  await pool.query("insert into sale_items(sale_id,product_id,quantity,unit_price,purchase_price,total,profit) values (1,1,3,5,0,15,15)");
  const daily = await app.inject({ method: "GET", url: "/api/reports/today?worker_id=2", headers: auth(token) });
  assert.equal(daily.statusCode, 200, daily.body);
  const body = daily.json();
  assert.deepEqual(Object.keys(body).sort(), ["best_products","commandes","period","session","total_orders","total_products_sold","total_sales"].sort());
  assert.equal(body.period.worker_name, "Worker");
  assert.equal(body.total_sales, 15);
  assert.equal(body.total_products_sold, 3);
  assert.equal(body.best_products[0].quantity, 3);
  const empty = await app.inject({ method: "GET", url: "/api/reports/monthly?month=2000-01", headers: auth(token) });
  assert.equal(empty.json().total_orders, 0);
  assert.deepEqual(empty.json().commandes, []);
});

test("remembered business context is signed, tenant scoped, survives logout, and can be forgotten", { skip: !enabled }, async () => {
  const freshContext = await app.inject({ method: "GET", url: "/api/auth/login-context" });
  assert.equal(freshContext.statusCode, 200);
  assert.deepEqual(freshContext.json().data, {
    mode: "cloud",
    profile_picker: false,
    requires_workspace: false,
    business: null,
  });
  assert.equal((await app.inject({ method: "GET", url: "/api/login-profiles" })).statusCode, 404);

  const hash = await bcrypt.hash("1", 4);
  const tenant = await pool.query(
    "insert into businesses(name,slug,business_type,currency,locale,timezone,tax_settings,receipt_settings) values ('Tenant Two','tenant-two-test','cafe','MAD','fr-MA','Africa/Casablanca','{}'::jsonb,'{}'::jsonb) returning id",
  );
  const tenantBusinessId = Number(tenant.rows[0].id);
  await pool.query(
    "insert into users(business_id,name,email,password,role,is_active) values ($1,'Tenant Two Patron','tenant-two@test.local',$2,'patron',true)",
    [tenantBusinessId, hash],
  );

  const loggedIn = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email: "patron@test.local", password: "1" },
  });
  assert.equal(loggedIn.statusCode, 200, loggedIn.body);

  const setCookies = Array.isArray(loggedIn.headers["set-cookie"])
    ? loggedIn.headers["set-cookie"]
    : [String(loggedIn.headers["set-cookie"] ?? "")];
  const rememberedCookie = setCookies
    .find((value) => value.startsWith("bimik_business_context="))
    ?.split(";")[0];
  const refreshCookie = setCookies
    .find((value) => value.startsWith("bimik_refresh="))
    ?.split(";")[0];
  assert.ok(rememberedCookie, "remembered-business cookie missing");
  assert.ok(refreshCookie, "refresh cookie missing");

  const rememberedContext = await app.inject({
    method: "GET",
    url: "/api/auth/login-context",
    headers: { cookie: rememberedCookie },
  });
  assert.equal(rememberedContext.statusCode, 200);
  assert.equal(rememberedContext.json().data.mode, "cloud");
  assert.equal(rememberedContext.json().data.profile_picker, true);
  assert.equal(rememberedContext.json().data.business.id, 1);

  const profiles = await app.inject({
    method: "GET",
    url: "/api/login-profiles",
    headers: { cookie: rememberedCookie },
  });
  assert.equal(profiles.statusCode, 200, profiles.body);
  assert.equal(profiles.json().data.length, 3);
  assert.equal(profiles.json().data.every((profile: any) => profile.business_id === 1), true);
  assert.equal(profiles.json().data.some((profile: any) => profile.email === "tenant-two@test.local"), false);

  const last = rememberedCookie.slice(-1);
  const tamperedCookie = rememberedCookie.slice(0, -1) + (last === "a" ? "b" : "a");
  assert.equal((await app.inject({
    method: "GET",
    url: "/api/login-profiles",
    headers: { cookie: tamperedCookie },
  })).statusCode, 404);

  const loggedOut = await app.inject({
    method: "POST",
    url: "/api/logout",
    headers: { cookie: `${refreshCookie}; ${rememberedCookie}` },
  });
  assert.equal(loggedOut.statusCode, 200);

  const afterLogout = await app.inject({
    method: "GET",
    url: "/api/auth/login-context",
    headers: { cookie: rememberedCookie },
  });
  assert.equal(afterLogout.statusCode, 200);
  assert.equal(afterLogout.json().data.profile_picker, true);
  assert.equal(afterLogout.json().data.business.id, 1);

  const forgot = await app.inject({
    method: "POST",
    url: "/api/auth/business-context/forget",
    headers: { cookie: rememberedCookie },
  });
  assert.equal(forgot.statusCode, 200);
  assert.match(String(forgot.headers["set-cookie"] ?? ""), /bimik_business_context=/);
});

test("opaque table QR is public, tenant scoped, filters private products, and prices orders server-side", { skip: !enabled }, async () => {
  const token = await login();
  const room = await app.inject({
    method: 'POST',
    url: '/api/rooms',
    headers: auth(token),
    payload: { name: 'Terrasse', sort_order: 0, active: true },
  });
  assert.equal(room.statusCode, 201, room.body);
  const table = await app.inject({
    method: 'POST',
    url: '/api/tables',
    headers: auth(token),
    payload: { room_id: room.json().data.id, table_number: 'T-1', name: 'Table 1', capacity: 4, status: 'available', active: true },
  });
  assert.equal(table.statusCode, 201, table.body);
  const qrToken = table.json().data.qr_token as string;
  assert.ok(qrToken.length >= 32);

  await pool.query("update categories set is_public=true where id=1");
  await pool.query("update products set is_public=true,is_active=true,available=true where id=1");
  await pool.query("update products set is_public=false,is_active=true,available=true where id=2");

  const menu = await app.inject({ method: 'GET', url: `/api/public/menu/table/${qrToken}` });
  assert.equal(menu.statusCode, 200, menu.body);
  assert.equal(menu.json().data.table.id, table.json().data.id);
  assert.deepEqual(menu.json().data.products.map((product: any) => product.id), [1]);
  assert.equal('purchase_price' in menu.json().data.products[0], false);
  assert.equal((await app.inject({ method: 'GET', url: `/api/public/menu/table/${'x'.repeat(43)}` })).statusCode, 404);

  const injected = await app.inject({
    method: 'POST',
    url: `/api/public/menu/table/${qrToken}/orders`,
    payload: { client_id: crypto.randomUUID(), tenantId: 'attacker', table_id: 999, discount: 100, tax: 100, items: [{ product_id: 1, quantity: 1, unit_price: 0 }] },
  });
  assert.equal(injected.statusCode, 422, injected.body);

  const created = await app.inject({
    method: 'POST',
    url: `/api/public/menu/table/${qrToken}/orders`,
    payload: { client_id: crypto.randomUUID(), tenantId: 'attacker', table_id: 999, items: [{ product_id: 1, quantity: 2 }] },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().data.business_id, 1);
  assert.equal(created.json().data.table_id, table.json().data.id);
  assert.equal(created.json().data.items[0].unit_price, 5);
  assert.equal(created.json().data.total, 10);
});

test("refresh tokens rotate, logout revokes them, and missing cookies return 401", { skip: !enabled }, async () => {
  const loggedIn = await app.inject({ method: "POST", url: "/api/login", payload: { email: "patron@test.local", password: "1" } });
  const firstCookie = cookieByName(loggedIn.headers["set-cookie"], "bimik_refresh");
  const deviceCookie = cookieByName(loggedIn.headers["set-cookie"], "bimik_session_device");
  const refreshed = await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: `${firstCookie}; ${deviceCookie}` } });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: firstCookie } })).statusCode, 401);
  const secondCookie = cookieByName(refreshed.headers["set-cookie"], "bimik_refresh");
  assert.equal((await app.inject({ method: "POST", url: "/api/logout", headers: { cookie: secondCookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: secondCookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/refresh" })).statusCode, 401);
});

test("multipart category images validate MIME/content and replace files after DB success", { skip: !enabled }, async () => {
  const token = await login();
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const first = multipart({ name: "Boissons" }, { bytes: png, mime: "image/png" });
  const created = await app.inject({ method: "POST", url: "/api/categories", headers: { ...auth(token), ...first.headers }, payload: first.payload });
  assert.equal(created.statusCode, 201, created.body);
  const oldUrl = created.json().data.image_url as string;
  assert.match(oldUrl, /^\/uploads\/categories\/[0-9a-f-]+\.png$/);
  assert.equal((await app.inject({ method: "GET", url: oldUrl })).statusCode, 200);
  const second = multipart({ name: "Boissons chaudes" }, { bytes: png, mime: "image/png" });
  const updated = await app.inject({ method: "POST", url: `/api/categories/${created.json().data.id}?_method=PUT`, headers: { ...auth(token), ...second.headers }, payload: second.payload });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.notEqual(updated.json().data.image_url, oldUrl);
  assert.equal((await app.inject({ method: "GET", url: oldUrl })).statusCode, 404);
  const invalid = multipart({ name: "Bad" }, { bytes: Buffer.from("not an image"), mime: "text/plain" });
  assert.equal((await app.inject({ method: "POST", url: "/api/categories", headers: { ...auth(token), ...invalid.headers }, payload: invalid.payload })).statusCode, 422);
  const productForm = multipart({ category_id: "1", name: "Jus", sale_price: "7.50", stock: "3", min_stock: "1", is_active: "1" }, { bytes: png, mime: "image/png" });
  const product = await app.inject({ method: "POST", url: "/api/products", headers: { ...auth(token), ...productForm.headers }, payload: productForm.payload });
  assert.equal(product.statusCode, 201, product.body);
  assert.equal(product.json().data.sale_price, 7.5);
  const oversizedBytes = Buffer.alloc(5 * 1024 * 1024 + 1);
  png.copy(oversizedBytes);
  const oversized = multipart({ name: "Too large" }, { bytes: oversizedBytes, mime: "image/png" });
  assert.equal((await app.inject({ method: "POST", url: "/api/categories", headers: { ...auth(token), ...oversized.headers }, payload: oversized.payload })).statusCode, 413);
});

test("settings cast booleans/numbers and Wi-Fi update remains scoped", { skip: !enabled }, async () => {
  const patronToken = await login();
  const workerToken = await login("worker@test.local");
  await pool.query("insert into settings(key,value) values ('ticket_width','58'),('show_wifi_on_ticket','0'),('wifi_name','Bimik')");
  const current = (await app.inject({ method: "GET", url: "/api/settings", headers: auth(patronToken) })).json();
  assert.equal(current.ticket_width, 58);
  assert.equal(current.show_wifi_on_ticket, false);
  assert.equal((await app.inject({ method: "GET", url: "/api/settings", headers: auth(workerToken) })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/settings/public", headers: auth(workerToken) })).statusCode, 200);
  const wifi = await app.inject({ method: "PUT", url: "/api/settings/wifi", headers: auth(patronToken), payload: { wifi_name: "Cafe WiFi", wifi_code: "123" } });
  assert.equal(wifi.statusCode, 200, wifi.body);
  assert.deepEqual(wifi.json(), { wifi_name: "Cafe WiFi", wifi_code: "123" });
});

test("Core V2 branch guards keep kitchen mutation scoped and pay cross-branch orders with the order branch", { skip: !enabled }, async () => {
  const ownerToken = await login();
  const hash = await bcrypt.hash("1", 4);
  await pool.query("update users set business_id=1,branch_id=1 where id=1");
  const branchB = (await pool.query("insert into branches(business_id,name,code) values(1,'Branch B','BRANCH_B') returning id")).rows[0];
  const kitchenA = (await pool.query("insert into users(business_id,branch_id,name,email,password,role,is_active) values(1,1,'Kitchen A','kitchen-a@test.local',$1,'kitchen',true) returning id", [hash])).rows[0];
  const kitchenB = (await pool.query("insert into users(business_id,branch_id,name,email,password,role,is_active) values(1,$1,'Kitchen B','kitchen-b@test.local',$2,'kitchen',true) returning id", [branchB.id, hash])).rows[0];
  const kitchenOrder = (await pool.query("insert into orders(business_id,branch_id,client_id,order_number,source,type,user_id,status,subtotal,discount,tax,total,payment_status,sync_status) values(1,$1,$2,'KITCHEN-B','pos','dine_in',1,'pending',5,0,0,5,'unpaid','synced') returning id", [branchB.id, crypto.randomUUID()])).rows[0];
  const kitchenItem = (await pool.query("insert into order_items(order_id,product_id,quantity,unit_price,discount,tax,total,preparation_status) values($1,1,1,5,0,0,5,'pending') returning id", [kitchenOrder.id])).rows[0];
  const sameBranch = await app.inject({ method: "PATCH", url: `/api/kitchen/items/${kitchenItem.id}`, headers: auth(await login("kitchen-b@test.local")), payload: { status: "preparing" } });
  assert.equal(sameBranch.statusCode, 200, sameBranch.body);
  const otherBranch = await app.inject({ method: "PATCH", url: `/api/kitchen/items/${kitchenItem.id}`, headers: auth(await login("kitchen-a@test.local")), payload: { status: "ready" } });
  assert.equal(otherBranch.statusCode, 404, otherBranch.body);
  assert.ok(kitchenA.id && kitchenB.id);

  const sessionB = (await pool.query("insert into cash_register_sessions(business_id,branch_id,business_date,status,opened_by_user_id,opening_cash) values(1,$1,current_date,'open',1,0) returning id", [branchB.id])).rows[0];
  const payable = (await pool.query("insert into orders(business_id,branch_id,client_id,order_number,source,type,user_id,status,subtotal,discount,tax,total,payment_status,sync_status) values(1,$1,$2,'PAY-B','pos','retail',1,'pending',12,0,0,12,'unpaid','synced') returning id", [branchB.id, crypto.randomUUID()])).rows[0];
  await pool.query("insert into order_items(order_id,product_id,quantity,unit_price,discount,tax,total) values($1,1,1,12,0,0,12)", [payable.id]);
  const paid = await app.inject({ method: "POST", url: `/api/orders/${payable.id}/pay`, headers: auth(ownerToken), payload: { payment_method: "cash" } });
  assert.equal(paid.statusCode, 200, paid.body);
  assert.deepEqual((await pool.query("select branch_id,user_id,cash_register_session_id from sales where order_id=$1", [payable.id])).rows[0], { branch_id: branchB.id, user_id: 1, cash_register_session_id: sessionB.id });

  const productB = (await pool.query("insert into products(business_id,category_id,name,purchase_price,sale_price,stock,min_stock) values(1,1,'Variant B',0,2,10,0) returning id")).rows[0];
  const variantB = (await pool.query("insert into product_variants(business_id,product_id,name,active) values(1,$1,'Only B',true) returning id", [productB.id])).rows[0];
  const invalidVariant = await app.inject({ method: "POST", url: "/api/orders", headers: auth(ownerToken), payload: { client_id: crypto.randomUUID(), source: "pos", type: "retail", discount: 0, tax: 0, payment_status: "unpaid", items: [{ product_id: 1, variant_id: variantB.id, quantity: 1, modifier_ids: [], discount: 0, tax: 0 }] } });
  assert.equal(invalidVariant.statusCode, 422, invalidVariant.body);
});

test("cash and card refunds net revenue while only cash refunds change the drawer", { skip: !enabled }, async () => {
  const ownerToken = await login();
  await pool.query("delete from cash_register_sessions");
  await pool.query("update users set business_id=1,branch_id=1 where id=1; update products set sale_price=100,stock=10,track_stock=true where id=1");
  const opened = await app.inject({ method: "POST", url: "/api/cash-register/open", headers: auth(ownerToken), payload: { opening_cash: 0 } });
  assert.equal(opened.statusCode, 201, opened.body);
  const cashSale = await app.inject({ method: "POST", url: "/api/sales", headers: auth(ownerToken), payload: { payment_method: "cash", items: [{ product_id: 1, quantity: 1 }] } });
  assert.equal(cashSale.statusCode, 201, cashSale.body);
  const cashReturn = await app.inject({ method: "POST", url: `/api/sales/${cashSale.json().data.id}/returns`, headers: auth(ownerToken), payload: { reason: "Cash refund", refund_method: "cash", items: [{ sale_item_id: cashSale.json().data.items[0].id, quantity: 1 }] } });
  assert.equal(cashReturn.statusCode, 201, cashReturn.body);
  let current = (await app.inject({ method: "GET", url: "/api/cash-register/current", headers: auth(ownerToken) })).json().data;
  assert.equal(current.sales_total, 0);
  assert.equal(current.expected_cash, 0);
  const cardSale = await app.inject({ method: "POST", url: "/api/sales", headers: auth(ownerToken), payload: { payment_method: "card", items: [{ product_id: 1, quantity: 1 }] } });
  assert.equal(cardSale.statusCode, 201, cardSale.body);
  const cardReturn = await app.inject({ method: "POST", url: `/api/sales/${cardSale.json().data.id}/returns`, headers: auth(ownerToken), payload: { reason: "Card refund", refund_method: "card", items: [{ sale_item_id: cardSale.json().data.items[0].id, quantity: 1 }] } });
  assert.equal(cardReturn.statusCode, 201, cardReturn.body);
  current = (await app.inject({ method: "GET", url: "/api/cash-register/current", headers: auth(ownerToken) })).json().data;
  assert.equal(current.sales_total, 0);
  assert.equal(current.expected_cash, 0);
});

test("monthly reports attribute refunds to the refund date", { skip: !enabled }, async () => {
  const ownerToken = await login();
  await pool.query("update users set business_id=1,branch_id=1 where id=1");
  const sale = (await pool.query("insert into sales(business_id,branch_id,user_id,payment_method,total,profit,created_at,updated_at) values(1,1,1,'card',100,100,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z') returning id")).rows[0];
  await pool.query("insert into sale_returns(business_id,branch_id,sale_id,user_id,reason,refund_method,total,created_at,sync_updated_at) values(1,1,$1,1,'Later refund','card',100,'2026-09-02T12:00:00Z','2026-09-02T12:00:00Z')", [sale.id]);
  const dayOneMonth = await app.inject({ method: "GET", url: "/api/reports/monthly?month=2026-08", headers: auth(ownerToken) });
  const refundMonth = await app.inject({ method: "GET", url: "/api/reports/monthly?month=2026-09", headers: auth(ownerToken) });
  assert.equal(dayOneMonth.statusCode, 200, dayOneMonth.body);
  assert.equal(refundMonth.statusCode, 200, refundMonth.body);
  assert.equal(dayOneMonth.json().total_sales, 100);
  assert.equal(refundMonth.json().total_sales, -100);
});

function cookieByName(value:string|string[]|undefined,name:string){const cookie=(Array.isArray(value)?value:[value??""]).find(item=>item.startsWith(`${name}=`))?.split(";")[0];assert.ok(cookie,`${name} cookie missing`);return cookie}
