import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { ZodError, z } from "zod";
import { allowedOrigins, config } from "./config.js";
import { controlPool, db, pool } from "./db/index.js";
import {
  businesses,
  categories,
  cashRegisterSessions,
  products,
  refreshTokens,
  saleItems,
  sales,
  settings,
  stockMovements,
  users,
  menuImportSessions,
} from "./db/schema.js";
import {
  categorySchema,
  idParam,
  loginSchema,
  productSchema,
  productUpdateSchema,
  saleSchema,
  stockChangeSchema,
  stockCorrectionSchema,
  userCreateSchema,
  userUpdateSchema,
  settingsSchema,
  wifiSettingsSchema,
  menuImportRequestSchema,
  cashRegisterOpenSchema,
  cashRegisterCloseSchema,
  cashRegisterSessionQuerySchema,
} from "@bimik/validation";
import { extractPdfText, MenuPdfError } from "./menu-import/pdf.js";
import type { Role } from '@bimik/shared-types';
import { registerCoreV2Routes } from './core-v2/routes.js';
import { registerLicenseRoutes } from './license/routes.js';
import { MENU_PDF_MAX_BYTES, normalizeMatchName, parseMenuLayout } from "./menu-import/parser.js";
import { currentTenant } from './saas/tenant-context.js';
import { registerTenantRouting } from './saas/tenant-routing.js';
import { readCommercialLicenseState, resolveRuntimeBusinessIdentity } from './license/control-plane.js';
import { ensureWebSessionDevice, mobileLoginProofPayload, registerSessionDevice, touchSessionDevice, verifySessionDeviceProof, type SessionDevice } from './license/session-devices.js';
import { activationRequestIsFresh } from './license/policy.js';

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: number; sid?: number; role: Role; type: "access"; tid?: string; did?: string; dch?: "web" | "mobile" };
    user: { sub: number; sid?: number; role: Role; type: "access"; tid?: string; did?: string; dch?: "web" | "mobile" };
  }
}
const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
    ],
  },
  trustProxy: true,
  bodyLimit: 6 * 1024 * 1024,
});
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  credentials: true,

  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-Bimik-Tenant", "X-Bimik-App-Version", "X-Bimik-Device-Channel"],

  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = Object.assign(new Error("Origin not allowed"), { statusCode: 403 });
    return callback(error, false);
  },
});
await app.register(cookie);
await app.register(jwt, {
  secret: config.JWT_SECRET,
  sign: { expiresIn: config.ACCESS_TOKEN_TTL },
});
await app.register(rateLimit, { global: false });
await app.register(multipart, {
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
});
const uploadRoot = path.resolve(config.UPLOAD_DIR);
await fs.mkdir(uploadRoot, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadRoot,
  prefix: "/uploads/",
  decorateReply: false,
});

await registerTenantRouting(app, controlPool);

const mapUser = (u: any) => ({
  id: u.id,
  business_id:u.businessId,
  branch_id:u.branchId,
  name: u.name,
  email: u.email,
  role: u.role,
  is_active: u.isActive,
  created_at: u.createdAt,
  updated_at: u.updatedAt,
});
const mapCategory = (c: any) => ({
  id: c.id,
  name: c.name,
  image: c.image,
  image_url: c.image,
  is_public: c.isPublic,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
});
const mapProduct = (p: any, c?: any) => ({
  id: p.id,
  category_id: p.categoryId,
  name: p.name,
  sku:p.sku,barcode:p.barcode,unit:p.unit,tax_rate:Number(p.taxRate??0),is_public:p.isPublic,available:p.available,
  purchase_price: Number(p.purchasePrice),
  sale_price: Number(p.salePrice),
  stock: p.stock,
  min_stock: p.minStock,
  track_stock: p.trackStock,
  image: p.image,
  image_url: p.image,
  is_active: p.isActive,
  category: c ? mapCategory(c) : null,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});
const mapStockMovement = (m: any, p?: any, u?: any, c?: any) => ({
  id: m.id, product_id: m.productId, product: p ? mapProduct(p, c) : null,
  user_id: m.userId, user: u ? mapUser(u) : null, type: m.type,
  quantity: m.quantity, before_stock: m.beforeStock, after_stock: m.afterStock,
  note: m.note, created_at: m.createdAt, updated_at: m.updatedAt,
});
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// COREPOS_REMEMBERED_BUSINESS_V2
const BUSINESS_CONTEXT_COOKIE = "bimik_business_context";
const BUSINESS_CONTEXT_MAX_AGE_SECONDS = 365 * 86400;
type RememberedBusinessPayload = {
  v: 2;
  businessId: number;
  tenantId: string | null;
  expiresAt: number;
};
function businessContextSignature(payload: string) {
  return crypto
    .createHmac("sha256", config.JWT_SECRET)
    .update(`bimik-business-context-v2:${payload}`)
    .digest("base64url");
}
function encodeBusinessContext(businessId: number) {
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    businessId,
    tenantId: currentTenant()?.id ?? null,
    expiresAt: Date.now() + BUSINESS_CONTEXT_MAX_AGE_SECONDS * 1000,
  } satisfies RememberedBusinessPayload)).toString("base64url");
  return `${payload}.${businessContextSignature(payload)}`;
}
function decodeBusinessContext(raw?: string) {
  if (!raw) return null;
  try {
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = businessContextSignature(payload);
    const actualBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (
      actualBytes.length !== expectedBytes.length ||
      !crypto.timingSafeEqual(actualBytes, expectedBytes)
    ) return null;
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<RememberedBusinessPayload>;
    const tenantId = currentTenant()?.id ?? null;
    if (
      decoded.v !== 2 ||
      !Number.isInteger(decoded.businessId) ||
      Number(decoded.businessId) <= 0 ||
      !Number.isFinite(decoded.expiresAt) ||
      Number(decoded.expiresAt) <= Date.now() ||
      (config.SAAS_TENANCY_MODE === 'database_per_tenant' && decoded.tenantId !== tenantId)
    ) return null;
    return { businessId: Number(decoded.businessId), tenantId: decoded.tenantId ?? null };
  } catch {
    return null;
  }
}
function setRememberedBusiness(reply: FastifyReply, businessId: number) {
  reply.setCookie(BUSINESS_CONTEXT_COOKIE, encodeBusinessContext(businessId), {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: BUSINESS_CONTEXT_MAX_AGE_SECONDS,
  });
}
function clearRememberedBusiness(reply: FastifyReply) {
  reply.clearCookie(BUSINESS_CONTEXT_COOKIE, { path: "/api" });
}
function rememberedBusinessId(req: FastifyRequest) {
  return decodeBusinessContext(req.cookies[BUSINESS_CONTEXT_COOKIE])?.businessId ?? null;
}

const verifyPassword = (hash: string, password: string) =>
  hash.startsWith("$2")
    ? bcrypt.compare(password, hash)
    : argon2.verify(hash, password);
