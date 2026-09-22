import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { openLocalDatabase } from "./database.js";
import { ensureLocalPaths, resolveLocalPaths } from "./paths.js";
import { buildLocalApp } from "./server.js";
import { fingerprint, signCertificate, type LicenseCertificateV2 } from "../license/crypto.js";

const fixtureVendorKeys=crypto.generateKeyPairSync('ed25519');
const fixtureSigningKey=fixtureVendorKeys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
process.env.LICENSE_SIGNING_PUBLIC_KEY=fixtureVendorKeys.publicKey.export({type:'spki',format:'pem'}).toString();

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-offline-api-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const db = openLocalDatabase(paths);
  const timestamp = new Date().toISOString();
  const password = await bcrypt.hash("1", 4);
  db.prepare("INSERT INTO users(name,email,password,role,is_active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run("Patron Test", "patron@test.invalid", password, "patron", timestamp, timestamp);
  db.prepare("INSERT INTO users(name,email,password,role,is_active,created_at,updated_at) VALUES(?,?,?,?,0,?,?)").run("Inactif", "off@test.invalid", password, "worker", timestamp, timestamp);
  db.prepare("INSERT INTO categories(name,created_at,updated_at) VALUES(?,?,?)").run("Test", timestamp, timestamp);
  db.prepare("INSERT INTO products(category_id,name,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,is_active,created_at,updated_at) VALUES(1,'Eau',300,500,2,1,1,1,?,?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO products(category_id,name,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,is_active,created_at,updated_at) VALUES(1,'Espresso',200,1000,0,0,0,1,?,?)").run(timestamp, timestamp);
  const fixtureVendorBusinessId =
    crypto.randomUUID();

  const fixtureBusinessType = String(
    db.prepare(
      "SELECT business_type FROM businesses WHERE id=1"
    ).get()?.business_type ?? "cafe"
  );

  const fixtureCertificate: LicenseCertificateV2 = {
    version: 2,
    certificate_id: crypto.randomUUID(),
    license_id: crypto.randomUUID(),
    customer_id: crypto.randomUUID(),
    vendor_business_id:
      fixtureVendorBusinessId,
    business_id: null,
    business_type: fixtureBusinessType,
    plan: "business",
    features: [
      "pos",
      "inventory",
      "barcode",
      "suppliers",
      "purchases",
      "customers",
      "tables",
      "qr_menu",
      "kitchen",
      "takeaway",
      "delivery",
      "reservations",
      "product_variants",
      "modifiers",
      "weighted_products",
      "expiry_tracking"
    ],
    installation_id: crypto.randomUUID(),
    device_fingerprint: "a".repeat(64),
    issued_at: timestamp,
    expires_at:
      new Date(
        Date.now() + 86_400_000
      ).toISOString(),
    offline_validity_days: 30
  };

  const fixtureOfflineUntil =
    new Date(
      Date.parse(timestamp) +
        30 * 86_400_000
    ).toISOString();

  db.prepare(
    "UPDATE businesses SET vendor_business_id=? WHERE id=1"
  ).run(
    fixtureVendorBusinessId
  );

  db.prepare(
    "UPDATE merchant_license_state SET status='active',license_id=?,customer_id=?,vendor_business_id=?,business_type=?,allowed_features_json=?,certificate_id=?,certificate_version=2,certificate_json=?,device_fingerprint=?,device_status='active',reason_code=NULL,expires_at=?,offline_valid_until=?,last_validated_at=?,updated_at=? WHERE id=1"
  ).run(
    fixtureCertificate.license_id,
    fixtureCertificate.customer_id,
    fixtureCertificate.vendor_business_id,
    fixtureCertificate.business_type,
    JSON.stringify(
      fixtureCertificate.features
    ),
    fixtureCertificate.certificate_id,
    JSON.stringify(
      fixtureCertificate
    ),
    fixtureCertificate.device_fingerprint,
    fixtureCertificate.expires_at,
    fixtureOfflineUntil,
    timestamp,
    timestamp
  );
  db.prepare('UPDATE merchant_license_state SET certificate_signature=? WHERE id=1').run(signCertificate(fixtureCertificate,fixtureSigningKey));
  const app = await buildLocalApp({ paths, database: db });
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { email: "patron@test.invalid", password: "1" } });
  const token = login.json().data.access_token as string;
  const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
  return { root, paths, db, app, token, cookie, auth: { authorization: `Bearer ${token}` } };
}

