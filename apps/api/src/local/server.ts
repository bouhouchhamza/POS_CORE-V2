import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { menuImportRequestSchema } from "@corepos/validation";
import { extractPdfText, MenuPdfError } from "../menu-import/pdf.js";
import {
  MENU_PDF_MAX_BYTES,
  normalizeMatchName,
  parseMenuLayout,
} from "../menu-import/parser.js";
import { createLocalBackup } from "./backup.js";
import { immediate, openLocalDatabase } from "./database.js";
import { ensureLocalPaths, localSecret, resolveLocalPaths, type LocalPaths } from "./paths.js";
import type { DatabaseSync } from "node:sqlite";
import { registerLocalCoreV2Routes } from '../core-v2/local-routes.js';
import {readLocalCertificate} from '../license/local-certificate.js';
import type {Role} from '@corepos/shared-types';

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: number; sid?: number; role: Role; type: "access"; tid?: string; did?: string; dch?: "web" | "mobile" };
    user: { sub: number; sid?: number; role: Role; type: "access"; tid?: string; did?: string; dch?: "web" | "mobile" };
  }
}

const now = () => new Date().toISOString();
const cents = (value: number) => Math.round(value * 100);
const amount = (value: unknown) => Number(value ?? 0) / 100;
const tokenHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const verifyPassword = async (hash: string, password: string) => {
  try {
    if (/^\$2[aby]\$/.test(hash)) return await bcrypt.compare(password, hash);
    if (/^\$argon2(?:id|i|d)\$/.test(hash)) return await argon2.verify(hash, password);
  } catch { /* A malformed verifier is an invalid credential, never a server error. */ }
  return false;
};
const localDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(date);
const safeUser = (row: any) => row && ({ id: row.id, name: row.name, email: row.email, role: row.role, is_active: Boolean(row.is_active), created_at: row.created_at, updated_at: row.updated_at });
const safeProduct = (row: any) => row && ({ id: row.id, category_id: row.category_id, name: row.name,sku:row.sku,barcode:row.barcode,unit:row.unit,tax_rate:Number(row.tax_rate??0),is_public:Boolean(row.is_public),available:Boolean(row.available), purchase_price: amount(row.purchase_price_cents), sale_price: amount(row.sale_price_cents), stock: row.stock, min_stock: row.min_stock, track_stock: Boolean(row.track_stock), image: row.image, image_url: row.image, is_active: Boolean(row.is_active), category: row.category_name ? { id: row.category_id, name: row.category_name } : null, created_at: row.created_at, updated_at: row.updated_at });
const safeStockMovement = (row: any) => ({ id: row.id, product_id: row.product_id, product: row.product_name ? { id: row.product_id, name: row.product_name } : null, user_id: row.user_id, user: row.user_name ? { id: row.user_id, name: row.user_name } : null, type: row.type, quantity: row.quantity, before_stock: row.before_stock, after_stock: row.after_stock, note: row.note, created_at: row.created_at, updated_at: row.updated_at });
const queryAll = (db: DatabaseSync, sql: string, ...values: any[]) => db.prepare(sql).all(...values) as any[];
const queryOne = (db: DatabaseSync, sql: string, ...values: any[]) => db.prepare(sql).get(...values) as any;
const imageExtensions = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
function validImage(bytes: Buffer, mime: string) { return mime === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : mime === "image/png" ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === "image/webp" && bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"; }

const credentialsSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const categorySchema = z.object({ name: z.string().trim().min(1).max(120),is_public:z.preprocess(value=>value==='true'||value==='1'||value===1?true:value==='false'||value==='0'||value===0?false:value,z.boolean()).optional() });
const productSchema = z.object({ category_id: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1).max(160),sku:z.string().max(100).nullable().optional(),barcode:z.string().max(100).nullable().optional(),unit:z.enum(['piece','kg','gram','liter','ml','pack','box','custom']).default('piece'),tax_rate:z.number().min(0).max(100).default(0), purchase_price: z.number().finite().nonnegative().default(0), sale_price: z.number().finite().nonnegative(), stock: z.number().int().nonnegative().default(0), min_stock: z.number().int().nonnegative().default(0), track_stock: z.boolean().default(true), is_active: z.boolean().default(true),is_public:z.boolean().default(true),available:z.boolean().default(true) });
const stockSchema = z.object({ quantity: z.number().int().positive(), note: z.string().trim().max(500).nullable().optional() });
const correctionSchema = z.object({ stock: z.number().int().nonnegative(), note: z.string().trim().max(500).nullable().optional() });
const saleSchema = z.object({ items: z.array(z.object({ product_id: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), payment_method: z.string().trim().min(1).max(30).default("cash"), note: z.string().trim().max(500).nullable().optional() });

export type LocalServerOptions = { paths?: LocalPaths; database?: DatabaseSync; logger?: boolean };

function rotateLocalLog(file: string, maxBytes = 5 * 1024 * 1024) {
  if (!fs.existsSync(file) || fs.statSync(file).size < maxBytes) return;
  fs.rmSync(`${file}.2`, { force: true });
  if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
  fs.renameSync(file, `${file}.1`);
}

export async function buildLocalApp(options: LocalServerOptions = {}) {
  const paths = ensureLocalPaths(options.paths ?? resolveLocalPaths());
  const db = options.database ?? openLocalDatabase(paths);
  const ownsDatabase = !options.database;
  const logFile = path.join(paths.logs, "api.log");
  if (options.logger) rotateLocalLog(logFile);
  const app = Fastify({ logger: options.logger ? { level: "info", file: logFile, redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "req.body.password", "req.body.wifi_password"] } : false, bodyLimit: 6 * 1024 * 1024 });
  app.log.info({ app_data_dir: paths.root, sqlite_database: paths.database }, "CorePOS local database path resolved");
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Accept", "Authorization", "Content-Type"], origin(origin, done) { const allowed = !origin || origin === "tauri://localhost" || origin === "http://tauri.localhost" || /^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(origin); done(allowed ? null : Object.assign(new Error("Origine refusée."), { statusCode: 403 }), allowed); } });
  await app.register(cookie);
  // The loopback-only desktop API keeps access tokens memory-only. They do
  // not expire during normal POS use; account validity is checked on every
  // protected request and logout still revokes the persistent refresh state.
  await app.register(jwt, { secret: localSecret(paths) });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { files: 1, fileSize: 5 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: paths.uploads,
    prefix: "/uploads/",
    decorateReply: false,
    setHeaders(response) {
      // The Tauri WebView and its loopback API have different origins.
      // Keep the API protected while allowing only static upload responses
      // to be embedded as images by the desktop frontend.
      response.header("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });

  const localForm = async (request: FastifyRequest, folder: "products" | "categories") => {
    if (!request.isMultipart()) return { fields: request.body as Record<string, unknown>, image: null as string | null };
    const fields: Record<string, unknown> = {}; let image: string | null = null;
    for await (const part of request.parts()) {
      if (part.type === "field") { fields[part.fieldname] = part.value; continue; }
      if (part.fieldname !== "image") { await part.toBuffer(); continue; }
      const extension = imageExtensions.get(part.mimetype); if (!extension) throw Object.assign(new Error("L’image doit être JPG, PNG ou WebP."), { statusCode: 422 });
      const bytes = await part.toBuffer(); if (!validImage(bytes, part.mimetype)) throw Object.assign(new Error("Le contenu de l’image est invalide."), { statusCode: 422 });
      const directory = path.join(paths.uploads, folder); fs.mkdirSync(directory, { recursive: true });
      const name = `${crypto.randomUUID()}${extension}`; fs.writeFileSync(path.join(directory, name), bytes, { flag: "wx" }); image = `/uploads/${folder}/${name}`;
    }
    return { fields, image };
  };
  const multipartProduct = (raw: Record<string, unknown>) => { const value = { ...raw } as any; for (const key of ["category_id", "purchase_price", "sale_price", "stock", "min_stock", "tax_rate"]) if (typeof value[key] === "string" && value[key] !== "") value[key] = Number(value[key]); if (value.category_id === "" || value.category_id === "null") value.category_id = null; for (const key of ["track_stock", "is_active", "is_public", "available"]) if (typeof value[key] === "string") { if (["true", "1"].includes(value[key])) value[key] = true; else if (["false", "0"].includes(value[key])) value[key] = false; else throw Object.assign(new Error(`${key} doit être true, false, 1 ou 0.`), { statusCode: 422 }); } return value; };
  const removeUnreferencedImage = (image: string | null | undefined) => {
    if (!image || !image.startsWith("/uploads/")) return;
    const references = Number(queryOne(db, "SELECT (SELECT count(*) FROM products WHERE image=?)+(SELECT count(*) FROM categories WHERE image=?) count", image, image)?.count ?? 0);
    if (references > 0) return;
    const relative = image.slice("/uploads/".length);
    const target = path.resolve(paths.uploads, relative);
    const root = `${path.resolve(paths.uploads)}${path.sep}`;
    if (target.startsWith(root)) fs.rmSync(target, { force: true });
  };
  const removeNewImageAfterFailure = (image: string | null) => {
    if (!image) return;
    const target = path.resolve(paths.uploads, image.slice("/uploads/".length));
    if (target.startsWith(`${path.resolve(paths.uploads)}${path.sep}`)) fs.rmSync(target, { force: true });
  };

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (!Number.isInteger(request.user.sid)) throw new Error("missing local session");
      const current = queryOne(db, "SELECT u.role,u.is_active FROM users u JOIN refresh_tokens r ON r.user_id=u.id WHERE u.id=? AND r.id=? AND r.revoked_at IS NULL", request.user.sub, request.user.sid);
      if (!current?.is_active || current.role !== request.user.role) throw new Error("inactive or changed user");
    } catch {
      return reply.code(401).send({ message: "Non authentifié." });
    }
  };
  const patronOnly = async (request: FastifyRequest, reply: FastifyReply) => { await authenticate(request, reply); if (reply.sent) return; if (!["patron","owner","admin"].includes(request.user.role)) return reply.code(403).send({ message: "Acces reserve a l'administration." }); };
  const productManager = async (request: FastifyRequest, reply: FastifyReply) => { await authenticate(request, reply); if (reply.sent) return; if (!["patron","owner","admin","manager","stock_manager"].includes(request.user.role)) return reply.code(403).send({ message: "Permission de gestion des produits requise." }); };
  const cashManager = async (request: FastifyRequest, reply: FastifyReply) => { await authenticate(request, reply); if (reply.sent) return; if (!["patron","owner","admin","manager","worker","cashier"].includes(request.user.role)) return reply.code(403).send({ message: "Acces caisse refuse." }); };
  app.addHook('preHandler',async(request,reply)=>{
    if(['GET','HEAD','OPTIONS'].includes(request.method)||process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')return;
    const route=request.url.split('?')[0];
    if(['/api/login','/api/logout','/api/auth/refresh','/api/setup','/api/local/backup'].includes(route)||route.startsWith('/api/license/'))return;
    const state=queryOne(db,'SELECT * FROM merchant_license_state WHERE id=1');
    let reason=state?.status??'activation_required';
    if(reason==='active'&&!state?.certificate_json)reason='activation_required';
    if(state?.certificate_json){
      try{
        const certificate=readLocalCertificate(state);
        if(!certificate)throw new Error('Invalid cached certificate');
        const commercial=certificate.expires_at?Date.parse(certificate.expires_at):Number.POSITIVE_INFINITY;
        const offline=certificate.offline_validity_days?Date.parse(certificate.issued_at)+certificate.offline_validity_days*86_400_000:Number.POSITIVE_INFINITY;
        if(commercial<=Date.now())reason='expired';else if(offline<=Date.now())reason='offline_validity_exceeded';
      }catch{reason='activation_required';}
    }
    if(reason==='active')return;
    const code=reason==='offline_validity_exceeded'?'OFFLINE_VALIDITY_EXCEEDED':reason==='expired'?'LICENSE_EXPIRED':reason==='revoked'?'LICENSE_REVOKED':reason==='device_revoked'?'DEVICE_REVOKED':reason==='vendor_business_inactive'?'VENDOR_BUSINESS_INACTIVE':'LICENSE_INACTIVE';
    return reply.code(403).send({message:'Licence inactive: consultation, export et activation restent disponibles.',code,read_only:true});
  });
  const issueSession = async (reply: FastifyReply, user: any) => {
    const refresh = crypto.randomBytes(48).toString("base64url");
    const timestamp = now();
    const persistentExpiry = "9999-12-31T23:59:59.999Z";
    const created = db.prepare("INSERT INTO refresh_tokens(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").run(user.id, tokenHash(refresh), persistentExpiry, timestamp);
    const access_token = await reply.jwtSign({ sub: user.id, sid: Number(created.lastInsertRowid), role: user.role, type: "access" });
    reply.setCookie("bimik_refresh", refresh, { httpOnly: true, secure: false, sameSite: "strict", path: "/api", expires: new Date(persistentExpiry) });
    return { access_token, token_type: "Bearer", user: safeUser(user) };
  };

  app.setErrorHandler((error: unknown, _request, reply) => { if (error instanceof z.ZodError) return reply.code(422).send({ message: error.issues[0]?.message ?? "Données invalides.", errors: error.flatten().fieldErrors }); const candidate = error as { statusCode?: number; message?: string }; const code = Number(candidate.statusCode); if (code >= 400 && code < 500) return reply.code(code).send({ message: candidate.message ?? "Requête invalide." }); app.log.error(error); return reply.code(500).send({ message: "Une erreur interne est survenue." }); });
  app.get("/health", async () => ({ status: "ok", mode: "local" }));
  app.get("/ready", async (_request, reply) => { const integrity = String(queryOne(db, "PRAGMA quick_check")?.quick_check ?? ""); return integrity === "ok" ? { status: "ready", database: "sqlite", mode: "local" } : reply.code(503).send({ status: "not_ready" }); });

  app.get("/api/local/status", async () => { const status = queryOne(db, "SELECT * FROM backup_status WHERE id=1"); let internet: "available" | "unavailable" = "unavailable"; try { const response = await fetch("https://pos.workflowtools.space/ready", { signal: AbortSignal.timeout(1500) }); if (response.ok) internet = "available"; } catch { /* Offline is expected and never blocks POS operations. */ } return { data: { mode: "local", internet, backup: status?.state ?? "pending", last_backup_at: status?.last_success_at ?? null } }; });
  app.post("/api/local/backup", { preHandler: patronOnly, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async () => { try { const result = createLocalBackup(db, paths); db.prepare("UPDATE backup_status SET last_success_at=?,last_path=?,state='success',last_error=NULL WHERE id=1").run(result.manifest.created_at, result.directory); return { data: { status: "success", created_at: result.manifest.created_at, files: result.manifest.files.length } }; } catch (error) { db.prepare("UPDATE backup_status SET state='error',last_error=? WHERE id=1").run(error instanceof Error ? error.message.slice(0, 500) : "Erreur"); throw error; } });

  // COREPOS_MULTI_TENANT_LOGIN_V1
  app.get("/api/auth/login-context", async () => ({
    data: {
      mode: "local",
      profile_picker: true,
      business: queryOne(db, "SELECT id,name,slug,logo,business_type FROM businesses ORDER BY id LIMIT 1") ?? null,
    },
  }));
  app.get("/api/login-profiles", async () => ({ data: queryAll(db, "SELECT id,name,email,role FROM users WHERE is_active=1 ORDER BY role,name") }));
  app.post("/api/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => { const input = credentialsSchema.parse(request.body); const user = queryOne(db, "SELECT * FROM users WHERE lower(email)=lower(?)", input.email); if (!user || !user.is_active || !(await verifyPassword(user.password, input.password))) return reply.code(422).send({ message: "Identifiants invalides.", code: "INVALID_CREDENTIALS" }); return { data: await issueSession(reply, user) }; });
  app.post("/api/auth/refresh", async (request, reply) => {
    const raw = request.cookies.bimik_refresh;
    if (!raw) return reply.code(401).send({ message: "Session absente." });
    const stored = immediate(db, () => {
      const candidate = queryOne(db, "SELECT u.* FROM refresh_tokens r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.revoked_at IS NULL AND r.expires_at>?", tokenHash(raw), now());
      if (!candidate?.is_active) return null;
      const rotated = db.prepare("UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(now(), tokenHash(raw));
      return rotated.changes === 1 ? candidate : null;
    });
    if (!stored) return reply.code(401).send({ message: "Session invalide." });
    return { data: await issueSession(reply, stored) };
  });
  app.post("/api/logout", async (request, reply) => { const raw = request.cookies.bimik_refresh; if (raw) db.prepare("UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?").run(now(), tokenHash(raw)); reply.clearCookie("bimik_refresh", { path: "/api" }); return { message: "Déconnexion réussie." }; });
  app.get("/api/user", { preHandler: authenticate }, async (request, reply) => { const user = queryOne(db, "SELECT * FROM users WHERE id=? AND is_active=1", request.user.sub); return user ? { data: safeUser(user) } : reply.code(401).send({ message: "Utilisateur inactif." }); });

  app.get("/api/users", { preHandler: patronOnly }, async () => ({ data: queryAll(db, "SELECT * FROM users ORDER BY name").map(safeUser) }));
  app.post("/api/users", { preHandler: patronOnly }, async (request, reply) => { const input = z.object({ name: z.string().trim().min(1), email: z.string().trim().email(), role: z.preprocess(v => typeof v === "string" ? v.trim().toLowerCase() : v, z.enum(["patron","worker","owner","admin","manager","cashier","seller","waiter","kitchen","stock_manager"])), password: z.string().min(1), is_active: z.boolean().default(true) }).parse(request.body),owner=queryOne(db,'SELECT business_id,branch_id FROM users WHERE id=?',request.user.sub); if (queryOne(db, "SELECT id FROM users WHERE business_id=? AND lower(email)=lower(?)",owner.business_id,input.email)) return reply.code(422).send({ message: "Cette adresse e-mail existe déjà." }); const timestamp = now(); const result = db.prepare("INSERT INTO users(business_id,branch_id,name,email,password,role,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(owner.business_id,owner.branch_id,input.name, input.email.toLowerCase(), await bcrypt.hash(input.password, 12), input.role, Number(input.is_active), timestamp, timestamp); return { data: safeUser(queryOne(db, "SELECT * FROM users WHERE id=?", Number(result.lastInsertRowid))) }; });
  app.route({ method: ["PATCH", "PUT"], url: "/api/users/:id", preHandler: patronOnly, handler: async (request, reply) => { const id = Number((request.params as any).id); const input = z.object({ name: z.string().trim().min(1).optional(), email: z.string().trim().email().optional(), role: z.preprocess(v => typeof v === "string" ? v.trim().toLowerCase() : v, z.enum(["patron","worker","owner","admin","manager","cashier","seller","waiter","kitchen","stock_manager"])).optional(), is_active: z.boolean().optional(), password: z.string().min(1).nullable().optional() }).parse(request.body); const current = queryOne(db, "SELECT * FROM users WHERE id=?", id); if (!current) return reply.code(404).send({ message: "Utilisateur introuvable." }); if (input.is_active === false && current.role === "patron" && current.is_active && Number(queryOne(db, "SELECT count(*) count FROM users WHERE role='patron' AND is_active=1")?.count) <= 1) return reply.code(422).send({ message: "Impossible de désactiver le dernier Patron actif." }); const password = typeof input.password === "string" ? await bcrypt.hash(input.password, 12) : current.password; const timestamp = now(); db.prepare("UPDATE users SET name=?,email=?,role=?,is_active=?,password=?,updated_at=? WHERE id=?").run(input.name ?? current.name, input.email ?? current.email, input.role ?? current.role, input.is_active === undefined ? current.is_active : Number(input.is_active), password, timestamp, id); if (input.is_active === false) db.prepare("UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(timestamp, id); return { data: safeUser(queryOne(db, "SELECT * FROM users WHERE id=?", id)), message: input.is_active === false ? "Utilisateur désactivé. Son historique est conservé." : "Utilisateur mis à jour." }; } });
  app.delete("/api/users/:id", { preHandler: patronOnly }, async (request, reply) => { const id = Number((request.params as any).id); if (id === request.user.sub) return reply.code(422).send({ message: "Vous ne pouvez pas supprimer votre propre compte." }); const current = queryOne(db, "SELECT * FROM users WHERE id=?", id); if (!current) return reply.code(404).send({ message: "Utilisateur introuvable." }); if (current.role === "patron" && current.is_active && Number(queryOne(db, "SELECT count(*) count FROM users WHERE role='patron' AND is_active=1")?.count) <= 1) return reply.code(422).send({ message: "Impossible de supprimer le dernier Patron actif." }); const references = Number(queryOne(db, "SELECT (SELECT count(*) FROM sales WHERE user_id=?)+(SELECT count(*) FROM stock_movements WHERE user_id=?) count", id, id)?.count ?? 0); if (references) return reply.code(422).send({ message: "Cet utilisateur possède un historique. Désactivez-le afin de conserver les ventes et mouvements de stock." }); db.prepare("DELETE FROM users WHERE id=?").run(id); return { message: "Utilisateur supprimé." }; });

  app.get("/api/categories", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT * FROM categories ORDER BY name").map((row) => ({ ...row,is_public:Boolean(row.is_public), image_url: row.image })) }));
  app.get("/api/categories/:id", { preHandler: authenticate }, async (request, reply) => { const row = queryOne(db, "SELECT * FROM categories WHERE id=?", Number((request.params as any).id)); return row ? { data: { ...row,is_public:Boolean(row.is_public), image_url: row.image } } : reply.code(404).send({ message: "Catégorie introuvable." }); });
  app.post("/api/categories", { preHandler: patronOnly }, async (request) => { const form = await localForm(request, "categories"); try { const input = categorySchema.parse(form.fields); const timestamp = now(),businessId=queryOne(db,"SELECT business_id FROM users WHERE id=?",request.user.sub)?.business_id; const result = db.prepare("INSERT INTO categories(business_id,name,image,is_public,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(businessId,input.name, form.image,Number(input.is_public??true), timestamp, timestamp); return { data: queryOne(db, "SELECT * FROM categories WHERE id=?", Number(result.lastInsertRowid)) }; } catch (error) { if (form.image) fs.rmSync(path.join(paths.uploads, form.image.replace(/^\/uploads\//, "")), { force: true }); throw error; } });
  const updateCategoryHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const id = Number((request.params as any).id); const current = queryOne(db, "SELECT * FROM categories WHERE id=?", id);
    if (!current) return reply.code(404).send({ message: "Catégorie introuvable." });
    const form = await localForm(request, "categories");
    try { const input = categorySchema.partial().parse(form.fields); db.prepare("UPDATE categories SET name=?,image=?,is_public=?,updated_at=? WHERE id=?").run(input.name ?? current.name, form.image ?? current.image,input.is_public===undefined?current.is_public:Number(input.is_public), now(), id); if (form.image && form.image !== current.image) removeUnreferencedImage(current.image); const row = queryOne(db, "SELECT * FROM categories WHERE id=?", id); return { data: { ...row,is_public:Boolean(row.is_public), image_url: row.image } }; }
    catch (error) { removeNewImageAfterFailure(form.image); throw error; }
  };
  app.put("/api/categories/:id", { preHandler: patronOnly }, updateCategoryHandler);
  app.post("/api/categories/:id", { preHandler: patronOnly }, updateCategoryHandler);
  app.delete("/api/categories/:id", { preHandler: patronOnly }, async (request, reply) => { const id = Number((request.params as any).id); const current = queryOne(db, "SELECT * FROM categories WHERE id=?", id); if (!current) return reply.code(404).send({ message: "Catégorie introuvable." }); immediate(db, () => { db.prepare("UPDATE products SET category_id=NULL,updated_at=? WHERE category_id=?").run(now(), id); db.prepare("DELETE FROM categories WHERE id=?").run(id); }); removeUnreferencedImage(current.image); return { message: "Catégorie supprimée." }; });
  app.get("/api/products", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.name").map(safeProduct) }));
  app.get("/api/products/:id", { preHandler: authenticate }, async (request, reply) => { const row = queryOne(db, "SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", Number((request.params as any).id)); return row ? { data: safeProduct(row) } : reply.code(404).send({ message: "Produit introuvable." }); });
  app.get("/api/products-low-stock", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.track_stock=1 AND p.stock<=p.min_stock ORDER BY p.stock,p.name").map(safeProduct) }));
  app.post("/api/products", { preHandler: productManager }, async (request) => { const form = await localForm(request, "products"); try { const input = productSchema.parse(multipartProduct(form.fields)); const timestamp = now(),businessId=queryOne(db,"SELECT business_id FROM users WHERE id=?",request.user.sub)?.business_id; const result = db.prepare("INSERT INTO products(business_id,category_id,name,sku,barcode,unit,tax_rate,purchase_price_cents,sale_price_cents,stock,min_stock,track_stock,image,is_active,is_public,available,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(businessId,input.category_id ?? null, input.name,input.sku||null,input.barcode||null,input.unit,input.tax_rate, cents(input.purchase_price), cents(input.sale_price), input.stock, input.min_stock, Number(input.track_stock), form.image, Number(input.is_active),Number(input.is_public),Number(input.available), timestamp, timestamp); return { data: safeProduct(queryOne(db, "SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", Number(result.lastInsertRowid))) }; } catch (error) { if (form.image) fs.rmSync(path.join(paths.uploads, form.image.replace(/^\/uploads\//, "")), { force: true }); throw error; } });
  const updateProductHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const id = Number((request.params as any).id);
    const current = queryOne(db, "SELECT * FROM products WHERE id=?", id);
    if (!current) return reply.code(404).send({ message: "Produit introuvable." });
    const form = await localForm(request, "products");
    try {
      const input = productSchema.partial().parse(multipartProduct(form.fields));
      db.prepare("UPDATE products SET category_id=?,name=?,sku=?,barcode=?,unit=?,tax_rate=?,purchase_price_cents=?,sale_price_cents=?,stock=?,min_stock=?,track_stock=?,image=?,is_active=?,is_public=?,available=?,updated_at=? WHERE id=?").run(
        input.category_id === undefined ? current.category_id : input.category_id,
        input.name ?? current.name,
        input.sku===undefined?current.sku:(input.sku||null),input.barcode===undefined?current.barcode:(input.barcode||null),input.unit??current.unit,input.tax_rate??current.tax_rate,
        input.purchase_price === undefined ? current.purchase_price_cents : cents(input.purchase_price),
        input.sale_price === undefined ? current.sale_price_cents : cents(input.sale_price),
        input.stock ?? current.stock,
        input.min_stock ?? current.min_stock,
        input.track_stock === undefined ? current.track_stock : Number(input.track_stock),
        form.image ?? current.image,
        input.is_active === undefined ? current.is_active : Number(input.is_active),
        input.is_public===undefined?current.is_public:Number(input.is_public),input.available===undefined?current.available:Number(input.available),
        now(), id,
      );
      if (form.image && current.image !== form.image) removeUnreferencedImage(current.image);
      return { data: safeProduct(queryOne(db, "SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", id)) };
    } catch (error) {
      removeNewImageAfterFailure(form.image);
      throw error;
    }
  };
  app.route({ method: ["PATCH", "PUT"], url: "/api/products/:id", preHandler: patronOnly, handler: updateProductHandler });
  app.post("/api/products/:id", { preHandler: patronOnly }, updateProductHandler);
  app.delete("/api/products/:id", { preHandler: patronOnly }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const current = queryOne(db, "SELECT * FROM products WHERE id=?", id);
    if (!current) return reply.code(404).send({ message: "Produit introuvable." });
    const history = Number(queryOne(db, "SELECT count(*) count FROM sale_items WHERE product_id=?", id)?.count ?? 0);
    if (history > 0) { db.prepare("UPDATE products SET is_active=0,updated_at=? WHERE id=?").run(now(), id); return { message: "Produit désactivé afin de conserver son historique.", data: safeProduct(queryOne(db, "SELECT * FROM products WHERE id=?", id)) }; }
    db.prepare("DELETE FROM products WHERE id=?").run(id);
    removeUnreferencedImage(current.image);
    return { message: "Produit supprimé." };
  });

  const stockOperation = (kind: "increase" | "decrease" | "correction") => async (request: FastifyRequest, reply: FastifyReply) => { const id = Number((request.params as any).id); const input = kind === "correction" ? correctionSchema.parse(request.body) : stockSchema.parse(request.body); return immediate(db, () => { const actor=queryOne(db,"SELECT business_id,branch_id FROM users WHERE id=?",request.user.sub);const product = queryOne(db, "SELECT * FROM products WHERE id=? AND business_id=?", id, actor.business_id); if (!product) return reply.code(404).send({ message: "Produit introuvable." }); if (!product.track_stock) return reply.code(422).send({ message: "Le suivi du stock est désactivé pour ce produit." }); const before = Number(product.stock); const after = kind === "correction" ? (input as any).stock : kind === "increase" ? before + (input as any).quantity : before - (input as any).quantity; if (after < 0) return reply.code(422).send({ message: "Stock insuffisant." }); const timestamp = now(),clientId=crypto.randomUUID(); db.prepare("UPDATE master_sync_runtime SET value='1' WHERE key='remote_apply'").run();try{db.prepare("UPDATE products SET stock=?,updated_at=? WHERE id=? AND business_id=?").run(after, timestamp, id, actor.business_id);db.prepare("INSERT INTO stock_movements(business_id,branch_id,product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at,client_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(actor.business_id,actor.branch_id,id,request.user.sub,kind,Math.abs(after-before),before,after,(input as any).note??null,timestamp,timestamp,clientId);if(queryOne(db,"SELECT 1 ok FROM master_sync_entities WHERE entity_type='products' AND local_id=?",id)){db.prepare("INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) VALUES(?,?,'stock_movement',?,'apply','{}','pending',?,?)").run(actor.business_id,clientId,String(id),timestamp,timestamp)}}finally{db.prepare("UPDATE master_sync_runtime SET value='0' WHERE key='remote_apply'").run()}return { data: safeProduct(queryOne(db, "SELECT * FROM products WHERE id=? AND business_id=?", id, actor.business_id)) }; }); };
  app.post("/api/products/:id/stock/increase", { preHandler: patronOnly }, stockOperation("increase"));
  app.post("/api/products/:id/stock/decrease", { preHandler: patronOnly }, stockOperation("decrease"));
  app.post("/api/products/:id/stock/correction", { preHandler: patronOnly }, stockOperation("correction"));
  app.get("/api/stock-movements", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT m.*,p.name product_name,u.name user_name FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC").map(safeStockMovement) }));
  app.get("/api/products/:id/stock-movements", { preHandler: authenticate }, async (request) => ({ data: queryAll(db, "SELECT m.*,p.name product_name,u.name user_name FROM stock_movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.user_id WHERE m.product_id=? ORDER BY m.created_at DESC", Number((request.params as any).id)).map(safeStockMovement) }));

  const mapCashRegisterSession = (row: any) => {
    if (!row) return null;

    const openedByRow = queryOne(
      db,
      "SELECT * FROM users WHERE id=?",
      row.opened_by_user_id,
    );

    const closedByRow =
      row.closed_by_user_id == null
        ? null
        : queryOne(
            db,
            "SELECT * FROM users WHERE id=?",
            row.closed_by_user_id,
          );

    const saleRows = queryAll(
      db,
      `SELECT payment_method,total_cents
       FROM sales
       WHERE cash_register_session_id=?`,
      row.id,
    );

    let salesTotalCents = 0;
    let cashSalesCents = 0;

    const nonCashCents: Record<string, number> = {};

    for (const sale of saleRows) {
      const total = Number(sale.total_cents ?? 0);
      const method = String(
        sale.payment_method ?? "cash",
      );

      salesTotalCents += total;

      if (method === "cash") {
        cashSalesCents += total;
      } else {
        nonCashCents[method] =
          (nonCashCents[method] ?? 0) + total;
      }
    }

    const totalProductsSold = Number(
      queryOne(
        db,
        `SELECT coalesce(sum(si.quantity),0) total
         FROM sale_items si
         JOIN sales s ON s.id=si.sale_id
         WHERE s.cash_register_session_id=?`,
        row.id,
      )?.total ?? 0,
    );

    const fallbackUser = (id: number) => ({
      id,
      name: "Utilisateur inconnu",
      email: "",
      role: "worker",
      is_active: false,
      created_at: row.opened_at,
      updated_at: row.opened_at,
    });

    const expectedCashCents =
      row.expected_cash_cents == null
        ? Number(row.opening_cash_cents) +
          cashSalesCents
        : Number(row.expected_cash_cents);

    return {
      id: Number(row.id),
      business_date: row.business_date,
      status: row.status,

      opened_at: row.opened_at,
      opened_by_user_id:
        Number(row.opened_by_user_id),

      opened_by: openedByRow
        ? safeUser(openedByRow)
        : fallbackUser(
            Number(row.opened_by_user_id),
          ),

      opening_cash:
        Number(row.opening_cash_cents) / 100,

      opening_note: row.opening_note ?? null,

      closed_at: row.closed_at ?? null,

      closed_by_user_id:
        row.closed_by_user_id == null
          ? null
          : Number(row.closed_by_user_id),

      closed_by: closedByRow
        ? safeUser(closedByRow)
        : null,

      expected_cash:
        expectedCashCents / 100,

      actual_cash:
        row.actual_cash_cents == null
          ? null
          : Number(row.actual_cash_cents) / 100,

      difference:
        row.difference_cents == null
          ? null
          : Number(row.difference_cents) / 100,

      closing_note: row.closing_note ?? null,

      sales_total:
        salesTotalCents / 100,

      cash_sales_total:
        cashSalesCents / 100,

      non_cash_totals:
        Object.fromEntries(
          Object.entries(nonCashCents).map(
            ([method, total]) => [
              method,
              total / 100,
            ],
          ),
        ),

      total_orders: saleRows.length,
      total_products_sold: totalProductsSold,

      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };
  app.get("/api/cash-register/current", { preHandler: authenticate }, async (request) => {
    const localUser=queryOne(db,'SELECT business_id,branch_id FROM users WHERE id=?',request.user.sub);
    return { data: mapCashRegisterSession(queryOne(db, "SELECT * FROM cash_register_sessions WHERE business_id IS ? AND branch_id IS ? AND status='open' AND sync_status!='conflict' LIMIT 1",localUser?.business_id??null,localUser?.branch_id??null)) };
  });
  app.post("/api/cash-register/open", { preHandler: cashManager }, async (request, reply) => { const input = z.object({ opening_cash: z.coerce.number().finite().nonnegative().default(0), opening_note: z.string().trim().max(500).nullable().optional() }).parse(request.body); return immediate(db, () => { const current=queryOne(db, "SELECT id FROM cash_register_sessions WHERE status='open' AND sync_status!='conflict'"); if (current) return reply.code(422).send({ message: "La caisse est déjà ouverte." }); const timestamp = now(), localUser=queryOne(db,'SELECT u.*,b.code branch_code FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?',request.user.sub),trackable=Number.isInteger(localUser.business_id),clientId=trackable?crypto.randomUUID():null; const result = db.prepare("INSERT INTO cash_register_sessions(business_id,branch_id,client_id,sync_status,business_date,status,opened_at,opened_by_user_id,opening_cash_cents,opening_note,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?,?,?,?)").run(localUser.business_id??null,localUser.branch_id??null,clientId,trackable?'pending':'local',localDate(),timestamp,request.user.sub,cents(input.opening_cash),input.opening_note??null,timestamp,timestamp); const sessionId=Number(result.lastInsertRowid); if(trackable&&clientId){const payload={client_id:clientId,operation:'open',local_session_id:sessionId,user_email:localUser.email,branch_code:localUser.branch_code,opening_cash:input.opening_cash,opening_note:input.opening_note??null,opened_at:timestamp}; db.prepare("INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) VALUES(?,?,?,?,? ,?,'pending',?,?)").run(localUser.business_id,clientId,'cash_register_session',String(sessionId),'open',JSON.stringify(payload),timestamp,timestamp)} return { data: mapCashRegisterSession(queryOne(db, "SELECT * FROM cash_register_sessions WHERE id=?",sessionId)) }; }); });
  app.post("/api/cash-register/close", { preHandler: cashManager }, async (request, reply) => { const input = z.object({ actual_cash: z.coerce.number().finite().nonnegative(), closing_note: z.string().trim().max(500).nullable().optional() }).parse(request.body); return immediate(db, () => { const session = queryOne(db, "SELECT * FROM cash_register_sessions WHERE status='open' AND sync_status!='conflict'"); if (!session) return reply.code(422).send({ message: "Aucune caisse ouverte." }); const cashSalesTotal = Number(queryOne(db, "SELECT coalesce(sum(s.total_cents),0)-coalesce((SELECT sum(r.total_cents) FROM sale_returns r JOIN sales rs ON rs.id=r.sale_id WHERE rs.cash_register_session_id=s.cash_register_session_id AND (lower(r.refund_method)='cash' OR (lower(r.refund_method)='original' AND lower(coalesce(rs.payment_method,'cash'))='cash'))),0) total FROM sales s WHERE s.cash_register_session_id=? AND lower(coalesce(s.payment_method,'cash'))='cash'", session.id)?.total ?? 0); const expected = Number(session.opening_cash_cents) + cashSalesTotal; const actual = cents(input.actual_cash),timestamp=now(),localUser=queryOne(db,'SELECT u.*,b.code branch_code FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?',request.user.sub),trackable=Number.isInteger(localUser.business_id),clientId=trackable?crypto.randomUUID():null; db.prepare("UPDATE cash_register_sessions SET status='closed',sync_status=?,closed_at=?,closed_by_user_id=?,expected_cash_cents=?,actual_cash_cents=?,difference_cents=?,closing_note=?,updated_at=? WHERE id=?").run(trackable?'pending':session.sync_status,timestamp,request.user.sub,expected,actual,actual-expected,input.closing_note??null,timestamp,session.id); if(trackable&&clientId){const payload={client_id:clientId,operation:'close',local_session_id:session.id,server_session_id:session.server_id??null,user_email:localUser.email,branch_code:localUser.branch_code,actual_cash:input.actual_cash,closing_note:input.closing_note??null,closed_at:timestamp}; db.prepare("INSERT INTO sync_mutations(business_id,client_id,entity_type,entity_id,operation,payload_json,sync_status,created_at,updated_at) VALUES(?,?,?,?,? ,?,'pending',?,?)").run(localUser.business_id,clientId,'cash_register_session',String(session.id),'close',JSON.stringify(payload),timestamp,timestamp)} return { data: mapCashRegisterSession(queryOne(db, "SELECT * FROM cash_register_sessions WHERE id=?", session.id)) }; }); });
  app.get("/api/cash-register/sessions", { preHandler: patronOnly }, async () => ({ data: queryAll(db, "SELECT * FROM cash_register_sessions ORDER BY opened_at DESC").map((row) => mapCashRegisterSession(row)) }));

  app.post("/api/sales", { preHandler: authenticate }, async (request, reply) => { const input = saleSchema.parse(request.body); const grouped = new Map<number, number>(); for (const item of input.items) grouped.set(item.product_id, (grouped.get(item.product_id) ?? 0) + item.quantity); return immediate(db, () => { const session = queryOne(db, "SELECT * FROM cash_register_sessions WHERE status='open'"); if (!session) return reply.code(422).send({ message: "Ouvrez la caisse avant d'enregistrer une vente." }); const lines = [...grouped.entries()].sort(([a], [b]) => a - b).map(([id, quantity]) => ({ product: queryOne(db, "SELECT * FROM products WHERE id=? AND is_active=1", id), quantity })); if (lines.some((line) => !line.product)) return reply.code(422).send({ message: "Un produit est introuvable ou inactif." }); for (const line of lines) if (line.product.track_stock && line.product.stock < line.quantity) return reply.code(422).send({ message: `Stock insuffisant pour ${line.product.name}.` }); const total = lines.reduce((sum, line) => sum + Number(line.product.sale_price_cents) * line.quantity, 0); const profit = lines.reduce((sum, line) => sum + (Number(line.product.sale_price_cents) - Number(line.product.purchase_price_cents)) * line.quantity, 0); const timestamp = now(); const saleResult = db.prepare("INSERT INTO sales(user_id,cash_register_session_id,payment_method,note,total_cents,profit_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(request.user.sub, session.id, input.payment_method, input.note ?? null, total, profit, timestamp, timestamp); const saleId = Number(saleResult.lastInsertRowid); for (const line of lines) { const lineTotal = Number(line.product.sale_price_cents) * line.quantity; const lineProfit = (Number(line.product.sale_price_cents) - Number(line.product.purchase_price_cents)) * line.quantity; db.prepare("INSERT INTO sale_items(sale_id,product_id,quantity,unit_price_cents,purchase_price_cents,total_cents,profit_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(saleId, line.product.id, line.quantity, line.product.sale_price_cents, line.product.purchase_price_cents, lineTotal, lineProfit, timestamp, timestamp); if (line.product.track_stock) { const after = line.product.stock - line.quantity; db.prepare("UPDATE products SET stock=?,updated_at=? WHERE id=?").run(after, timestamp, line.product.id); db.prepare("INSERT INTO stock_movements(product_id,user_id,type,quantity,before_stock,after_stock,note,created_at,updated_at) VALUES(?,?,'sale',?,?,?,?,?,?)").run(line.product.id, request.user.sub, -line.quantity, line.product.stock, after, `Vente #${saleId}`, timestamp, timestamp); } } return { data: mapSale(db, saleId) }; }); });
  app.get("/api/sales", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT * FROM sales ORDER BY created_at DESC").map((row) => mapSale(db, row.id)) }));
  app.get("/api/sales/:id", { preHandler: authenticate }, async (request, reply) => { const sale = mapSale(db, Number((request.params as any).id)); return sale ? { data: sale } : reply.code(404).send({ message: "Vente introuvable." }); });
  app.get(
    "/api/reports/today",
    { preHandler: patronOnly },
    async (request) => {
      const workerId =
        Number(
          (
            request.query as {
              worker_id?: unknown;
            }
          )?.worker_id,
        ) || null;

      return {
        data: reportForDay(
          db,
          workerId,
        ),
      };
    },
  );

  app.get(
    "/api/reports/cash-register",
    { preHandler: patronOnly },
    async (request) => {
      const sessionId =
        Number(
          (
            request.query as {
              session_id?: unknown;
            }
          )?.session_id,
        ) || null;
      const workerId =
        Number(
          (
            request.query as {
              worker_id?: unknown;
            }
          )?.worker_id,
        ) || null;

      const session = sessionId
        ? queryOne(
            db,
            "SELECT * FROM cash_register_sessions WHERE id=?",
            sessionId,
          )
        : queryOne(
            db,
            `SELECT *
             FROM cash_register_sessions
             ORDER BY
               CASE status
                 WHEN 'open' THEN 0
                 ELSE 1
               END,
               opened_at DESC
             LIMIT 1`,
          );

      return {
        data: reportForSession(db, session, workerId),
      };
    },
  );
  app.get("/api/reports/monthly", { preHandler: patronOnly }, async (request, reply) => {
    const rawMonth = (request.query as { month?: unknown })?.month;

    if (
      rawMonth !== undefined &&
      (
        typeof rawMonth !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      )
    ) {
      return reply.code(422).send({
        message: "Le mois doit être au format AAAA-MM.",
      });
    }

    return {
      data: reportForMonth(
        db,
        typeof rawMonth === "string" ? rawMonth : undefined,
      ),
    };
  });
  app.get("/api/workers", { preHandler: authenticate }, async () => ({ data: queryAll(db, "SELECT id,name,email,role,is_active FROM users WHERE is_active=1 ORDER BY name").map(safeUser) }));
  app.get("/api/dashboard", { preHandler: authenticate }, async () => { const report = reportForDay(db, null); const lowStock = queryAll(db, "SELECT p.id,p.name,p.stock stock_quantity,p.min_stock,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.track_stock=1 AND p.stock<=p.min_stock ORDER BY p.stock,p.name"); return { data: { today_sales: report.total_sales, today_tickets: report.total_orders, low_stock_count: lowStock.length, low_stock_products: lowStock } }; });

  const probableMenuName = (leftRaw: string, rightRaw: string) => {
    const left = normalizeMatchName(leftRaw)
      .replace(/[^\p{L}\p{N}]/gu, "");

    const right = normalizeMatchName(rightRaw)
      .replace(/[^\p{L}\p{N}]/gu, "");

    return (
      left !== right &&
      left.length >= 4 &&
      right.length >= 4 &&
      (left.includes(right) || right.includes(left))
    );
  };

  const menuMoneyCents = (raw: string | null) => {
    if (typeof raw !== "string") {
      throw Object.assign(
        new Error("Chaque produit importé doit avoir un prix valide."),
        { statusCode: 422 },
      );
    }

    const value = raw.trim().replace(",", ".");

    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      throw Object.assign(
        new Error(`Prix invalide : ${raw}`),
        { statusCode: 422 },
      );
    }

    const [whole, fraction = ""] = value.split(".");
    const result =
      Number(whole) * 100 +
      Number(fraction.padEnd(2, "0"));

    if (!Number.isSafeInteger(result) || result < 0) {
      throw Object.assign(
        new Error(`Prix invalide : ${raw}`),
        { statusCode: 422 },
      );
    }

    return result;
  };

  const menuBusinessError = (message: string) =>
    Object.assign(new Error(message), { statusCode: 422 });

  app.post(
    "/api/menu-import/preview",
    {
      preHandler: patronOnly,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.code(422).send({
          message: "Sélectionnez un fichier PDF.",
        });
      }

      const part = await request.file({
        limits: {
          files: 1,
          fileSize: MENU_PDF_MAX_BYTES,
        },
      });

      if (!part) {
        return reply.code(422).send({
          message: "Sélectionnez un fichier PDF.",
        });
      }

      if (part.fieldname !== "pdf") {
        await part.toBuffer();

        return reply.code(422).send({
          message:
            "Champ de fichier inattendu. Utilisez le champ « pdf ».",
        });
      }

      if (part.mimetype !== "application/pdf") {
        await part.toBuffer();

        return reply.code(422).send({
          message: "Le fichier doit être un PDF valide.",
        });
      }

      let bytes: Buffer;

      try {
        bytes = await part.toBuffer();
      } catch {
        return reply.code(413).send({
          message: "Le PDF ne doit pas dépasser 5 Mio.",
        });
      }

      if (
        part.file.truncated ||
        bytes.length > MENU_PDF_MAX_BYTES
      ) {
        return reply.code(413).send({
          message: "Le PDF ne doit pas dépasser 5 Mio.",
        });
      }

      try {
        const extracted = await extractPdfText(bytes);
        const parsed = parseMenuLayout(extracted);

        if (!parsed.categories.length) {
          return reply.code(422).send({
            message:
              "Aucun produit exploitable n’a été trouvé dans ce PDF.",
          });
        }

        const existingCategories = queryAll(
          db,
          `SELECT id,name
           FROM categories
           ORDER BY name`,
        );

        const existingProducts = queryAll(
          db,
          `SELECT id,category_id,name,track_stock
           FROM products
           ORDER BY name`,
        );

        const previewCategories =
          parsed.categories.map((category) => {
            const exactCategory =
              existingCategories.find(
                (item) =>
                  normalizeMatchName(item.name) ===
                  normalizeMatchName(category.name),
              );

            const probableCategory =
              exactCategory ??
              existingCategories.find((item) =>
                probableMenuName(
                  item.name,
                  category.name,
                ),
              );

            const targetCategoryId =
              exactCategory?.id ?? null;

            return {
              ...category,

              decision: exactCategory
                ? ("use_existing" as const)
                : ("create" as const),

              existing_category_id:
                targetCategoryId,

              duplicate_kind: exactCategory
                ? ("exact" as const)
                : probableCategory
                  ? ("probable" as const)
                  : ("none" as const),

              products: category.products.map(
                (product) => {
                  const candidates =
                    existingProducts.filter(
                      (item) =>
                        targetCategoryId !== null &&
                        item.category_id ===
                          targetCategoryId,
                    );

                  const exact =
                    candidates.find(
                      (item) =>
                        normalizeMatchName(
                          item.name,
                        ) ===
                        normalizeMatchName(
                          product.name,
                        ),
                    );

                  const probable =
                    exact ??
                    candidates.find((item) =>
                      probableMenuName(
                        item.name,
                        product.name,
                      ),
                    );

                  return {
                    ...product,

                    track_stock:
                      exact
                        ? Boolean(
                            exact.track_stock,
                          )
                        : false,

                    decision: exact
                      ? ("skip" as const)
                      : ("create" as const),

                    existing_product_id:
                      exact?.id ?? null,

                    duplicate_kind: exact
                      ? ("exact" as const)
                      : probable
                        ? ("probable" as const)
                        : ("none" as const),
                  };
                },
              ),
            };
          });

        const sessionId =
          crypto.randomUUID();

        const preview = {
          session_id: sessionId,
          page_count: extracted.pageCount,
          currency: "MAD" as const,
          categories: previewCategories,
          ignored_items: parsed.ignored_items,
          warnings: parsed.warnings,
        };

        db.prepare(`
          INSERT INTO menu_import_sessions(
            id,
            user_id,
            preview_json,
            status,
            created_at
          )
          VALUES(?,?,?,?,?)
        `).run(
          sessionId,
          request.user.sub,
          JSON.stringify(preview),
          "pending",
          now(),
        );

        return {
          data: preview,
        };
      } catch (error) {
        if (error instanceof MenuPdfError) {
          return reply.code(422).send({
            message: error.message,
            code: error.code,
          });
        }

        throw error;
      }
    },
  );

  app.post(
    "/api/menu-import/confirm",
    {
      preHandler: patronOnly,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const explicitTracking =
        new Set<string>();

      const rawCategories =
        (
          request.body as {
            categories?: Array<{
              products?: Array<
                Record<string, unknown>
              >;
            }>;
          } | null
        )?.categories;

      for (
        const category of rawCategories ?? []
      ) {
        for (
          const product of
            category.products ?? []
        ) {
          if (
            typeof product.client_id ===
              "string" &&
            Object.prototype.hasOwnProperty.call(
              product,
              "track_stock",
            )
          ) {
            explicitTracking.add(
              product.client_id,
            );
          }
        }
      }

      const input =
        menuImportRequestSchema.parse(
          request.body,
        );

      const result = immediate(db, () => {
        const session = queryOne(
          db,
          `SELECT *
           FROM menu_import_sessions
           WHERE id=?
             AND user_id=?`,
          input.session_id,
          request.user.sub,
        );

        if (!session) {
          return {
            kind: "missing" as const,
          };
        }

        if (session.status === "confirmed") {
          if (!session.result_json) {
            throw new Error(
              "Session confirmée sans résultat enregistré.",
            );
          }

          return {
            kind: "done" as const,
            value: {
              ...JSON.parse(
                session.result_json,
              ),
              replayed: true,
            },
          };
        }

        const summary = {
          session_id: input.session_id,
          replayed: false,

          categories: {
            created: 0,
            reused: 0,
            ignored: 0,
          },

          products: {
            created: 0,
            updated: 0,
            ignored: 0,
            failed: 0,
          },
        };

        for (
          const category of input.categories
        ) {
          if (
            category.decision === "skip"
          ) {
            summary.categories.ignored += 1;
            summary.products.ignored +=
              category.products.length;

            continue;
          }

          let categoryId: number;

          if (
            category.decision ===
            "use_existing"
          ) {
            const existing = queryOne(
              db,
              `SELECT *
               FROM categories
               WHERE id=?`,
              category.existing_category_id,
            );

            if (!existing) {
              throw menuBusinessError(
                "La catégorie existante sélectionnée n’existe plus.",
              );
            }

            categoryId =
              Number(existing.id);

            summary.categories.reused += 1;
          } else {
            const existingCategories =
              queryAll(
                db,
                `SELECT id,name
                 FROM categories`,
              );

            const exact =
              existingCategories.find(
                (row) =>
                  normalizeMatchName(
                    row.name,
                  ) ===
                  normalizeMatchName(
                    category.name,
                  ),
              );

            if (exact) {
              throw menuBusinessError(
                `La catégorie « ${category.name} » existe déjà. Choisissez-la explicitement.`,
              );
            }

            const timestamp = now();

            const created =
              db.prepare(`
                INSERT INTO categories(
                  name,
                  image,
                  created_at,
                  updated_at
                )
                VALUES(?,?,?,?)
              `).run(
                category.name.trim(),
                null,
                timestamp,
                timestamp,
              );

            categoryId =
              Number(
                created.lastInsertRowid,
              );

            summary.categories.created += 1;
          }

          for (
            const product of
              category.products
          ) {
            if (
              product.decision === "skip"
            ) {
              summary.products.ignored += 1;
              continue;
            }

            const productName =
              product.variant
                ? `${product.name} - ${product.variant}`
                : product.name;

            const salePriceCents =
              menuMoneyCents(
                product.sale_price,
              );

            if (
              product.decision ===
              "update_existing"
            ) {
              const existing =
                queryOne(
                  db,
                  `SELECT *
                   FROM products
                   WHERE id=?`,
                  product.existing_product_id,
                );

              if (!existing) {
                throw menuBusinessError(
                  "Le produit sélectionné n’existe plus.",
                );
              }

              const trackStock =
                explicitTracking.has(
                  product.client_id,
                )
                  ? Number(
                      product.track_stock,
                    )
                  : Number(
                      existing.track_stock,
                    );

              const stock =
                product.initial_stock ??
                Number(existing.stock);

              db.prepare(`
                UPDATE products
                SET
                  name=?,
                  category_id=?,
                  sale_price_cents=?,
                  track_stock=?,
                  stock=?,
                  updated_at=?
                WHERE id=?
              `).run(
                productName.trim(),
                categoryId,
                salePriceCents,
                trackStock,
                stock,
                now(),
                existing.id,
              );

              summary.products.updated += 1;
            } else {
              const existingProducts =
                queryAll(
                  db,
                  `SELECT id,name
                   FROM products
                   WHERE category_id=?`,
                  categoryId,
                );

              const exact =
                existingProducts.find(
                  (row) =>
                    normalizeMatchName(
                      row.name,
                    ) ===
                    normalizeMatchName(
                      productName,
                    ),
                );

              if (exact) {
                throw menuBusinessError(
                  `Le produit « ${productName} » existe déjà. Résolvez explicitement le doublon.`,
                );
              }

              const timestamp = now();

              db.prepare(`
                INSERT INTO products(
                  category_id,
                  name,
                  sale_price_cents,
                  stock,
                  min_stock,
                  track_stock,
                  image,
                  is_active,
                  created_at,
                  updated_at
                )
                VALUES(?,?,?,?,?,?,?,?,?,?)
              `).run(
                categoryId,
                productName.trim(),
                salePriceCents,
                product.initial_stock ?? 0,
                0,
                Number(product.track_stock),
                null,
                1,
                timestamp,
                timestamp,
              );

              summary.products.created += 1;
            }
          }
        }

        db.prepare(`
          UPDATE menu_import_sessions
          SET
            status='confirmed',
            result_json=?,
            confirmed_at=?
          WHERE id=?
        `).run(
          JSON.stringify(summary),
          now(),
          input.session_id,
        );

        return {
          kind: "created" as const,
          value: summary,
        };
      });

      if (result.kind === "missing") {
        return reply.code(404).send({
          message:
            "Session d’importation introuvable ou expirée.",
        });
      }

      return {
        data: result.value,
      };
    },
  );
  app.get("/api/settings", { preHandler: patronOnly }, async () => ({ data: Object.fromEntries(queryAll(db, "SELECT key,value FROM settings").map((row) => [row.key, decodeSetting(row.value)])) }));
  app.get("/api/settings/public", async () => { const allowed = ["cafe_name", "cafe_subtitle", "cafe_address", "cafe_phone", "wifi_name", "wifi_code", "ticket_header", "ticket_footer", "ticket_note", "show_wifi_on_ticket", "show_phone_on_ticket", "show_address_on_ticket", "ticket_width"]; const rows = queryAll(db, `SELECT key,value FROM settings WHERE key IN (${allowed.map(() => "?").join(",")})`, ...allowed); return { data: Object.fromEntries(rows.map((row) => [row.key, decodeSetting(row.value)])) }; });
  app.put("/api/settings", { preHandler: patronOnly }, async (request) => { const input = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).parse(request.body); immediate(db, () => { for (const [key, value] of Object.entries(input)) db.prepare("INSERT INTO settings(key,value,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, value === null ? null : String(value), now(), now()); }); return { data: input }; });
  app.put("/api/settings/wifi", { preHandler: patronOnly }, async (request) => { const input = z.object({ wifi_name: z.string().max(120), wifi_code: z.string().max(200) }).parse(request.body); immediate(db, () => { for (const [key, value] of Object.entries(input)) db.prepare("INSERT INTO settings(key,value,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, value, now(), now()); }); return { data: input }; });

  registerLocalCoreV2Routes(app,db,authenticate);
  app.addHook("onClose", async () => { if (ownsDatabase) db.close(); });
  return app;
}

function decodeSetting(value: unknown) { if (value === "true") return true; if (value === "false") return false; if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)) return Number(value); return value; }
function mapSale(db: DatabaseSync, id: number) { const sale = queryOne(db, "SELECT s.*,u.name user_name,u.role user_role FROM sales s JOIN users u ON u.id=s.user_id WHERE s.id=?", id); if (!sale) return null; const items = queryAll(db, "SELECT i.*,p.name product_name FROM sale_items i JOIN products p ON p.id=i.product_id WHERE i.sale_id=? ORDER BY i.id", id).map((item) => ({ id: item.id, product_id: item.product_id, product: { id: item.product_id, name: item.product_name }, quantity: item.quantity, unit_price: amount(item.unit_price_cents), purchase_price: amount(item.purchase_price_cents), total: amount(item.total_cents), profit: amount(item.profit_cents) })); return { id: sale.id, user_id: sale.user_id, user: { id: sale.user_id, name: sale.user_name, role: sale.user_role }, order_id: sale.order_id ?? null, cash_register_session_id: sale.cash_register_session_id, payment_method: sale.payment_method, note: sale.note, total: amount(sale.total_cents), profit: amount(sale.profit_cents), items, created_at: sale.created_at, updated_at: sale.updated_at }; }
function reportForSession(db: DatabaseSync, session: any, workerId: number | null) {
  if (!session) return { period: { type: "session", status: "none", date: localDate(), start: null, end: null, worker_id: workerId, worker_name: null }, cash_register_session: null, total_sales: 0, total_orders: 0, total_products_sold: 0, best_products: [], commandes: [] };
  const args: any[] = [session.id]; let where = "s.cash_register_session_id=?"; if (workerId) { where += " AND s.user_id=?"; args.push(workerId); }
  const sales: any[] = queryAll(db, `SELECT s.id FROM sales s WHERE ${where} ORDER BY s.created_at DESC`, ...args).map((row) => mapSale(db, row.id)).filter(Boolean);
  const aggregate = new Map<number, any>(); for (const sale of sales) for (const item of sale.items) { const current = aggregate.get(item.product_id) ?? { product_id: item.product_id, name: item.product?.name ?? `Produit #${item.product_id}`, quantity: 0, total: 0 }; current.quantity += item.quantity; current.total = Math.round((current.total + item.total) * 100) / 100; aggregate.set(item.product_id, current); }
  const worker = workerId ? queryOne(db, "SELECT name FROM users WHERE id=?", workerId) : null;
  const sessionSales = queryAll(db, "SELECT payment_method,total_cents FROM sales WHERE cash_register_session_id=?", session.id);
  let salesTotalCents = 0, cashSalesCents = 0; const nonCashCents: Record<string, number> = {};
  for (const sale of sessionSales) { const total = Number(sale.total_cents ?? 0); const method = String(sale.payment_method ?? "cash").toLowerCase(); salesTotalCents += total; if (method === "cash") cashSalesCents += total; else nonCashCents[method] = (nonCashCents[method] ?? 0) + total; }
  const openedBy = queryOne(db, "SELECT * FROM users WHERE id=?", session.opened_by_user_id); const closedBy = session.closed_by_user_id == null ? null : queryOne(db, "SELECT * FROM users WHERE id=?", session.closed_by_user_id);
  const allRefundCents = Number(queryOne(db, "SELECT coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.cash_register_session_id=?", session.id)?.total ?? 0);
  const cashRefundCents = Number(queryOne(db, "SELECT coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.cash_register_session_id=? AND (lower(r.refund_method)='cash' OR (lower(r.refund_method)='original' AND lower(coalesce(s.payment_method,'cash'))='cash'))", session.id)?.total ?? 0);
  const refundMethods = queryAll(db, "SELECT lower(case when lower(r.refund_method)='original' then coalesce(s.payment_method,'cash') else r.refund_method end) method,coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.cash_register_session_id=? GROUP BY 1", session.id);
  const reportRefundCents = workerId ? Number(queryOne(db, "SELECT coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.cash_register_session_id=? AND s.user_id=?", session.id, workerId)?.total ?? 0) : allRefundCents;
  const reportSalesCents = sales.reduce((sum:any,s:any)=>sum+Math.round(Number(s.total)*100),0)-reportRefundCents;
  const refundByMethod = Object.fromEntries(refundMethods.map((r:any)=>[String(r.method).toLowerCase(),Number(r.total)]));
  cashSalesCents -= cashRefundCents; salesTotalCents -= allRefundCents;
  const expectedCashCents = session.expected_cash_cents == null ? Number(session.opening_cash_cents) + cashSalesCents : Number(session.expected_cash_cents);
  const cashRegisterSession = { ...session, opened_by: openedBy ? safeUser(openedBy) : null, closed_by: closedBy ? safeUser(closedBy) : null, opening_cash: amount(session.opening_cash_cents), expected_cash: amount(expectedCashCents), actual_cash: session.actual_cash_cents == null ? null : amount(session.actual_cash_cents), difference: session.difference_cents == null ? null : amount(session.difference_cents), sales_total: amount(salesTotalCents), cash_sales_total: amount(cashSalesCents), non_cash_totals: Object.fromEntries(Object.entries(nonCashCents).map(([method, total]) => [method, amount(Number(total)-Number(refundByMethod[method]??0))])), total_orders: sessionSales.length };
  return { period: { type: "session", status: session.status, date: session.business_date, start: session.opened_at, end: session.status === "open" ? now() : session.closed_at, worker_id: workerId, worker_name: worker?.name ?? null }, cash_register_session: cashRegisterSession, total_sales: amount(reportSalesCents), total_orders: sales.length, total_products_sold: sales.reduce((sum, sale) => sum + sale.items.reduce((n: number, item: any) => n + item.quantity, 0), 0), best_products: [...aggregate.values()].sort((a, b) => b.quantity - a.quantity), commandes: sales };
}


const casablancaMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Casablanca",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function casablancaMidnightIso(year: number, month: number, day: number) {
  const normalized = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const targetYear = normalized.getUTCFullYear();
  const targetMonth = normalized.getUTCMonth() + 1;
  const targetDay = normalized.getUTCDate();

  const targetAsUtc = Date.UTC(
    targetYear,
    targetMonth - 1,
    targetDay,
    0,
    0,
    0,
  );

  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      casablancaMonthFormatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );

    const delta = targetAsUtc - representedAsUtc;
    candidate += delta;

    if (delta === 0) break;
  }

  return new Date(candidate).toISOString();
}

function reportForDay(
  db: DatabaseSync,
  workerId: number | null,
) {
  const todayParts = Object.fromEntries(
    casablancaMonthFormatter
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const year = Number(todayParts.year);
  const month = Number(todayParts.month);
  const day = Number(todayParts.day);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error("Impossible de déterminer la date locale de Casablanca.");
  }

  const date =
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const start =
    casablancaMidnightIso(
      year,
      month,
      day,
    );

  const nextDay = new Date(
    Date.UTC(
      year,
      month - 1,
      day + 1,
    ),
  );

  const endExclusive =
    casablancaMidnightIso(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
    );

  let sql = `
    SELECT s.id
    FROM sales s
    WHERE s.created_at >= ?
      AND s.created_at < ?
  `;

  const args: any[] = [
    start,
    endExclusive,
  ];

  if (workerId) {
    sql += " AND s.user_id=?";
    args.push(workerId);
  }

  sql += " ORDER BY s.created_at DESC";

  const commandes = queryAll(
    db,
    sql,
    ...args,
  )
    .map((row) =>
      mapSale(db, row.id),
    )
    .filter(
      (
        sale,
      ): sale is NonNullable<
        ReturnType<typeof mapSale>
      > => sale != null,
    );

  const products = new Map<
    number,
    {
      product_id: number;
      name: string;
      quantity: number;
      total: number;
    }
  >();

  let totalProductsSold = 0;

  for (const sale of commandes) {
    for (const item of sale.items) {
      totalProductsSold +=
        Number(item.quantity);

      const current =
        products.get(
          item.product_id,
        ) ?? {
          product_id:
            item.product_id,
          name:
            item.product?.name ??
            `Produit #${item.product_id}`,
          quantity: 0,
          total: 0,
        };

      current.quantity +=
        Number(item.quantity);

      current.total =
        Math.round(
          (
            current.total +
            Number(item.total)
          ) * 100,
        ) / 100;

      products.set(
        item.product_id,
        current,
      );
    }
  }

  const worker = workerId
    ? queryOne(
        db,
        "SELECT name FROM users WHERE id=?",
        workerId,
      )
    : null;

  const refundArgs:any[]=[start,endExclusive]; let refundSql="SELECT coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.created_at>=? AND s.created_at<?"; if(workerId){refundSql+=" AND s.user_id=?";refundArgs.push(workerId);} const periodRefund=Number(queryOne(db,refundSql,...refundArgs)?.total??0);
  const totalSales =
    Math.round(
      (commandes.reduce(
        (sum, sale) =>
          sum +
          Number(sale.total),
        0,
      ) - periodRefund/100) * 100,
    ) / 100;

  return {
    period: {
      type: "day",
      date,
      start,
      end: new Date(
        new Date(
          endExclusive,
        ).getTime() - 1,
      ).toISOString(),
      worker_id: workerId,
      worker_name:
        worker?.name ?? null,
    },

    session: null,
    cash_register_session: null,

    total_sales: totalSales,
    total_orders:
      commandes.length,
    total_products_sold:
      totalProductsSold,

    best_products: [
      ...products.values(),
    ].sort(
      (a, b) =>
        b.quantity -
        a.quantity,
    ),

    commandes,
  };
}
function reportForMonth(
  db: DatabaseSync,
  requestedMonth?: string,
) {
  const month = requestedMonth ?? localDate().slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);

  const start = casablancaMidnightIso(year, monthNumber, 1);

  const nextMonth = new Date(
    Date.UTC(year, monthNumber, 1),
  );

  const endExclusive = casablancaMidnightIso(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    1,
  );

  const rows = queryAll(
    db,
    `SELECT id,total_cents
     FROM sales
     WHERE created_at >= ?
       AND created_at < ?
     ORDER BY created_at DESC`,
    start,
    endExclusive,
  );

  const commandes = rows
    .map((row) => mapSale(db, row.id))
    .filter(
      (sale): sale is NonNullable<ReturnType<typeof mapSale>> =>
        sale != null,
    );

  const products = new Map<
    number,
    {
      product_id: number;
      name: string;
      quantity: number;
      total: number;
    }
  >();

  let totalProductsSold = 0;

  for (const sale of commandes) {
    for (const item of sale.items) {
      totalProductsSold += Number(item.quantity);

      const current = products.get(item.product_id) ?? {
        product_id: item.product_id,
        name: item.product?.name ?? `Produit #${item.product_id}`,
        quantity: 0,
        total: 0,
      };

      current.quantity += Number(item.quantity);
      current.total =
        Math.round(
          (current.total + Number(item.total)) * 100,
        ) / 100;

      products.set(item.product_id, current);
    }
  }

  const end = new Date(
    new Date(endExclusive).getTime() - 1,
  ).toISOString();

  return {
    period: {
      type: "monthly",
      month,
      start,
      end,
    },
    total_sales: amount(
      rows.reduce(
        (sum, row) => sum + Number(row.total_cents),
        0,
      ) - Number(queryOne(db, "SELECT coalesce(sum(r.total_cents),0) total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.created_at>=? AND s.created_at<?", start, endExclusive)?.total ?? 0),
    ),
    total_orders: rows.length,
    total_products_sold: totalProductsSold,
    best_products: [...products.values()].sort(
      (a, b) => b.quantity - a.quantity,
    ),
    commandes,
  };
}
export async function startLocalServer() { const host = "127.0.0.1"; const port = Number(process.env.BIMIK_LOCAL_PORT ?? 32145); const paths=resolveLocalPaths(); console.info(`CorePOS sidecar: SQLite=${paths.database}`); const app = await buildLocalApp({ logger: true, paths }); await app.listen({ host, port }); return app; }
const directLocalServerEntry = /(?:^|[\\/])local[\\/]server\.(?:[cm]?js|ts)$/i.test(process.argv[1] ?? "");
const entry = process.env.BIMIK_SIDECAR === "1" || directLocalServerEntry;
if (entry) startLocalServer().catch((error) => { console.error(error instanceof Error ? error.message : "Le service local n'a pas démarré."); process.exitCode = 1; });