const uploadMimeExtensions = new Map([
  ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"],
]);
function hasImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return mime === "image/webp" && bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}
async function parseBodyWithImage(req: FastifyRequest, folder: "products" | "categories") {
  if (!req.isMultipart()) return { fields: req.body, image: null as string | null };
  const fields: Record<string, unknown> = {};
  let image: string | null = null;
  for await (const part of req.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = part.value;
      continue;
    }
    if (part.fieldname !== "image") continue;
    const extension = uploadMimeExtensions.get(part.mimetype);
    if (!extension) throw new ZodError([{ code: "custom", path: ["image"], message: "L’image doit être JPG, JPEG, PNG ou WebP." }]);
    const bytes = await part.toBuffer();
    if (!hasImageSignature(bytes, part.mimetype)) throw new ZodError([{ code: "custom", path: ["image"], message: "Le contenu du fichier image est invalide." }]);
    const tenantSlug = currentTenant()?.slug ?? null;
    const relativeFolder = tenantSlug ? path.join('tenants', tenantSlug, folder) : folder;
    const directory = path.join(uploadRoot, relativeFolder);
    await fs.mkdir(directory, { recursive: true });
    const filename = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(directory, filename), bytes, { flag: "wx" });
    image = `/uploads/${relativeFolder.replaceAll(path.sep, '/')}/${filename}`;
  }
  return { fields, image };
}
async function removeManagedImage(image?: string | null) {
  if (!image?.startsWith("/uploads/")) return;
  const relative = image.slice("/uploads/".length);
  const target = path.resolve(uploadRoot, relative);
  if (!target.startsWith(`${uploadRoot}${path.sep}`)) return;
  await fs.rm(target, { force: true });
}
const validation = (reply: FastifyReply, e: unknown) => {
  if (e instanceof ZodError)
    return reply.code(422).send({
      message: "The given data was invalid.",
      errors: e.flatten().fieldErrors,
    });
  throw e;
};
async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    if (req.user.type !== "access") throw new Error();
    if (config.SAAS_TENANCY_MODE === 'database_per_tenant') {
      const tenant = currentTenant();
      if (!tenant || req.user.tid !== tenant.id) throw new Error();
    }
    const u = await currentUser(req);
    if (!u?.isActive || u.role !== req.user.role) throw new Error();
  } catch {
    return reply.code(401).send({ message: "Unauthenticated." });
  }
}
async function patron(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (!["patron","owner","admin"].includes(req.user.role))
    return reply
      .code(403)
      .send({ message: "Only patron users can perform this action." });
}
async function currentUser(req: FastifyRequest) {
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, req.user.sub))
    .limit(1);
  return u;
}
async function issueSession(reply: FastifyReply, u: any, device: SessionDevice | null = null) {
  const tenant = currentTenant();
  if (config.SAAS_TENANCY_MODE === 'database_per_tenant' && !tenant) {
    throw Object.assign(new Error('Workspace context is required.'), { statusCode: 400, code: 'TENANT_CONTEXT_REQUIRED' });
  }
  const accessToken = app.jwt.sign({
    sub: u.id,
    role: u.role,
    type: "access",
    ...(tenant ? { tid: tenant.id } : {}),
    ...(device ? { did: device.id, dch: device.channel } : {}),
  });
  const raw = crypto.randomBytes(48).toString("base64url");
  await db.insert(refreshTokens).values({
    userId: u.id,
    tokenHash: sha(raw),
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400000),
  });
  reply.setCookie("bimik_refresh", raw, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: config.NODE_ENV === "production" ? "none" : "lax",
    path: "/api",
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400,
  });
  setRememberedBusiness(reply, u.businessId);
  return { user: mapUser(u), access_token: accessToken, token: accessToken, token_type: "Bearer" };
}
async function joinedProducts(businessId:number) {
  const rows = await db
    .select({ p: products, c: categories })
    .from(products)
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.businessId, businessId)))
    .where(eq(products.businessId,businessId))
    .orderBy(desc(products.createdAt));
  return rows.map((r) => mapProduct(r.p, r.c));
}
async function joinedStockMovements(businessId:number,productId?: number) {
  const query = db.select({ m: stockMovements, p: products, c: categories, u: users })
    .from(stockMovements)
    .innerJoin(products, and(eq(stockMovements.productId, products.id), eq(products.businessId, businessId)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.businessId, businessId)))
    .innerJoin(users, and(eq(stockMovements.userId, users.id), eq(users.businessId, businessId)));
  const rows = productId === undefined
    ? await query.where(eq(stockMovements.businessId,businessId)).orderBy(desc(stockMovements.createdAt))
    : await query.where(and(eq(stockMovements.businessId,businessId),eq(stockMovements.productId, productId))).orderBy(desc(stockMovements.createdAt));
  return rows.map(({ m, p, c, u }) => mapStockMovement(m, p, u, c));
}
async function saleDto(saleId: number,businessId:number) {
  const [s] = await db.select().from(sales).where(and(eq(sales.id,saleId),eq(sales.businessId,businessId)));
  if (!s) return null;
  const [u] = await db.select().from(users).where(and(eq(users.id, s.userId), eq(users.businessId, businessId)));
  const rows = await db
    .select({ i: saleItems, p: products, c: categories })
    .from(saleItems)
    .innerJoin(products, and(eq(saleItems.productId, products.id), eq(products.businessId, businessId)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.businessId, businessId)))
    .where(eq(saleItems.saleId, saleId));
  return {
    id: s.id,
    user_id: s.userId,
    cash_register_session_id: s.cashRegisterSessionId,
    payment_method: s.paymentMethod,
    note: s.note,
    total: Number(s.total),
    profit: Number(s.profit),
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    user: mapUser(u),
    items: rows.map(({ i, p, c }) => ({
      id: i.id,
      sale_id: i.saleId,
      product_id: i.productId,
      quantity: i.quantity,
      unit_price: Number(i.unitPrice),
      purchase_price: Number(i.purchasePrice),
      total: Number(i.total),
      profit: Number(i.profit),
      product: mapProduct(p, c),
    })),
  };
}
async function productManager(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (!["patron", "owner", "admin", "manager", "stock_manager"].includes(req.user.role))
    return reply.code(403).send({ message: "Product management permission required." });
}
async function dashboardReader(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (!['patron', 'owner', 'admin', 'manager'].includes(req.user.role))
    return reply.code(403).send({ message: 'Dashboard access is not permitted.' });
}
async function cashManager(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  if (!['patron', 'owner', 'admin', 'manager', 'worker', 'cashier'].includes(req.user.role))
    return reply.code(403).send({ message: 'Cash register access is not permitted.' });
}

app.addHook('preHandler',async(req,reply)=>{
  if(['GET','HEAD','OPTIONS'].includes(req.method)||process.env.LICENSE_MODE==='development'&&process.env.NODE_ENV!=='production')return;
  const route=req.url.split('?')[0];
  if(['/api/login','/api/logout','/api/auth/refresh','/api/auth/business-context/forget','/api/setup'].includes(route)||route.startsWith('/api/vendor/')||route.startsWith('/api/provision')||route.startsWith('/api/license/')||route.startsWith('/api/public/'))return;
  if(!req.headers.authorization)return;
  try{await req.jwtVerify();}catch{return reply.code(401).send({message:'Unauthenticated.'});}
  const user=await currentUser(req);
  if(!user?.businessId)return reply.code(401).send({message:'Unauthenticated.'});
  const identity=await resolveRuntimeBusinessIdentity(pool,user.businessId);
  const state=identity?await readCommercialLicenseState(controlPool,identity.vendorBusinessId):null;
  if(state?.vendor_business_status==='active'&&state.license_status==='active'&&(!state.expires_at||Date.parse(state.expires_at)>Date.now()))return;
  const code=state?.vendor_business_status&&state.vendor_business_status!=='active'?'VENDOR_BUSINESS_INACTIVE':state?.license_status==='revoked'?'LICENSE_REVOKED':state?.expires_at&&Date.parse(state.expires_at)<=Date.now()?'LICENSE_EXPIRED':'LICENSE_INACTIVE';
  return reply.code(403).send({message:'The business licence does not permit operational writes.',code});
});

app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async (_req, reply) => {
  try {
    await controlPool.query("select 1");
    return { status: "ready", database: "ok", tenancy: config.SAAS_TENANCY_MODE };
  } catch {
    return reply.code(503).send({ status: "not-ready" });
  }
});
app.post(
  "/api/login",
  { config: { rateLimit: { max: config.NODE_ENV === "test" ? 1000 : 5, timeWindow: "1 minute" } } },
  async (req, reply) => {
    try {
      const input = loginSchema.parse(req.body);
      const [u] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (
        !u ||
        !u.isActive ||
        !(await verifyPassword(u.password, input.password))
      )
        return reply.code(422).send({
          message: "The given data was invalid.",
          errors: { email: ["The provided credentials are incorrect."] },
        });
      const device = await ensureWebSessionDevice({
        controlPool,
        operationalPool: pool,
        merchant: { id: u.id, businessId: u.businessId, role: u.role },
        request: req,
        reply,
      });
      return issueSession(reply, u, device);
    } catch (e) {
      return validation(reply, e);
    }
  },
);
// Native mobile login is device-bound. The request must be signed by the
// device private key before a mobile slot is allocated. The mobile app may
// reuse the standard access-token + refresh-cookie flow with a cookie jar.
app.post(
  "/api/auth/mobile/login",
  { config: { rateLimit: { max: config.NODE_ENV === "test" ? 1000 : 5, timeWindow: "1 minute" } } },
  async (req, reply) => {
    try {
      const input = z.object({
        email: z.string().email(),
        password: z.string().min(1),
        installation_id: z.string().uuid(),
        device_public_key: z.string().min(40).max(5000),
        device_name: z.string().trim().min(1).max(200),
        app_version: z.string().trim().min(1).max(100),
        platform: z.string().trim().min(1).max(80).default('mobile'),
        nonce: z.string().min(16).max(200),
        requested_at: z.string().datetime(),
        device_proof: z.string().min(40).max(500),
      }).strict().parse(req.body);

      if (!activationRequestIsFresh(input.requested_at, 10 * 60_000)) {
        return reply.code(422).send({
          message: 'Mobile login timestamp is outside the allowed window.',
          code: 'DEVICE_REQUEST_STALE',
        });
      }
      if (!verifySessionDeviceProof(input.device_public_key, mobileLoginProofPayload(input), input.device_proof)) {
        return reply.code(403).send({
          message: 'Mobile device proof is invalid.',
          code: 'DEVICE_PROOF_INVALID',
        });
      }

      const [u] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      if (!u || !u.isActive || !(await verifyPassword(u.password, input.password))) {
        return reply.code(422).send({
          message: 'The given data was invalid.',
          errors: { email: ['The provided credentials are incorrect.'] },
        });
      }

      const device = await registerSessionDevice({
        controlPool,
        operationalPool: pool,
        merchant: { id: u.id, businessId: u.businessId, role: u.role },
        reply,
        installationId: input.installation_id,
        channel: 'mobile',
        devicePublicKey: input.device_public_key,
        deviceName: input.device_name,
        appVersion: input.app_version,
        platform: input.platform,
      });

      return issueSession(reply, u, device);
    } catch (e) {
      return validation(reply, e);
    }
  },
);