test('cash register remains locally operational while hosted sync is unavailable and retains a durable outbox', async () => {
  const context=await fixture();
  try {
    const stamp=new Date().toISOString();
    context.db.prepare("insert into businesses(name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values('Offline first','offline-first','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?,?)").run(crypto.randomUUID(),stamp,stamp);
    const businessId=Number(context.db.prepare('select id from businesses').get()?.id);
    context.db.prepare("insert into branches(business_id,name,code,active,created_at,updated_at) values(?,'Main','MAIN',1,?,?)").run(businessId,stamp,stamp);
    context.db.prepare('update users set business_id=?,branch_id=1 where id=1').run(businessId);
    const opened=await context.app.inject({method:'POST',url:'/api/cash-register/open',headers:context.auth,payload:{opening_cash:20,opening_note:'Offline'}});
    assert.equal(opened.statusCode,200,opened.body);
    assert.equal((await context.app.inject({method:'GET',url:'/api/cash-register/current',headers:context.auth})).json().data.status,'open');
    const outbox=(await context.app.inject({method:'GET',url:'/api/sync/outbox',headers:context.auth})).json().data;
    assert.equal(outbox.length,1);assert.equal(outbox[0].payload.operation,'open');assert.equal(outbox[0].sync_status,'pending');
    // Closing before reconnect remains a local operation.  Once the hosted
    // open is acknowledged its server id is durably attached to the queued
    // close, rather than turning a legitimate offline sequence into conflict.
    const closed=await context.app.inject({method:'POST',url:'/api/cash-register/close',headers:context.auth,payload:{actual_cash:20}});
    assert.equal(closed.statusCode,200,closed.body);
    const localSessionId=opened.json().data.id;
    const openMutation=outbox[0];
    const acknowledged=await context.app.inject({method:'POST',url:'/api/sync/cash-register/ack',headers:context.auth,payload:{client_id:openMutation.client_id,local_session_id:localSessionId,server_session_id:901}});
    assert.equal(acknowledged.statusCode,200,acknowledged.body);
    const queuedClose=(await context.app.inject({method:'GET',url:'/api/sync/outbox',headers:context.auth})).json().data.find((mutation:any)=>mutation.payload.operation==='close');
    assert.equal(queuedClose.payload.server_session_id,901);
    assert.equal((await context.app.inject({method:'GET',url:'/api/cash-register/sessions',headers:context.auth})).json().data[0].status,'closed');
    // A later hosted pull is applied without replacing the local pending
    // record. This is the reconciliation boundary, not an online dependency.
    const applied=await context.app.inject({method:'POST',url:'/api/sync/cash-register/apply',headers:context.auth,payload:{cursor:new Date().toISOString(),sessions:[{id:900,branch_code:'MAIN',business_date:'2026-09-22',status:'closed',opened_at:stamp,opening_cash:10,opening_note:null,closed_at:stamp,actual_cash:10,closing_note:null,updated_at:stamp}]}});
    assert.equal(applied.statusCode,200,applied.body);
    assert.equal(Number(context.db.prepare('select count(*) n from cash_register_sessions').get()?.n),2);
    assert.equal(Number(context.db.prepare("select count(*) n from sync_mutations where sync_status='pending'").get()?.n),1);
  } finally {await context.app.close();context.db.close();fs.rmSync(context.root,{recursive:true,force:true})}
});