// COREPOS_MULTI_TENANT_LOGIN_V1
app.get("/api/auth/login-context", async (req, reply) => {
  if (config.SAAS_TENANCY_MODE === 'database_per_tenant' && !currentTenant()) {
    return {
      data: {
        mode: "cloud",
        profile_picker: false,
        requires_workspace: true,
        business: null,
      },
    };
  }

  const businessId = rememberedBusinessId(req);
  if (!businessId) {
    return {
      data: {
        mode: "cloud",
        profile_picker: false,
        requires_workspace: false,
        business: null,
      },
    };
  }

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      logo: businesses.logo,
      businessType: businesses.businessType,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    clearRememberedBusiness(reply);
    return {
      data: {
        mode: "cloud",
        profile_picker: false,
        requires_workspace: false,
        business: null,
      },
    };
  }

  return {
    data: {
      mode: "cloud",
      profile_picker: true,
      requires_workspace: false,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        logo: business.logo,
        business_type: business.businessType,
      },
    },
  };
});

// A cloud browser may enumerate profiles only after it owns a valid,
// server-signed remembered-business cookie created by a successful login.
app.get("/api/login-profiles", async (req, reply) => {
  const businessId = rememberedBusinessId(req);
  if (!businessId) return reply.code(404).send({ message: "Not found." });

  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.businessId, businessId),
        eq(users.isActive, true),
        inArray(users.role, ["patron","worker","owner","admin","manager","cashier","seller","waiter","kitchen","stock_manager"]),
      ),
    )
    .orderBy(asc(users.name));

  return { data: rows.map(mapUser) };
});

app.post("/api/auth/business-context/forget", async (_req, reply) => {
  clearRememberedBusiness(reply);
  return { message: "Business context forgotten." };
});
app.post(
  "/api/register",
  { preHandler: config.ALLOW_PUBLIC_REGISTRATION ? undefined : patron },
  async (req, reply) => {
    try {
      const v = userCreateSchema.parse(req.body);
      const [u] = await db
        .insert(users)
        .values({
          name: v.name,
          email: v.email,
          password: await argon2.hash(v.password),
          role: v.role,
          isActive: v.is_active,
        })
        .returning();
      const device = await ensureWebSessionDevice({
        controlPool,
        operationalPool: pool,
        merchant: { id: u.id, businessId: u.businessId, role: u.role },
        request: req,
        reply,
      });
      return reply.code(201).send(await issueSession(reply, u, device));
    } catch (e) {
      return validation(reply, e);
    }
  },
);
app.post("/api/auth/refresh", async (req, reply) => {
  const raw = req.cookies.bimik_refresh;
  if (!raw) return reply.code(401).send({ message: "Unauthenticated." });
  const u = await db.transaction(async (tx) => {
    const [rotated] = await tx.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, sha(raw)), isNull(refreshTokens.revokedAt), gte(refreshTokens.expiresAt, new Date())))
      .returning({ userId: refreshTokens.userId });
    if (!rotated) return null;
    const [activeUser] = await tx.select().from(users)
      .where(and(eq(users.id, rotated.userId), eq(users.isActive, true))).limit(1);
    return activeUser ?? null;
  });
  if (!u) return reply.code(401).send({ message: "Unauthenticated." });
  const device = await touchSessionDevice({
    controlPool,
    operationalPool: pool,
    merchant: { id: u.id, businessId: u.businessId, role: u.role },
    request: req,
  });
  return issueSession(reply, u, device);
});
app.post("/api/logout", async (req, reply) => {
  const raw = req.cookies.bimik_refresh;
  if (raw)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, sha(raw)));
  reply.clearCookie("bimik_refresh", { path: "/api" });
  return { message: "Logged out successfully." };
});
app.get("/api/user", { preHandler: authenticate }, async (req) =>
  mapUser(await currentUser(req)),
);

app.get("/api/categories", { preHandler: authenticate }, async req => {const u=await currentUser(req);return {data:(await db.select().from(categories).where(eq(categories.businessId,u!.businessId)).orderBy(desc(categories.createdAt))).map(mapCategory)}});
app.get(
  "/api/categories/:id",
  { preHandler: authenticate },
  async (req, reply) => {
    const id = idParam.parse((req.params as any).id);
    const u=await currentUser(req);const [c] = await db.select().from(categories).where(and(eq(categories.id,id),eq(categories.businessId,u!.businessId)));
    return c
      ? { data: mapCategory(c) }
      : reply.code(404).send({ message: "Not found." });
  },
);
app.post("/api/categories", { preHandler: patron }, async (req, reply) => {
  let uploaded: string | null = null;
  try {
    const parsed = await parseBodyWithImage(req, "categories");
    uploaded = parsed.image;
    const v = categorySchema.parse(parsed.fields);const {is_public,...category}=v;
    const u=await currentUser(req);const [c] = await db.insert(categories).values({ businessId:u!.businessId,...category,isPublic:is_public??true, image: uploaded ?? v.image }).returning();
    return reply.code(201).send({ data: mapCategory(c) });
  } catch (e) {
    await removeManagedImage(uploaded);
    return validation(reply, e);
  }
});
async function updateCategory(req: FastifyRequest, reply: FastifyReply) {
  let uploaded: string | null = null;
  try {
    const id = idParam.parse((req.params as any).id);
    const u=await currentUser(req);const [old] = await db.select().from(categories).where(and(eq(categories.id,id),eq(categories.businessId,u!.businessId))).limit(1);
    if (!old) return reply.code(404).send({ message: "Not found." });
    const parsed = await parseBodyWithImage(req, "categories");
    uploaded = parsed.image;
    const v = categorySchema.parse(parsed.fields);const {is_public,...category}=v;
    const [c] = await db
      .update(categories)
      .set({ ...category,isPublic:is_public??old.isPublic, image: uploaded ?? old.image, updatedAt: new Date() })
      .where(and(eq(categories.id,id),eq(categories.businessId,u!.businessId)))
      .returning();
    if (uploaded) await removeManagedImage(old.image);
    return { data: mapCategory(c) };
  } catch (e) {
    await removeManagedImage(uploaded);
    return validation(reply, e);
  }
}
app.put("/api/categories/:id", { preHandler: patron }, updateCategory);
app.post("/api/categories/:id", { preHandler: patron }, updateCategory);
app.delete("/api/categories/:id", { preHandler: patron }, async (req) => {
  const id = idParam.parse((req.params as any).id);
  const u=await currentUser(req);const [deleted] = await db.delete(categories).where(and(eq(categories.id,id),eq(categories.businessId,u!.businessId))).returning();
  await removeManagedImage(deleted?.image);
  return { message: "Category deleted successfully." };
});

app.get("/api/products", { preHandler: authenticate }, async req => ({data:await joinedProducts((await currentUser(req))!.businessId)}));
app.get("/api/products-low-stock", { preHandler: authenticate }, async (req) => {
  const all = await joinedProducts((await currentUser(req))!.businessId);
  return {
    data: all
      .filter((p) => p.track_stock && p.stock <= p.min_stock)
      .sort((a, b) => a.stock - b.stock),
  };
});
app.get(
  "/api/products/:id",
  { preHandler: authenticate },
  async (req, reply) => {
    const id = idParam.parse((req.params as any).id);
    const all = await joinedProducts((await currentUser(req))!.businessId);
    const p = all.find((x) => x.id === id);
    return p ? { data: p } : reply.code(404).send({ message: "Not found." });
  },
);
app.post("/api/products", { preHandler: productManager }, async (req, reply) => {
  let uploaded: string | null = null;
  try {
    const parsed = await parseBodyWithImage(req, "products");
    uploaded = parsed.image;
    const v = productSchema.parse(parsed.fields);
    const u=await currentUser(req);const [p] = await db
      .insert(products)
      .values({
        businessId:u!.businessId,
        categoryId: v.category_id,
        name: v.name,
        sku:v.sku,barcode:v.barcode,unit:v.unit,taxRate:String(v.tax_rate),isPublic:v.is_public,available:v.available,
        purchasePrice: "0",
        salePrice: String(v.sale_price),
        stock: v.stock,
        minStock: v.min_stock,
        trackStock: v.track_stock,
        image: uploaded ?? v.image,
        isActive: v.is_active,
      })
      .returning();
    const all = await joinedProducts(u!.businessId);
    return reply.code(201).send({ data: all.find((x) => x.id === p.id) });
  } catch (e) {
    await removeManagedImage(uploaded);
    return validation(reply, e);
  }
});
async function updateProduct(req: FastifyRequest, reply: FastifyReply) {
  let uploaded: string | null = null;
  try {
    const id = idParam.parse((req.params as any).id);
    const u=await currentUser(req);const [old] = await db.select().from(products).where(and(eq(products.id,id),eq(products.businessId,u!.businessId))).limit(1);
    if (!old) return reply.code(404).send({ message: "Not found." });
    const parsed = await parseBodyWithImage(req, "products");
    uploaded = parsed.image;
    const v = productUpdateSchema.parse(parsed.fields);
    await db
      .update(products)
      .set({
        categoryId: v.category_id,
        name: v.name,
        sku:v.sku,barcode:v.barcode,unit:v.unit,taxRate:v.tax_rate===undefined?undefined:String(v.tax_rate),isPublic:v.is_public,available:v.available,
        salePrice:
          v.sale_price === undefined ? undefined : String(v.sale_price),
        stock: v.stock,
        minStock: v.min_stock,
        trackStock: v.track_stock,
        image: uploaded ?? v.image,
        isActive: v.is_active,
        updatedAt: new Date(),
      })
      .where(and(eq(products.id,id),eq(products.businessId,u!.businessId)));
    if (uploaded) await removeManagedImage(old.image);
    const all = await joinedProducts(u!.businessId);
    return { data: all.find((x) => x.id === id) };
  } catch (e) {
    await removeManagedImage(uploaded);
    return validation(reply, e);
  }
}
app.put("/api/products/:id", { preHandler: patron }, updateProduct);
app.post("/api/products/:id", { preHandler: patron }, updateProduct);
app.delete("/api/products/:id", { preHandler: patron }, async (req, reply) => {
  try {
    const u=await currentUser(req);const [deleted] = await db
      .delete(products)
      .where(and(eq(products.id,idParam.parse((req.params as any).id)),eq(products.businessId,u!.businessId))).returning();
    await removeManagedImage(deleted?.image);
    return { message: "Product deleted successfully." };
  } catch {
    return reply.code(422).send({
      message:
        "Product cannot be deleted because it has sales or stock movements.",
    });
  }
});

async function changeStock(
  req: FastifyRequest,
  reply: FastifyReply,
  kind: "in" | "out" | "correction",
) {
  try {
    const id = idParam.parse((req.params as any).id);
    const v =
      kind === "correction"
        ? stockCorrectionSchema.parse(req.body)
        : stockChangeSchema.parse(req.body);
    return await db.transaction(async (tx) => {
      const u=await currentUser(req);const locked = await tx.execute(
        sql`select * from products where id=${id} and business_id=${u!.businessId} for update`,
      );
      const p = (locked.rows as any[])[0];
      if (!p) return reply.code(404).send({ message: "Not found." });
      if (!p.track_stock) return reply.code(422).send({ message: "Le suivi du stock est désactivé pour ce produit." });
      const before = Number(p.stock);
      const after =
        kind === "correction"
          ? (v as any).stock
          : kind === "in"
            ? before + (v as any).quantity
            : before - (v as any).quantity;
      if (after < 0)
        return reply.code(422).send({
          message: `Insufficient stock for ${p.name}.`,
          product: p.name,
        });
      await tx
        .update(products)
        .set({ stock: after, updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.businessId, u!.businessId)));
      const [m] = await tx
        .insert(stockMovements)
        .values({
          businessId:u!.businessId,branchId:u!.branchId,
          productId: id,
          userId: req.user.sub,
          type: kind,
          quantity:
            kind === "correction"
              ? Math.abs(after - before)
              : (v as any).quantity,
          beforeStock: before,
          afterStock: after,
          note: v.note ?? null,
        })
        .returning();
      const [updated] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.businessId, u!.businessId)));
      const [category] = updated.categoryId ? await tx.select().from(categories).where(and(eq(categories.id, updated.categoryId), eq(categories.businessId, u!.businessId))) : [null];
      const [movementUser] = await tx.select().from(users).where(and(eq(users.id, req.user.sub), eq(users.businessId, u!.businessId)));
      return {
        message:
          kind === "in"
            ? "Stock increased successfully."
            : kind === "out"
              ? "Stock decreased successfully."
              : "Stock corrected successfully.",
        product: mapProduct(updated, category),
        movement: mapStockMovement(m, updated, movementUser, category),
      };
    });
  } catch (e) {
    return validation(reply, e);
  }
}
app.get("/api/stock-movements", { preHandler: authenticate }, async req => ({data:await joinedStockMovements((await currentUser(req))!.businessId)}));
app.get(
  "/api/products/:id/stock-movements",
  { preHandler: authenticate },
  async (req) => ({
    data: await joinedStockMovements((await currentUser(req))!.businessId,idParam.parse((req.params as any).id)),
  }),
);

function cafeBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: config.TZ, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
async function cashSessionDto(id:number,businessId:number) {
  const [row]=await db.select({session:cashRegisterSessions,opener:users}).from(cashRegisterSessions)
    .innerJoin(users,and(eq(cashRegisterSessions.openedByUserId,users.id),eq(users.businessId,businessId)))
    .where(and(eq(cashRegisterSessions.id,id),eq(cashRegisterSessions.businessId,businessId))).limit(1);
  if(!row)return null;
  const [closer]=row.session.closedByUserId?await db.select().from(users).where(and(eq(users.id,row.session.closedByUserId),eq(users.businessId,businessId))).limit(1):[null];
  const [totals]=await db.select({
    salesTotal:sql<string>`coalesce(sum(${sales.total}),0)`,
    cashTotal:sql<string>`coalesce(sum(case when lower(${sales.paymentMethod}) in ('cash','espèces','especes') then ${sales.total} else 0 end),0)`,
    orders:sql<number>`count(*)::int`,
  }).from(sales).where(and(eq(sales.cashRegisterSessionId,id),eq(sales.businessId,businessId)));
  const methods=await db.select({method:sales.paymentMethod,total:sql<string>`sum(${sales.total})`}).from(sales)
    .where(and(eq(sales.cashRegisterSessionId,id),eq(sales.businessId,businessId),sql`lower(${sales.paymentMethod}) not in ('cash','espèces','especes')`)).groupBy(sales.paymentMethod);
  const workerTotals=await db.select({userId:users.id,name:users.name,total:sql<string>`sum(${sales.total})`,orders:sql<number>`count(*)::int`})
    .from(sales).innerJoin(users,and(eq(sales.userId,users.id),eq(users.businessId,businessId)))
    .where(and(eq(sales.cashRegisterSessionId,id),eq(sales.businessId,businessId))).groupBy(users.id,users.name).orderBy(users.name);
  const [quantity]=await db.select({total:sql<number>`coalesce(sum(${saleItems.quantity}),0)::int`}).from(saleItems)
    .innerJoin(sales,and(eq(saleItems.saleId,sales.id),eq(sales.businessId,businessId))).where(eq(sales.cashRegisterSessionId,id));
  const expected=Number(row.session.expectedCash??(Number(row.session.openingCash)+Number(totals.cashTotal)));
  return {id:row.session.id,business_date:row.session.businessDate,status:row.session.status,opened_at:row.session.openedAt,
    opened_by:mapUser(row.opener),opening_cash:Number(row.session.openingCash),opening_note:row.session.openingNote,
    closed_at:row.session.closedAt,closed_by:closer?mapUser(closer):null,expected_cash:expected,
    actual_cash:row.session.actualCash===null?null:Number(row.session.actualCash),difference:row.session.difference===null?null:Number(row.session.difference),
    closing_note:row.session.closingNote,sales_total:Number(totals.salesTotal),cash_sales_total:Number(totals.cashTotal),
    non_cash_totals:Object.fromEntries(methods.map((method)=>[method.method,Number(method.total)])),total_orders:totals.orders,
    total_products_sold:quantity.total,sales_by_worker:workerTotals.map((worker)=>({user_id:worker.userId,name:worker.name,total:Number(worker.total),orders:worker.orders})),
    provisional:row.session.status==="open"};
}