test('cash sync apply is monotonic and never feeds remotely applied state into the local outbox', async () => {
  const context=await fixture();
  try {
    const openedAt='2026-09-22T10:00:00.000Z',closedAt='2026-09-22T10:01:00.000Z';
    const stamp=new Date().toISOString(),vendorBusinessId=crypto.randomUUID();
    const result=context.db.prepare("insert into businesses(name,slug,business_type,currency,locale,timezone,tax_settings_json,receipt_settings_json,vendor_business_id,created_at,updated_at) values('Sync','sync-monotonic','cafe','MAD','fr-MA','Africa/Casablanca','{}','{}',?,?,?)").run(vendorBusinessId,stamp,stamp);
    const businessId=Number(result.lastInsertRowid),branchId=Number(context.db.prepare("insert into branches(business_id,name,code,active,created_at,updated_at) values(?,'Main','MAIN',1,?,?)").run(businessId,stamp,stamp).lastInsertRowid);
    context.db.prepare('update users set business_id=?,branch_id=? where id=1').run(businessId,branchId);
    const remoteOpen={id:44,branch_code:'MAIN',business_date:'2026-09-22',status:'open',opened_at:openedAt,opening_cash:10,opening_note:null,closed_at:null,actual_cash:null,closing_note:null,updated_at:openedAt};
    const first=await context.app.inject({method:'POST',url:'/api/sync/cash-register/apply-v2',headers:context.auth,payload:{cursor:`${openedAt}|44`,sessions:[remoteOpen]}});
    assert.equal(first.statusCode,200,first.body);
    const remoteClosed={...remoteOpen,status:'closed',closed_at:closedAt,actual_cash:10,updated_at:closedAt};
    const second=await context.app.inject({method:'POST',url:'/api/sync/cash-register/apply-v2',headers:context.auth,payload:{cursor:`${closedAt}|44`,sessions:[remoteClosed]}});
    assert.equal(second.statusCode,200,second.body);
    const stale=await context.app.inject({method:'POST',url:'/api/sync/cash-register/apply-v2',headers:context.auth,payload:{cursor:`${openedAt}|44`,sessions:[remoteOpen]}});
    assert.equal(stale.statusCode,200,stale.body);
    assert.equal(context.db.prepare('select status from cash_register_sessions where server_id=44').get()?.status,'closed');
    assert.equal(context.db.prepare("select value from sync_state where key='cash_register_cursor'").get()?.value,`${closedAt}|44`);
    assert.equal(Number(context.db.prepare("select count(*) n from sync_mutations where sync_status in ('pending','failed')").get()?.n),0);
  } finally {await context.app.close();context.db.close();fs.rmSync(context.root,{recursive:true,force:true})}
});

test("legacy commercial state is fail-closed until Vendor activation", async () => {
  const context = await fixture();

  try {
    context.db.prepare(
      "UPDATE merchant_license_state SET status='legacy',certificate_json=NULL,certificate_signature=NULL,reason_code=NULL,updated_at=? WHERE id=1"
    ).run(
      new Date().toISOString()
    );

    const status =
      await context.app.inject({
        method: "GET",
        url: "/api/license/status"
      });

    assert.equal(
      status.statusCode,
      200
    );

    assert.equal(
      status.json().data.status,
      "activation_required"
    );

    assert.deepEqual(
      status.json().data.features,
      []
    );

    const readable =
      await context.app.inject({
        method: "GET",
        url: "/api/products",
        headers: context.auth
      });

    assert.equal(
      readable.statusCode,
      200
    );

    const blocked =
      await context.app.inject({
        method: "POST",
        url: "/api/products/1/stock/increase",
        headers: context.auth,
        payload: {
          quantity: 1
        }
      });

    assert.equal(
      blocked.statusCode,
      403
    );

    assert.equal(
      blocked.json().code,
      "LICENSE_INACTIVE"
    );

    assert.equal(
      blocked.json().read_only,
      true
    );

    const backup =
      await context.app.inject({
        method: "POST",
        url: "/api/local/backup",
        headers: context.auth
      });

    assert.equal(
      backup.statusCode,
      200
    );
  } finally {
    await context.app.close();

    context.db.close();

    fs.rmSync(
      context.root,
      {
        recursive: true,
        force: true
      }
    );
  }
});