app.get("/api/cash-register/current",{preHandler:authenticate},async(req)=>{const u=await currentUser(req);
  const [session]=await db.select().from(cashRegisterSessions).where(and(eq(cashRegisterSessions.businessId,u!.businessId),eq(cashRegisterSessions.status,"open"))).limit(1);
  return {data:session?await cashSessionDto(session.id,u!.businessId):null};
});
app.post("/api/cash-register/open",{preHandler:cashManager},async(req,reply)=>{
  const u=await currentUser(req);
  try{
    const input=cashRegisterOpenSchema.parse(req.body);
    const [created]=await db.insert(cashRegisterSessions).values({businessId:u!.businessId,branchId:u!.branchId,businessDate:cafeBusinessDate(),openedByUserId:req.user.sub,
      openingCash:input.opening_cash,openingNote:input.opening_note??null}).returning();
    return reply.code(201).send({data:await cashSessionDto(created.id,u!.businessId)});
  }catch(error){
    const pgCode=(error as {code?:string;cause?:{code?:string}})?.code??(error as {cause?:{code?:string}})?.cause?.code;
    if(pgCode==="23505"){
      const branchCondition=u!.branchId===null?isNull(cashRegisterSessions.branchId):eq(cashRegisterSessions.branchId,u!.branchId);
      const [existing]=await db.select().from(cashRegisterSessions)
        .where(and(eq(cashRegisterSessions.businessId,u!.businessId),branchCondition,eq(cashRegisterSessions.status,"open"))).limit(1);
      return reply.code(409).send({message:"Une caisse est déjà ouverte.",data:existing?await cashSessionDto(existing.id,u!.businessId):null});
    }
    return validation(reply,error);
  }
});
app.post("/api/cash-register/close",{preHandler:cashManager},async(req,reply)=>{
  try{
    const input=cashRegisterCloseSchema.parse(req.body);
    const u=await currentUser(req);const id=await db.transaction(async(tx)=>{
      const [session]=await tx.select().from(cashRegisterSessions).where(and(eq(cashRegisterSessions.businessId,u!.businessId),eq(cashRegisterSessions.status,"open"))).for("update").limit(1);
      if(!session)return null;
      const [totals]=await tx.select({cash:sql<string>`coalesce(sum(case when lower(${sales.paymentMethod}) in ('cash','espèces','especes') then ${sales.total} else 0 end),0)`})
        .from(sales).where(eq(sales.cashRegisterSessionId,session.id));
      const expectedCents=Math.round(Number(session.openingCash)*100)+Math.round(Number(totals.cash)*100);
      const actualCents=Math.round(Number(input.actual_cash)*100);
      await tx.update(cashRegisterSessions).set({status:"closed",closedAt:new Date(),closedByUserId:req.user.sub,
        expectedCash:(expectedCents/100).toFixed(2),actualCash:(actualCents/100).toFixed(2),difference:((actualCents-expectedCents)/100).toFixed(2),
        closingNote:input.closing_note??null,updatedAt:new Date()}).where(and(eq(cashRegisterSessions.id,session.id),eq(cashRegisterSessions.status,"open")));
      return session.id;
    });
    if(!id)return reply.code(422).send({message:"Aucune caisse ouverte à fermer."});
    return {data:await cashSessionDto(id,u!.businessId)};
  }catch(error){return validation(reply,error);}
});
app.get("/api/cash-register/sessions",{preHandler:patron},async(req)=>{
  const query=cashRegisterSessionQuerySchema.parse(req.query);
  const u=await currentUser(req);const conditions=[eq(cashRegisterSessions.businessId,u!.businessId)];
  if(query.business_date)conditions.push(eq(cashRegisterSessions.businessDate,query.business_date));
  if(query.status)conditions.push(eq(cashRegisterSessions.status,query.status));
  if(query.user_id)conditions.push(sql`(${cashRegisterSessions.openedByUserId}=${query.user_id} or ${cashRegisterSessions.closedByUserId}=${query.user_id})`);
  const rows=await db.select({id:cashRegisterSessions.id}).from(cashRegisterSessions)
    .where(conditions.length?and(...conditions):undefined).orderBy(desc(cashRegisterSessions.openedAt));
  return {data:await Promise.all(rows.map((row)=>cashSessionDto(row.id,u!.businessId)))};
});
app.get("/api/cash-register/sessions/:id",{preHandler:patron},async(req,reply)=>{const u=await currentUser(req);
  const result=await cashSessionDto(idParam.parse((req.params as any).id),u!.businessId);
  return result?{data:result}:reply.code(404).send({message:"Session de caisse introuvable."});
});
app.post(
  "/api/products/:id/stock/increase",
  { preHandler: authenticate },
  (req, reply) => changeStock(req, reply, "in"),
);
app.post(
  "/api/products/:id/stock/decrease",
  { preHandler: authenticate },
  (req, reply) => changeStock(req, reply, "out"),
);
app.post(
  "/api/products/:id/stock/correction",
  { preHandler: patron },
  (req, reply) => changeStock(req, reply, "correction"),
);

app.get("/api/sales", { preHandler: authenticate }, async req => {const u=await currentUser(req);return {
  data: await Promise.all(
    (
      await db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.businessId,u!.businessId))
        .orderBy(desc(sales.createdAt))
    ).map((s) => saleDto(s.id,u!.businessId)),
  ),
}});
app.get("/api/sales/:id", { preHandler: authenticate }, async (req, reply) => {
  const u=await currentUser(req);const s = await saleDto(idParam.parse((req.params as any).id),u!.businessId);
  return s ? { data: s } : reply.code(404).send({ message: "Not found." });
});
app.post("/api/sales", { preHandler: authenticate }, async (req, reply) => {
  try {
    const v = saleSchema.parse(req.body);const u=await currentUser(req);
    const grouped = new Map<number, number>();
    for (const i of v.items)
      grouped.set(i.product_id, (grouped.get(i.product_id) ?? 0) + i.quantity);
    const result = await db.transaction(async (tx) => {
      const [cashSession]=await tx.select().from(cashRegisterSessions).where(and(eq(cashRegisterSessions.businessId,u!.businessId),eq(cashRegisterSessions.status,"open"))).for("share").limit(1);
      if(!cashSession)throw new Error("Ouvrez la caisse avant d’enregistrer une vente.");
      const ids = [...grouped.keys()].sort((a, b) => a - b);
      const selected = await tx.select().from(products).where(and(eq(products.businessId,u!.businessId),inArray(products.id,ids)));
      const selectedById = new Map(selected.map((p) => [p.id, p]));
      for (const id of ids) if (!selectedById.has(id)) throw new Error(`Product ${id} was not found.`);
      const trackedIds = selected.filter((p) => p.trackStock).map((p) => p.id).sort((a,b) => a-b);
      const locked = trackedIds.length ? await tx.select().from(products).where(and(eq(products.businessId,u!.businessId),inArray(products.id, trackedIds))).orderBy(asc(products.id)).for("update") : [];
      const ps = new Map(selected.map((p) => [p.id, p]));
      for (const product of locked) ps.set(product.id, product);
      for (const [id, q] of grouped) {
        const p = ps.get(id);
        if (!p) throw new Error(`Product ${id} was not found.`);
        if (p.trackStock && p.stock < q)
          throw new Error(
            `Insufficient stock for ${p.name}. Available stock: ${p.stock}.`,
          );
      }
      const [s] = await tx
        .insert(sales)
        .values({
          businessId:u!.businessId,branchId:u!.branchId,
          userId: req.user.sub,
          cashRegisterSessionId: cashSession.id,
          paymentMethod: v.payment_method ?? "cash",
          note: v.note ?? null,
          total: "0",
          profit: "0",
        })
        .returning();
      let total = 0,
        profit = 0;
      for (const [id, q] of grouped) {
        const p = ps.get(id)!;
        const price = Number(p.salePrice),
          line = money(price * q),
          lineProfit = money(price * q),
          after = p.trackStock ? p.stock - q : p.stock;
        await tx.insert(saleItems).values({
          saleId: s.id,
          productId: id,
          quantity: q,
          unitPrice: String(price),
          purchasePrice: "0",
          total: String(line),
          profit: String(lineProfit),
        });
        if (p.trackStock) {
          await tx.update(products).set({ stock: after, updatedAt: new Date() }).where(eq(products.id, id));
          await tx.insert(stockMovements).values({businessId:u!.businessId,branchId:u!.branchId, productId: id, userId: req.user.sub, type: "sale", quantity: q, beforeStock: p.stock, afterStock: after, note: `Sale #${s.id}` });
        }
        total += line;
        profit += lineProfit;
      }
      await tx
        .update(sales)
        .set({
          total: String(money(total)),
          profit: String(money(profit)),
          updatedAt: new Date(),
        })
        .where(eq(sales.id, s.id));
      return s.id;
    });
    return reply.code(201).send({ data: await saleDto(result,u!.businessId) });
  } catch (e) {
    if (e instanceof Error && !(e instanceof ZodError))
      return reply.code(422).send({
        message: "The given data was invalid.",
        errors: { items: [e.message] },
      });
    return validation(reply, e);
  }
});
app.post(
  "/api/sales/:id/print-ticket",
  { preHandler: authenticate },
  async (_req, reply) =>
    reply.code(409).send({
      message:
        "Printing is performed locally by the CorePOS desktop client.",
    }),
);


async function reportPayload(
  start: Date | null,
  end: Date | null,
  period: Record<string, unknown>,
  workerId: number | null,
  sessionId: number | null,
  businessId: number,
) {
  const conditions = [eq(sales.businessId, businessId)];

  if (sessionId) {
    conditions.push(eq(sales.cashRegisterSessionId, sessionId));
  } else if (start && end) {
    conditions.push(
      gte(sales.createdAt, start),
      lte(sales.createdAt, end),
    );
  } else {
    conditions.push(sql`false`);
  }

  if (workerId) {
    conditions.push(eq(sales.userId, workerId));
  }

  const rows = await db
    .select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt));

  const commandes = (
    await Promise.all(
      rows.map((sale) => saleDto(sale.id, businessId)),
    )
  ).filter((sale) => sale !== null);

  const productTotals = new Map<
    number,
    { product_id: number; name: string; quantity: number; total: number }
  >();

  let totalProductsSold = 0;

  for (const sale of commandes) {
    for (const item of sale.items) {
      totalProductsSold += Number(item.quantity);

      const current = productTotals.get(item.product_id) ?? {
        product_id: item.product_id,
        name: item.product?.name ?? `Produit #${item.product_id}`,
        quantity: 0,
        total: 0,
      };

      current.quantity += Number(item.quantity);
      current.total = money(current.total + Number(item.total));
      productTotals.set(item.product_id, current);
    }
  }

  return {
    period,
    total_sales: money(
      rows.reduce((total, sale) => total + Number(sale.total), 0),
    ),
    total_orders: rows.length,
    total_products_sold: totalProductsSold,
    best_products: [...productTotals.values()].sort(
      (a, b) => b.quantity - a.quantity,
    ),
    commandes,
  };
}
app.get("/api/dashboard", { preHandler: dashboardReader }, async (req) => {const u=await currentUser(req);
  const [openSession]=await db.select().from(cashRegisterSessions).where(and(eq(cashRegisterSessions.businessId,u!.businessId),eq(cashRegisterSessions.status,"open"))).limit(1);
  const [agg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      revenue: sql<string>`coalesce(sum(${sales.total}),0)`,
    })
    .from(sales)
    .where(openSession?eq(sales.cashRegisterSessionId,openSession.id):sql`false`);
  const low = (await joinedProducts(u!.businessId)).filter((product) => product.track_stock && product.stock <= product.min_stock)
    .sort((a, b) => a.stock - b.stock)
    .map((product) => ({ id: product.id, name: product.name, stock_quantity: product.stock,
      min_stock: product.min_stock, category_name: product.category?.name ?? null }));
  return {
    today_sales: Number(agg.revenue),
    today_tickets: agg.count,
    low_stock_count: low.length,
    low_stock_products: low,
  };
});

app.get("/api/reports/today", { preHandler: patron }, async (req) => {
  const u = await currentUser(req);
  const query = req.query as { worker_id?: string };
  const workerId = query.worker_id ? Number(query.worker_id) : null;

  const [session] = await db
    .select()
    .from(cashRegisterSessions)
    .where(eq(cashRegisterSessions.businessId, u!.businessId))
    .orderBy(desc(cashRegisterSessions.openedAt))
    .limit(1);

  let workerName: string | null = null;

  if (workerId) {
    const [worker] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, workerId),
          eq(users.businessId, u!.businessId),
        ),
      )
      .limit(1);

    workerName = worker?.name ?? null;
  }

  const report = await reportPayload(
    null,
    null,
    {
      type: "cash_register_session",
      date: session?.businessDate ?? cafeBusinessDate(),
      start: session?.openedAt.toISOString() ?? new Date().toISOString(),
      end: (session?.closedAt ?? new Date()).toISOString(),
      session_id: session?.id ?? null,
      status: session?.status ?? "closed",
      provisional: session?.status === "open",
      worker_id: workerId,
      worker_name: workerName,
    },
    workerId,
    session?.id ?? null,
    u!.businessId,
  );

  return {
    ...report,
    session: session
      ? await cashSessionDto(session.id, u!.businessId)
      : null,
  };
});

app.get("/api/reports/cash-register", { preHandler: patron }, async (req, reply) => {
  const u = await currentUser(req);
  const query = req.query as {
    session_id?: string;
    worker_id?: string;
  };

  const requestedSessionId =
    query.session_id === undefined ? null : Number(query.session_id);

  const workerId =
    query.worker_id === undefined ? null : Number(query.worker_id);

  if (
    requestedSessionId !== null &&
    (!Number.isInteger(requestedSessionId) || requestedSessionId <= 0)
  ) {
    return reply.code(422).send({
      message: "Session de caisse invalide.",
    });
  }

  if (
    workerId !== null &&
    (!Number.isInteger(workerId) || workerId <= 0)
  ) {
    return reply.code(422).send({
      message: "Utilisateur invalide.",
    });
  }

  const [session] = await db
    .select()
    .from(cashRegisterSessions)
    .where(
      requestedSessionId !== null
        ? and(
            eq(cashRegisterSessions.id, requestedSessionId),
            eq(cashRegisterSessions.businessId, u!.businessId),
          )
        : eq(cashRegisterSessions.businessId, u!.businessId),
    )
    .orderBy(desc(cashRegisterSessions.openedAt))
    .limit(1);

  if (requestedSessionId !== null && !session) {
    return reply.code(404).send({
      message: "Session de caisse introuvable.",
    });
  }

  let workerName: string | null = null;

  if (workerId !== null) {
    const [worker] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, workerId),
          eq(users.businessId, u!.businessId),
        ),
      )
      .limit(1);

    if (!worker) {
      return reply.code(404).send({
        message: "Utilisateur introuvable.",
      });
    }

    workerName = worker.name;
  }

  const report = await reportPayload(
    null,
    null,
    {
      type: "cash_register_session",
      date: session?.businessDate ?? cafeBusinessDate(),
      start: session?.openedAt.toISOString() ?? null,
      end: session
        ? (session.closedAt ?? new Date()).toISOString()
        : null,
      session_id: session?.id ?? null,
      status: session?.status ?? "none",
      provisional: session?.status === "open",
      worker_id: workerId,
      worker_name: workerName,
    },
    workerId,
    session?.id ?? null,
    u!.businessId,
  );

  const sessionDto = session
    ? await cashSessionDto(session.id, u!.businessId)
    : null;

  return {
    ...report,
    cash_register_session: sessionDto,
    session: sessionDto,
  };
});