test("first and existing database startup are non-destructive", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-offline-start-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const first = openLocalDatabase(paths);
  first.prepare("INSERT INTO settings(key,value,created_at,updated_at) VALUES('marker','kept',?,?)").run(new Date().toISOString(), new Date().toISOString());
  first.close();
  const second = openLocalDatabase(paths);
  assert.equal(second.prepare("SELECT value FROM settings WHERE key='marker'").get()?.value, "kept");
  assert.equal(second.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.equal(second.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
  second.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("offline login rejects disabled users", async () => {
  const context = await fixture();
  try {
    const response = await context.app.inject({ method: "POST", url: "/api/login", payload: { email: "off@test.invalid", password: "1" } });
    assert.equal(response.statusCode, 422);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("production local sidecar never exposes manual setup after a certificate is present", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-license-setup-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const db = openLocalDatabase(paths);
  const issued = new Date().toISOString();
  const certificate: LicenseCertificateV2 = { version: 2, certificate_id: crypto.randomUUID(), license_id: crypto.randomUUID(), customer_id: crypto.randomUUID(), vendor_business_id: crypto.randomUUID(), business_id: null, business_type: "library", plan: "business", features: ["pos", "inventory"], installation_id: crypto.randomUUID(), device_fingerprint: "a".repeat(64), issued_at: issued, expires_at: new Date(Date.now()+86_400_000).toISOString(), offline_validity_days: 30 };
  db.prepare("UPDATE merchant_license_state SET status='active',license_id=?,customer_id=?,vendor_business_id=?,business_type=?,allowed_features_json=?,certificate_id=?,certificate_version=2,certificate_json=?,device_status='active',updated_at=? WHERE id=1").run(certificate.license_id,certificate.customer_id,certificate.vendor_business_id,certificate.business_type,JSON.stringify(certificate.features),certificate.certificate_id,JSON.stringify(certificate),issued);
  db.prepare('UPDATE merchant_license_state SET certificate_signature=? WHERE id=1').run(signCertificate(certificate,fixtureSigningKey));
  const app = await buildLocalApp({ paths, database: db });
  const common = { name: "Licensed Library", logo: null, phone: null, address: null, currency: "MAD", locale: "fr-MA", timezone: "Africa/Casablanca" };
  try {
    const blocked = await app.inject({ method: "POST", url: "/api/setup", payload: { business: { ...common, business_type: "library" }, enabled_features: ["pos"], admin: { name: "Patron", email: "licensed@test.invalid", password: "password1" } } });
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().code, 'SETUP_DISABLED_IN_PRODUCTION');
    assert.equal((await app.inject('/api/setup/status')).json().data.state, 'LOCAL_BOOTSTRAP_REQUIRED');
  } finally { await app.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("offline certificate import rejects copied identity, tampering, and expiry", { concurrency: false }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-poslic-import-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const db = openLocalDatabase(paths), app = await buildLocalApp({ paths, database: db });
  const vendor = crypto.generateKeyPairSync("ed25519"), device = crypto.generateKeyPairSync("ed25519");
  const publicJwk = JSON.stringify(device.publicKey.export({ format: "jwk" }));
  const previous = process.env.LICENSE_SIGNING_PUBLIC_KEY;
  process.env.LICENSE_SIGNING_PUBLIC_KEY = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
  const installation = crypto.randomUUID(), issued = new Date().toISOString();
  const certificate: LicenseCertificateV2 = { version: 2, certificate_id: crypto.randomUUID(), license_id: crypto.randomUUID(), customer_id: crypto.randomUUID(), vendor_business_id: crypto.randomUUID(), business_id: null, business_type: "retail", plan: "business", features: ["pos"], installation_id: installation, device_fingerprint: fingerprint(publicJwk), issued_at: issued, expires_at: new Date(Date.now()+86_400_000).toISOString(), offline_validity_days: 30 };
  const vendorPrivate = vendor.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const payload = (candidate: LicenseCertificateV2, install=installation) => {
    const proof = crypto.sign(null,Buffer.from(["poslic-import-v1",candidate.certificate_id,install].join("\n")),device.privateKey).toString("base64url");
    return { certificate:candidate, signature:signCertificate(candidate,vendorPrivate), installation_id:install, device_public_key:publicJwk, device_proof:proof };
  };
  try {
    assert.equal((await app.inject({method:"POST",url:"/api/license/import",payload:payload(certificate,crypto.randomUUID())})).statusCode,403);
    const signed=payload(certificate); signed.certificate={...certificate,features:["pos","inventory"]};
    assert.equal((await app.inject({method:"POST",url:"/api/license/import",payload:signed})).statusCode,422);
    const expired={...certificate,certificate_id:crypto.randomUUID(),expires_at:new Date(Date.now()-1000).toISOString()};
    assert.equal((await app.inject({method:"POST",url:"/api/license/import",payload:payload(expired)})).statusCode,422);
    const unchanged = db.prepare("SELECT status,certificate_json,license_id FROM merchant_license_state WHERE id=1").get() as {status?:string;certificate_json?:string|null;license_id?:string|null};
    assert.equal(unchanged?.status,'activation_required');
    assert.equal(unchanged?.certificate_json,null);
    assert.equal(unchanged?.license_id,null);
    const imported=await app.inject({method:"POST",url:"/api/license/import",payload:payload(certificate)});
    assert.equal(imported.statusCode,200,imported.body);
    assert.equal(imported.json().data.certificate.business_type,'retail');
    assert.deepEqual(imported.json().data.certificate.features,['pos']);
    const current=(await app.inject({method:'GET',url:'/api/license/status'})).json().data;
    assert.equal(current.status,'active');
    assert.equal(current.business_type,'retail');
    assert.deepEqual(current.features,['pos']);
  } finally { if(previous===undefined)delete process.env.LICENSE_SIGNING_PUBLIC_KEY;else process.env.LICENSE_SIGNING_PUBLIC_KEY=previous; await app.close();db.close();fs.rmSync(root,{recursive:true,force:true}); }
});

test("offline activation persists across a complete local API restart", { concurrency: false }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-poslic-restart-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const vendor = crypto.generateKeyPairSync("ed25519"), device = crypto.generateKeyPairSync("ed25519");
  const publicJwk = JSON.stringify(device.publicKey.export({ format: "jwk" }));
  const previous = process.env.LICENSE_SIGNING_PUBLIC_KEY;
  process.env.LICENSE_SIGNING_PUBLIC_KEY = vendor.publicKey.export({ type: "spki", format: "pem" }).toString();
  const installation = crypto.randomUUID(), issued = new Date().toISOString();
  const certificate: LicenseCertificateV2 = { version: 2, certificate_id: crypto.randomUUID(), license_id: crypto.randomUUID(), customer_id: crypto.randomUUID(), vendor_business_id: crypto.randomUUID(), business_id: null, business_type: "retail", plan: "business", features: ["pos"], installation_id: installation, device_fingerprint: fingerprint(publicJwk), issued_at: issued, expires_at: new Date(Date.now()+86_400_000).toISOString(), offline_validity_days: 30 };
  const signature = signCertificate(certificate,vendor.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const deviceProof = crypto.sign(null,Buffer.from(["poslic-import-v1",certificate.certificate_id,installation].join("\n")),device.privateKey).toString("base64url");
  let app = await buildLocalApp({ paths });
  try {
    const imported = await app.inject({ method: "POST", url: "/api/license/import", payload: { certificate, signature, installation_id: installation, device_public_key: publicJwk, device_proof: deviceProof } });
    assert.equal(imported.statusCode,200,imported.body);
    await app.close();
    app = await buildLocalApp({ paths });
    const status = await app.inject({ method: "GET", url: "/api/license/status" });
    assert.equal(status.statusCode,200,status.body);
    assert.equal(status.json().data.status,"active");
    assert.equal(status.json().data.certificate.certificate_id,certificate.certificate_id);
    assert.equal(status.json().data.business_type,"retail");
    assert.deepEqual(status.json().data.features,["pos"]);
  } finally {
    if(previous===undefined)delete process.env.LICENSE_SIGNING_PUBLIC_KEY;else process.env.LICENSE_SIGNING_PUBLIC_KEY=previous;
    await app.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("invalid local licence preserves reads and backup while blocking operational writes", async () => {
  const context = await fixture();
  try {
    context.db.prepare("UPDATE merchant_license_state SET status='revoked',reason_code='LICENSE_REVOKED',updated_at=? WHERE id=1").run(new Date().toISOString());
    assert.equal((await context.app.inject({ method: "GET", url: "/api/products", headers: context.auth })).statusCode, 200);
    const blocked = await context.app.inject({ method: "POST", url: "/api/products/1/stock/increase", headers: context.auth, payload: { quantity: 1 } });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().code, "LICENSE_REVOKED");
    assert.equal(blocked.json().read_only, true);
    assert.equal((await context.app.inject({ method: "POST", url: "/api/local/backup", headers: context.auth })).statusCode, 200);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("permanent offline certificate keeps operational writes active without a validation deadline", async () => {
  const context = await fixture();
  try {
    const state = context.db.prepare("SELECT certificate_json FROM merchant_license_state WHERE id=1").get() as { certificate_json?: string };
    const certificate = JSON.parse(String(state.certificate_json)) as LicenseCertificateV2;
    certificate.issued_at = "2020-01-01T00:00:00.000Z";
    certificate.expires_at = null;
    certificate.offline_validity_days = null;
    context.db.prepare('UPDATE merchant_license_state SET certificate_signature=? WHERE id=1').run(signCertificate(certificate,fixtureSigningKey));
    context.db.prepare("UPDATE merchant_license_state SET status='active',certificate_json=?,expires_at=NULL,offline_valid_until=NULL,last_validated_at='2020-01-01T00:00:00.000Z',reason_code=NULL,updated_at=? WHERE id=1").run(JSON.stringify(certificate), new Date().toISOString());
    const status = await context.app.inject({ method: "GET", url: "/api/license/status" });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().data.status, "active");
    assert.equal(status.json().data.expires_at, null);
    const writable = await context.app.inject({ method: "POST", url: "/api/products/1/stock/increase", headers: context.auth, payload: { quantity: 1 } });
    assert.equal(writable.statusCode, 200, writable.body);
  } finally {
    await context.app.close();
    context.db.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("malformed persisted licence fails closed without an internal error", async () => {
  const context = await fixture();
  try {
    context.db.prepare("UPDATE merchant_license_state SET status='active',certificate_json='not-json',updated_at=? WHERE id=1").run(new Date().toISOString());
    const status = await context.app.inject({ method: "GET", url: "/api/license/status" });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().data.status, "activation_required");
    const blocked = await context.app.inject({ method: "POST", url: "/api/products/1/stock/increase", headers: context.auth, payload: { quantity: 1 } });
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().code, "LICENSE_INACTIVE");
  } finally {
    await context.app.close();
    context.db.close();
    fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("desktop authentication persists, rotates once, restores, logs out, and preserves roles", async () => {
  const context = await fixture();
  let reopened: Awaited<ReturnType<typeof buildLocalApp>> | null = null;
  try {
    assert.equal((await context.app.inject({ method: "GET", url: "/api/user", headers: context.auth })).statusCode, 200);

    const sessionId = Number(context.db.prepare("SELECT id FROM refresh_tokens WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1").get()?.id);
    const expired = context.app.jwt.sign({ sub: 1, sid: sessionId, role: "patron", type: "access" }, { expiresIn: "-1s" });
    assert.equal((await context.app.inject({ method: "GET", url: "/api/user", headers: { authorization: `Bearer ${expired}` } })).statusCode, 401);

    const renewed = await context.app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: context.cookie } });
    assert.equal(renewed.statusCode, 200, renewed.body);
    const renewedToken = renewed.json().data.access_token as string;
    const renewedCookie = String(renewed.headers["set-cookie"]).split(";", 1)[0];
    assert.equal((await context.app.inject({ method: "GET", url: "/api/user", headers: { authorization: `Bearer ${renewedToken}` } })).statusCode, 200);

    reopened = await buildLocalApp({ paths: context.paths, database: context.db });
    const restored = await reopened.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: renewedCookie } });
    assert.equal(restored.statusCode, 200, restored.body);
    const restoredToken = restored.json().data.access_token as string;
    const restoredCookie = String(restored.headers["set-cookie"]).split(";", 1)[0];

    const raceLogin = await context.app.inject({ method: "POST", url: "/api/login", payload: { email: "patron@test.invalid", password: "1" } });
    const raceCookie = String(raceLogin.headers["set-cookie"]).split(";", 1)[0];
    const raced = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: raceCookie } }),
      context.app.inject({ method: "POST", url: "/api/auth/refresh", headers: { cookie: raceCookie } }),
    ]);
    assert.deepEqual(raced.map((response) => response.statusCode).sort(), [200, 401]);

    const timestamp = new Date().toISOString();
    const workerPassword = await bcrypt.hash("1", 4);
    context.db.prepare("INSERT INTO users(name,email,password,role,is_active,created_at,updated_at) VALUES('Worker Auth','worker-auth@test.invalid',?,'worker',1,?,?)").run(workerPassword, timestamp, timestamp);
    const workerLogin = await context.app.inject({ method: "POST", url: "/api/login", payload: { email: "worker-auth@test.invalid", password: "1" } });
    assert.equal(workerLogin.statusCode, 200);
    assert.equal((await context.app.inject({ method: "GET", url: "/api/users", headers: { authorization: `Bearer ${workerLogin.json().data.access_token}` } })).statusCode, 403);

    assert.equal((await reopened.inject({ method: "POST", url: "/api/logout", headers: { cookie: restoredCookie } })).statusCode, 200);
    assert.equal((await reopened.inject({ method: "GET", url: "/api/user", headers: { authorization: `Bearer ${restoredToken}` } })).statusCode, 401);
  } finally {
    if (reopened) await reopened.close();
    await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true });
  }
});

test("mixed sale decrements tracked stock only and session report follows the register", async () => {
  const context = await fixture();
  try {
    assert.equal((await context.app.inject({ method: "POST", url: "/api/cash-register/open", headers: context.auth, payload: { opening_cash: 100 } })).statusCode, 200);
    const sale = await context.app.inject({ method: "POST", url: "/api/sales", headers: context.auth, payload: { items: [{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 2 }] } });
    assert.equal(sale.statusCode, 200, sale.body);
    assert.equal(context.db.prepare("SELECT stock FROM products WHERE id=1").get()?.stock, 1);
    assert.equal(context.db.prepare("SELECT stock FROM products WHERE id=2").get()?.stock, 0);
    assert.equal(context.db.prepare("SELECT count(*) count FROM stock_movements").get()?.count, 1);
    const report = (await context.app.inject({ method: "GET", url: "/api/reports/cash-register", headers: context.auth })).json().data;
    assert.equal(report.total_sales, 25);
    assert.equal(report.total_products_sold, 3);
    assert.equal(report.period.status, "open");
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("insufficient tracked stock rolls back every mixed-cart line", async () => {
  const context = await fixture();
  try {
    await context.app.inject({ method: "POST", url: "/api/cash-register/open", headers: context.auth, payload: { opening_cash: 0 } });
    const response = await context.app.inject({ method: "POST", url: "/api/sales", headers: context.auth, payload: { items: [{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 1 }] } });
    assert.equal(response.statusCode, 422);
    assert.equal(context.db.prepare("SELECT count(*) count FROM sales").get()?.count, 0);
    assert.equal(context.db.prepare("SELECT count(*) count FROM sale_items").get()?.count, 0);
    assert.equal(context.db.prepare("SELECT count(*) count FROM stock_movements").get()?.count, 0);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("untracked product rejects manual stock mutation", async () => {
  const context = await fixture();
  try {
    const response = await context.app.inject({ method: "POST", url: "/api/products/2/stock/increase", headers: context.auth, payload: { quantity: 1 } });
    assert.equal(response.statusCode, 422);
    assert.match(response.json().message, /désactivé/);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

function multipart(fields: Record<string, string>, file?: { name: string; mime: string; bytes: Buffer }) {
  const boundary = `----bimik-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) chunks.push(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, Buffer.from("\r\n")]));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test("multipart product update replaces images safely and keeps every product field", async () => {
  const context = await fixture();
  try {
    const oldRelative = path.join("products", "shared-old.png");
    fs.mkdirSync(path.join(context.paths.uploads, "products"), { recursive: true });
    fs.writeFileSync(path.join(context.paths.uploads, oldRelative), Buffer.from([137,80,78,71,13,10,26,10]));
    context.db.prepare("UPDATE products SET image='/uploads/products/shared-old.png' WHERE id IN (1,2)").run();
    const body = multipart({ name: "Eau minérale", category_id: "1", sale_price: "6.50", stock: "9", min_stock: "2", track_stock: "true", is_active: "1" }, { name: "photo été.png", mime: "image/png", bytes: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]) });
    const response = await context.app.inject({ method: "PUT", url: "/api/products/1", headers: { ...context.auth, ...body.headers }, payload: body.payload });
    assert.equal(response.statusCode, 200, response.body);
    const product = response.json().data;
    assert.equal(product.name, "Eau minérale"); assert.equal(product.sale_price, 6.5); assert.equal(product.stock, 9); assert.equal(product.min_stock, 2); assert.equal(product.track_stock, true); assert.equal(product.is_active, true);
    assert.match(product.image_url, /^\/uploads\/products\/[0-9a-f-]+\.png$/);
    assert.equal(fs.existsSync(path.join(context.paths.uploads, product.image_url.replace(/^\/uploads\//, ""))), true);
    assert.equal(fs.existsSync(path.join(context.paths.uploads, oldRelative)), true, "shared image must not be deleted");
    const noImage = await context.app.inject({ method: "PUT", url: "/api/products/1", headers: context.auth, payload: { name: "Eau locale" } });
    assert.equal(noImage.json().data.image_url, product.image_url);
    const legacy = multipart({ name: "Eau compatible", sale_price: "7", track_stock: "1" });
    assert.equal((await context.app.inject({ method: "POST", url: "/api/products/1?_method=PUT", headers: { ...context.auth, ...legacy.headers }, payload: legacy.payload })).statusCode, 200);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("created product image survives a complete local API and database restart", async () => {
  const context = await fixture(); const root = context.root; const paths = context.paths;
  const body = multipart({ name: "Jus créé", category_id: "1", sale_price: "12", stock: "4", min_stock: "1", track_stock: "true", is_active: "1" }, { name: "jus été.png", mime: "image/png", bytes: Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]) });
  const createdResponse = await context.app.inject({ method: "POST", url: "/api/products", headers: { ...context.auth, ...body.headers }, payload: body.payload });
  assert.equal(createdResponse.statusCode, 200, createdResponse.body); const created = createdResponse.json().data;
  await context.app.close(); context.db.close();
  const reopenedDb = openLocalDatabase(paths); const reopenedApp = await buildLocalApp({ paths, database: reopenedDb });
  try {
    const login = await reopenedApp.inject({ method: "POST", url: "/api/login", payload: { email: "patron@test.invalid", password: "1" } }); const auth = { authorization: `Bearer ${login.json().data.access_token}` };
    const product = (await reopenedApp.inject({ method: "GET", url: `/api/products/${created.id}`, headers: auth })).json().data;
    assert.equal(product.image_url, created.image_url);
    const image = await reopenedApp.inject({ method: "GET", url: created.image_url });
    assert.equal(image.statusCode, 200);
    assert.match(String(image.headers["content-type"]), /^image\/png\b/);
    assert.equal(image.headers["cross-origin-resource-policy"], "cross-origin");
    assert.deepEqual(image.rawPayload.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  } finally { await reopenedApp.close(); reopenedDb.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("invalid multipart image is rejected without changing the product", async () => {
  const context = await fixture();
  try {
    const before = context.db.prepare("SELECT name,image FROM products WHERE id=1").get();
    const body = multipart({ name: "Ne doit pas changer", sale_price: "5" }, { name: "fake.png", mime: "image/png", bytes: Buffer.from("not a png") });
    const response = await context.app.inject({ method: "PUT", url: "/api/products/1", headers: { ...context.auth, ...body.headers }, payload: body.payload });
    assert.equal(response.statusCode, 422);
    assert.deepEqual(context.db.prepare("SELECT name,image FROM products WHERE id=1").get(), before);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("offline route parity returns dashboard, sale detail, stock history and settings envelopes", async () => {
  const context = await fixture();
  try {
    await context.app.inject({ method: "POST", url: "/api/cash-register/open", headers: context.auth, payload: { opening_cash: "20" } });
    const sale = (await context.app.inject({ method: "POST", url: "/api/sales", headers: context.auth, payload: { items: [{ product_id: 1, quantity: 1 }], payment_method: "cash" } })).json().data;
    assert.equal((await context.app.inject({ method: "GET", url: `/api/sales/${sale.id}`, headers: context.auth })).json().data.id, sale.id);
    assert.equal((await context.app.inject({ method: "GET", url: "/api/products/1/stock-movements", headers: context.auth })).json().data.length, 1);
    const dashboard = (await context.app.inject({ method: "GET", url: "/api/dashboard", headers: context.auth })).json().data;
    assert.equal(dashboard.today_sales, 5); assert.equal(dashboard.today_tickets, 1); assert.ok(Array.isArray(dashboard.low_stock_products));
    await context.app.inject({ method: "PUT", url: "/api/settings", headers: context.auth, payload: { wifi_name: "WiFi test", wifi_code: "secret-test", show_wifi_on_ticket: true, ticket_width: 58 } });
    const settings = (await context.app.inject({ method: "GET", url: "/api/settings/public" })).json().data;
    assert.equal(settings.wifi_name, "WiFi test"); assert.equal(settings.wifi_code, "secret-test"); assert.equal(settings.show_wifi_on_ticket, true); assert.equal(settings.ticket_width, 58);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("worker-filtered register report filters sales while cash metadata remains session-wide", async () => {
  const context = await fixture();
  try {
    const timestamp = new Date().toISOString(); const workerPassword = await bcrypt.hash("1", 4);
    context.db.prepare("INSERT INTO users(name,email,password,role,is_active,created_at,updated_at) VALUES('Worker Filtre','worker@test.invalid',?,'worker',1,?,?)").run(workerPassword, timestamp, timestamp);
    const workerLogin = await context.app.inject({ method: "POST", url: "/api/login", payload: { email: "worker@test.invalid", password: "1" } });
    const workerAuth = { authorization: `Bearer ${workerLogin.json().data.access_token}` };
    await context.app.inject({ method: "POST", url: "/api/cash-register/open", headers: context.auth, payload: { opening_cash: 100 } });
    await context.app.inject({ method: "POST", url: "/api/sales", headers: context.auth, payload: { items: [{ product_id: 2, quantity: 1 }], payment_method: "cash" } });
    await context.app.inject({ method: "POST", url: "/api/sales", headers: workerAuth, payload: { items: [{ product_id: 2, quantity: 2 }], payment_method: "card" } });
    const report = (await context.app.inject({ method: "GET", url: "/api/reports/cash-register?worker_id=3", headers: context.auth })).json().data;
    assert.equal(report.total_sales, 20); assert.equal(report.total_orders, 1); assert.equal(report.total_products_sold, 2); assert.equal(report.commandes[0].user.name, "Worker Filtre");
    assert.equal(report.cash_register_session.opening_cash, 100); assert.equal(report.cash_register_session.cash_sales_total, 10); assert.equal(report.cash_register_session.expected_cash, 110);
  } finally { await context.app.close(); context.db.close(); fs.rmSync(context.root, { recursive: true, force: true }); }
});