/* Compatibility endpoint kept for older clients. */
app.get("/api/cash-register/sessions/:id/report", { preHandler: patron }, async (req, reply) => {
  const u = await currentUser(req);
  const id = idParam.parse((req.params as any).id);

  const session = await cashSessionDto(id, u!.businessId);

  if (!session) {
    return reply.code(404).send({
      message: "Session de caisse introuvable.",
    });
  }

  const report = await reportPayload(
    null,
    null,
    {
      type: "cash_register_session",
      date: session.business_date,
      start: String(session.opened_at),
      end: String(session.closed_at ?? new Date().toISOString()),
      session_id: id,
      status: session.status,
      provisional: session.provisional,
    },
    null,
    id,
    u!.businessId,
  );

  return {
    ...report,
    session,
  };
});
app.get("/api/reports/monthly", { preHandler: patron }, async (req) => {
  const u = await currentUser(req);
  const query = req.query as { month?: string };
  const requestedMonth =
    query.month && /^\d{4}-\d{2}$/.test(query.month)
      ? query.month
      : new Date().toISOString().slice(0, 7);

  const [yearText, monthText] = requestedMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  end.setMilliseconds(-1);

  return reportPayload(start, end, {
    type: "monthly",
    month: requestedMonth,
    start: start.toISOString(),
    end: end.toISOString(),
  }, null, null, u!.businessId);
});
app.get("/api/workers", { preHandler: patron }, async (req) => {
  const u = await currentUser(req);
  return {
    data: (
      await db
        .select()
        .from(users)
        .where(and(eq(users.businessId, u!.businessId), eq(users.role, "worker")))
        .orderBy(asc(users.name))
    ).map(mapUser),
  };
});

function probableName(a: string, b: string) {
  const left = normalizeMatchName(a).replace(/[^\p{L}\p{N}]/gu, "");
  const right = normalizeMatchName(b).replace(/[^\p{L}\p{N}]/gu, "");
  return left !== right && left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left));
}

app.post("/api/menu-import/preview", {
  preHandler: patron,
  config: { rateLimit: { max: config.NODE_ENV === "test" ? 100 : 5, timeWindow: "1 minute" } },
}, async (req, reply) => {
  if (!req.isMultipart()) return reply.code(422).send({ message: "Sélectionnez un fichier PDF." });
  const part = await req.file({ limits: { files: 1, fileSize: MENU_PDF_MAX_BYTES } });
  if (!part) return reply.code(422).send({ message: "Sélectionnez un fichier PDF." });
  if (part.fieldname !== "pdf") return reply.code(422).send({ message: "Champ de fichier inattendu. Utilisez le champ « pdf »." });
  if (part.mimetype !== "application/pdf") return reply.code(422).send({ message: "Le fichier doit être un PDF valide." });
  let bytes: Buffer;
  try { bytes = await part.toBuffer(); }
  catch { return reply.code(413).send({ message: "Le PDF ne doit pas dépasser 5 Mio." }); }
  if (part.file.truncated || bytes.length > MENU_PDF_MAX_BYTES) return reply.code(413).send({ message: "Le PDF ne doit pas dépasser 5 Mio." });
  try {
    const extracted = await extractPdfText(bytes);
    const parsed = parseMenuLayout(extracted);
    if (!parsed.categories.length) return reply.code(422).send({ message: "Aucun produit exploitable n’a été trouvé dans ce PDF." });
    const u = await currentUser(req);
    const existingCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.businessId, u!.businessId));
    const existingProducts = await db
      .select()
      .from(products)
      .where(eq(products.businessId, u!.businessId));
    const previewCategories = parsed.categories.map((category) => {
      const exactCategory = existingCategories.find((item) => normalizeMatchName(item.name) === normalizeMatchName(category.name));
      const probableCategory = exactCategory ?? existingCategories.find((item) => probableName(item.name, category.name));
      const targetCategoryId = exactCategory?.id ?? null;
      return {
        ...category,
        decision: exactCategory ? "use_existing" as const : "create" as const,
        existing_category_id: targetCategoryId,
        duplicate_kind: exactCategory ? "exact" as const : probableCategory ? "probable" as const : "none" as const,
        products: category.products.map((product) => {
          const candidates = existingProducts.filter((item) => targetCategoryId !== null && item.categoryId === targetCategoryId);
          const exact = candidates.find((item) => normalizeMatchName(item.name) === normalizeMatchName(product.name));
          const probable = exact ?? candidates.find((item) => probableName(item.name, product.name));
          return { ...product, track_stock: exact?.trackStock ?? false, decision: exact ? "skip" as const : "create" as const, existing_product_id: exact?.id ?? null,
            duplicate_kind: exact ? "exact" as const : probable ? "probable" as const : "none" as const };
        }),
      };
    });
    const sessionId = crypto.randomUUID();
    const preview = { session_id: sessionId, page_count: extracted.pageCount, currency: "MAD" as const,
      categories: previewCategories, ignored_items: parsed.ignored_items, warnings: parsed.warnings };
    await db.insert(menuImportSessions).values({ id: sessionId, userId: req.user.sub, preview });
    return { data: preview };
  } catch (error) {
    if (error instanceof MenuPdfError) return reply.code(422).send({ message: error.message, code: error.code });
    throw error;
  }
});

app.post("/api/menu-import/confirm", {
  preHandler: patron,
  config: { rateLimit: { max: config.NODE_ENV === "test" ? 100 : 10, timeWindow: "1 minute" } },
}, async (req, reply) => {
  try {
    const explicitTracking = new Set<string>();
    const rawCategories = (req.body as { categories?: Array<{ products?: Array<Record<string, unknown>> }> } | null)?.categories;
    for (const category of rawCategories ?? []) for (const product of category.products ?? []) if (typeof product.client_id === "string" && Object.prototype.hasOwnProperty.call(product, "track_stock")) explicitTracking.add(product.client_id);
    const input = menuImportRequestSchema.parse(req.body);
    const u = await currentUser(req);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.session_id}))`);
      const [session] = await tx.select().from(menuImportSessions)
        .where(and(eq(menuImportSessions.id, input.session_id), eq(menuImportSessions.userId, req.user.sub))).limit(1);
      if (!session) return { kind: "missing" as const };
      if (session.status === "confirmed") return { kind: "done" as const, value: { ...(session.result as object), replayed: true } };
      const summary = { session_id: input.session_id, replayed: false, categories: { created: 0, reused: 0, ignored: 0 }, products: { created: 0, updated: 0, ignored: 0, failed: 0 } };
      for (const category of input.categories) {
        if (category.decision === "skip") { summary.categories.ignored += 1; summary.products.ignored += category.products.length; continue; }
        let categoryId: number;
        if (category.decision === "use_existing") {
          const [existing] = await tx.select().from(categories).where(and(eq(categories.id, category.existing_category_id!), eq(categories.businessId, u!.businessId))).limit(1);
          if (!existing) throw new Error("La catégorie existante sélectionnée n’existe plus.");
          categoryId = existing.id; summary.categories.reused += 1;
        } else {
          const exact = await tx.select().from(categories).where(and(eq(categories.businessId, u!.businessId), sql`lower(trim(${categories.name})) = lower(trim(${category.name}))`)).limit(1);
          if (exact.length) throw new Error(`La catégorie « ${category.name} » existe déjà. Choisissez-la explicitement.`);
          const [created] = await tx.insert(categories).values({ businessId: u!.businessId, name: category.name }).returning();
          categoryId = created!.id; summary.categories.created += 1;
        }
        for (const product of category.products) {
          if (product.decision === "skip") { summary.products.ignored += 1; continue; }
          const productName = product.variant ? `${product.name} - ${product.variant}` : product.name;
          if (product.decision === "update_existing") {
            const [existing] = await tx.select().from(products).where(and(eq(products.id, product.existing_product_id!), eq(products.businessId, u!.businessId))).limit(1);
            if (!existing) throw new Error("Le produit sélectionné n’existe plus.");
            await tx.update(products).set({ name: productName, categoryId, salePrice: product.sale_price!, trackStock: explicitTracking.has(product.client_id) ? product.track_stock : existing.trackStock,
              stock: product.initial_stock ?? existing.stock, updatedAt: new Date() }).where(and(eq(products.id, existing.id), eq(products.businessId, u!.businessId)));
            summary.products.updated += 1;
          } else {
            const exact = await tx.select().from(products).where(and(eq(products.businessId, u!.businessId), eq(products.categoryId, categoryId), sql`lower(trim(${products.name})) = lower(trim(${productName}))`)).limit(1);
            if (exact.length) throw new Error(`Le produit « ${productName} » existe déjà. Résolvez explicitement le doublon.`);
            await tx.insert(products).values({ businessId: u!.businessId, categoryId, name: productName, salePrice: product.sale_price!, stock: product.initial_stock ?? 0, minStock: 0, trackStock: product.track_stock, isActive: true });
            summary.products.created += 1;
          }
        }
      }
      await tx.update(menuImportSessions).set({ status: "confirmed", result: summary, confirmedAt: new Date() }).where(eq(menuImportSessions.id, input.session_id));
      return { kind: "created" as const, value: summary };
    });
    if (result.kind === "missing") return reply.code(404).send({ message: "Session d’importation introuvable ou expirée." });
    return { data: result.value };
  } catch (error) {
    if (error instanceof ZodError) return validation(reply, error);
    if (error instanceof Error && /catégorie|produit/iu.test(error.message)) return reply.code(422).send({ message: error.message });
    throw error;
  }
});

const booleanSettingKeys = new Set([
  "show_wifi_on_ticket", "show_phone_on_ticket", "show_address_on_ticket",
  "auto_print_after_order", "open_ticket_after_order", "direct_print_enabled",
  "fallback_browser_print",
]);
const settingDefaults: Record<string, string | number | boolean> = {
  cafe_name: "Bimik_Cafe", cafe_subtitle: "Stock & caisse", cafe_address: "HAY ADRAR",
  cafe_phone: "", wifi_name: "Bimik_Cafe", wifi_code: "", ticket_header: "BIMIK Café Bimik",
  ticket_footer: "NOUS VOUS REMERCIONS POUR VOTRE VISITE", ticket_note: "",
  show_wifi_on_ticket: true, show_phone_on_ticket: false, show_address_on_ticket: true,
  ticket_width: 80, auto_print_after_order: false, open_ticket_after_order: true,
  thermal_printer_name: "", direct_print_enabled: false, fallback_browser_print: false,
};
async function serializedSettings(businessId:number) {
  const result: Record<string, string | number | boolean> = { ...settingDefaults };
  for (const row of await db.select().from(settings).where(eq(settings.businessId,businessId))) {
    if (!(row.key in result)) continue;
    result[row.key] = booleanSettingKeys.has(row.key)
      ? ["1", "true", "yes", "on"].includes(String(row.value).toLowerCase())
      : row.key === "ticket_width" ? Number(row.value) : (row.value ?? "");
  }
  return result;
}
app.get("/api/settings/public", { preHandler: authenticate }, async req=>serializedSettings((await currentUser(req))!.businessId));
app.get("/api/settings", { preHandler: patron }, async req=>serializedSettings((await currentUser(req))!.businessId));
async function persistSettings(businessId:number,body: Record<string, unknown>) {
  for (const [key, value] of Object.entries(body)) {
    if (!/^[a-z0-9_]{1,255}$/i.test(key)) continue;
    await db
      .insert(settings)
      .values({businessId,key, value: value == null ? null : String(value) })
      .onConflictDoUpdate({
        target: [settings.businessId,settings.key],
        set: {
          value: value == null ? null : String(value),
          updatedAt: new Date(),
        },
      });
  }
  return serializedSettings(businessId);
}
app.put("/api/settings", { preHandler: patron }, async (req, reply) => {
  try { return persistSettings((await currentUser(req))!.businessId,settingsSchema.parse(req.body)); }
  catch (e) { return validation(reply, e); }
});
app.put("/api/settings/wifi", { preHandler: patron }, async (req, reply) => {
  try {
    const wifi = wifiSettingsSchema.parse(req.body);
    await persistSettings((await currentUser(req))!.businessId,wifi);
    return { wifi_name: wifi.wifi_name, wifi_code: wifi.wifi_code ?? "" };
  } catch (e) { return validation(reply, e); }
});
app.get("/api/users", { preHandler: patron }, async req => {const u=await currentUser(req);return {data:(await db.select().from(users).where(eq(users.businessId,u!.businessId)).orderBy(asc(users.name))).map(mapUser)}});
app.post("/api/users", { preHandler: patron }, async (req, reply) => {
  try {
    const v = userCreateSchema.parse(req.body);const owner=await currentUser(req);
    const [u] = await db
      .insert(users)
      .values({
        businessId:owner!.businessId,branchId:owner!.branchId,
        name: v.name,
        email: v.email,
        password: await argon2.hash(v.password),
        role: v.role,
        isActive: v.is_active,
      })
      .returning();
    return reply.code(201).send({ data: mapUser(u) });
  } catch (e) {
    return validation(reply, e);
  }
});
app.put("/api/users/:id", { preHandler: patron }, async (req, reply) => {
  try {
    const id = idParam.parse((req.params as any).id),
      v = userUpdateSchema.parse(req.body);
    const owner=await currentUser(req);const [existing] = await db.select().from(users).where(and(eq(users.id,id),eq(users.businessId,owner!.businessId))).limit(1);
    if (!existing) return reply.code(404).send({ message: "Utilisateur introuvable." });
    const remainsPatron = (v.role ?? existing.role) === "patron";
    const remainsActive = v.is_active ?? existing.isActive;
    if (existing.role === "patron" && existing.isActive && (!remainsPatron || !remainsActive)) {
      const [active] = await db.select({ count: sql<number>`count(*)::int` }).from(users)
        .where(and(eq(users.businessId, owner!.businessId), eq(users.role, "patron"), eq(users.isActive, true)));
      if (active.count <= 1) return reply.code(422).send({
        message: "Impossible de désactiver le dernier patron actif.",
      });
    }
    const [u] = await db
      .update(users)
      .set({
        name: v.name,
        email: v.email,
        password: v.password ? await argon2.hash(v.password) : undefined,
        role: v.role,
        isActive: v.is_active,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id,id),eq(users.businessId,owner!.businessId)))
      .returning();
    return { data: mapUser(u) };
  } catch (e) {
    return validation(reply, e);
  }
});
app.delete("/api/users/:id", { preHandler: patron }, async (req, reply) => {
  const id = idParam.parse((req.params as { id: string }).id);

  if (id === req.user.sub) {
    return reply.code(422).send({
      message: "Vous ne pouvez pas supprimer votre propre compte.",
    });
  }

  const owner=await currentUser(req);const [targetUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.id,id),eq(users.businessId,owner!.businessId)))
    .limit(1);

  if (!targetUser) {
    return reply.code(404).send({
      message: "Utilisateur introuvable.",
    });
  }

  if (targetUser.role === "patron" && targetUser.isActive) {
    const [result] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .where(and(eq(users.businessId, owner!.businessId), eq(users.role, "patron"), eq(users.isActive, true)));

    if (result.count <= 1) {
      return reply.code(422).send({
        message: "Impossible de supprimer le dernier patron actif.",
      });
    }
  }

  const [salesResult] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(and(eq(sales.userId, id), eq(sales.businessId, owner!.businessId)));

  const [movementsResult] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.userId, id), eq(stockMovements.businessId, owner!.businessId)));

  if (salesResult.count > 0 || movementsResult.count > 0) {
    return reply.code(422).send({
      message:
        "Cet utilisateur possède un historique de ventes ou de stock. Désactivez-le au lieu de le supprimer.",
    });
  }

  try {
    await db.delete(users).where(and(eq(users.id,id),eq(users.businessId,owner!.businessId)));

    return {
      message: "Utilisateur supprimé.",
    };
  } catch (error) {
    req.log.error(error);

    return reply.code(422).send({
      message:
        "Cet utilisateur est lié à des données existantes. Désactivez-le au lieu de le supprimer.",
    });
  }
});
await registerCoreV2Routes(app,{pool,controlPool,authenticate,resolveUser:async request=>{const user=await currentUser(request);return user?{id:user.id,businessId:user.businessId,branchId:user.branchId,role:user.role as Role}:null}});
await registerLicenseRoutes(app,{pool:controlPool,operationalPool:pool,authenticate,resolveUser:async request=>{const user=await currentUser(request);return user?{id:user.id,businessId:user.businessId,branchId:user.branchId,role:user.role}:null}});
app.setErrorHandler((error, _req, reply) => {
  app.log.error(error);
  if (error instanceof ZodError) return validation(reply, error);
  const status =
    (error as any).statusCode && Number((error as any).statusCode) < 500
      ? Number((error as any).statusCode)
      : 500;
  return reply.code(status).send({
    message:
      status === 500
        ? "An unexpected error occurred."
        : (error as Error).message,
    ...((error as any).code && status < 500
      ? { code: String((error as any).code) }
      : {}),
  });
});
app.setNotFoundHandler((_req, reply) =>
  reply.code(404).send({ message: "Not found." }),
);
const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPoint === import.meta.url) {
  await app.listen({ host: config.HOST, port: config.PORT });
}

export { app };
