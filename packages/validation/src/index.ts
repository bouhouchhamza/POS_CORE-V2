import { z } from "zod";
import { businessTypes, featureKeys, roleKeys } from '@bimik/shared-types';
export const featureKeySchema=z.enum(featureKeys);
export const businessTypeSchema=z.enum(businessTypes);
export const coreRoleSchema=z.enum(roleKeys);
export const businessFeaturesSchema=z.object({enabled_features:z.array(featureKeySchema).max(featureKeys.length)}).strict();
export const businessUpdateSchema=z.object({name:z.string().trim().min(1).max(255),business_type:businessTypeSchema,currency:z.string().trim().length(3),locale:z.string().trim().min(2).max(20),timezone:z.string().trim().min(1).max(100)}).partial();
export const businessSetupSchema=z.object({
  business:z.object({name:z.string().trim().min(1).max(255),business_type:businessTypeSchema,logo:z.string().trim().max(2_000_000).nullable().optional(),phone:z.string().trim().max(50).nullable().optional(),address:z.string().trim().max(500).nullable().optional(),currency:z.string().trim().length(3),locale:z.string().trim().min(2).max(20),timezone:z.string().trim().min(1).max(100)}),
  enabled_features:z.array(featureKeySchema).min(1).max(featureKeys.length),
  admin:z.object({name:z.string().trim().min(1).max(255),email:z.string().trim().email().max(255),password:z.string().min(8).max(200)}),
}).strict();
export const orderSchema=z.object({client_id:z.string().uuid(),source:z.enum(['pos','employee_table','qr_table','web','mobile']).default('pos'),type:z.enum(['retail','dine_in','takeaway','delivery']).default('retail'),table_id:z.number().int().positive().nullable().optional(),customer_id:z.number().int().positive().nullable().optional(),discount:z.coerce.number().min(0).default(0),tax:z.coerce.number().min(0).default(0),payment_status:z.enum(['unpaid','partial','paid','refunded']).default('unpaid'),notes:z.string().max(1000).nullable().optional(),items:z.array(z.object({product_id:z.number().int().positive(),variant_id:z.number().int().positive().nullable().optional(),quantity:z.coerce.number().positive(),unit_price:z.coerce.number().min(0).optional(),discount:z.coerce.number().min(0).default(0),tax:z.coerce.number().min(0).default(0),notes:z.string().max(1000).nullable().optional(),modifier_ids:z.array(z.number().int().positive()).default([])})).min(1)});
export const supplierSchema=z.object({name:z.string().trim().min(1).max(255),contact:z.string().max(255).nullable().optional(),phone:z.string().max(50).nullable().optional(),email:z.string().email().max(255).nullable().optional(),address:z.string().max(500).nullable().optional(),notes:z.string().max(1000).nullable().optional(),active:z.boolean().default(true)});
export const purchaseSchema=z.object({supplier_id:z.number().int().positive(),reference:z.string().trim().min(1).max(100),status:z.enum(['draft','ordered','partially_received','received','cancelled']).default('draft'),payment_status:z.enum(['unpaid','partial','paid']).default('unpaid'),tax:z.coerce.number().min(0).default(0),items:z.array(z.object({product_id:z.number().int().positive(),quantity:z.coerce.number().positive(),purchase_price:z.coerce.number().min(0),tax:z.coerce.number().min(0).default(0)})).min(1)});
export const roomSchema=z.object({name:z.string().trim().min(1).max(120),sort_order:z.number().int().default(0),active:z.boolean().default(true)});
export const tableSchema=z.object({room_id:z.number().int().positive(),table_number:z.string().trim().min(1).max(30),name:z.string().trim().min(1).max(120),capacity:z.number().int().positive().max(100),status:z.enum(['available','occupied','ordering','waiting','served','bill_requested','reserved']).default('available'),active:z.boolean().default(true)});
export const roleSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
  coreRoleSchema,
);
export const idParam = z.coerce.number().int().positive();
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const categorySchema = z.object({
  name: z.string().trim().min(1).max(255),
  image: z.string().nullable().optional(),
  is_public: z.preprocess(
    (value) => value === "true" || value === "1" || value === 1 ? true : value === "false" || value === "0" || value === 0 ? false : value,
    z.boolean(),
  ).optional(),
});
export const canonicalBooleanSchema = z.preprocess(
  (value) => value === "true" || value === "1" || value === 1 ? true : value === "false" || value === "0" || value === 0 ? false : value,
  z.boolean({ error: "La valeur doit être vraie ou fausse." }),
);
export const productSchema = z.object({
  category_id: z.preprocess((value) => value === "" ? null : value, z.coerce.number().int().positive().nullable().optional()),
  name: z.string().trim().min(1).max(255),
  sku:z.string().trim().max(100).nullable().optional(),
  barcode:z.string().trim().max(100).nullable().optional(),
  unit:z.enum(['piece','kg','gram','liter','ml','pack','box','custom']).default('piece'),
  tax_rate:z.coerce.number().min(0).max(100).default(0),
  sale_price: z.coerce.number().min(0),
  stock: z.coerce.number().finite().min(0).multipleOf(0.001).default(0),
  min_stock: z.coerce.number().finite().min(0).multipleOf(0.001).default(0),
  track_stock: canonicalBooleanSchema.default(true),
  image: z.string().nullable().optional(),
  is_active: canonicalBooleanSchema.default(true),
  is_public:canonicalBooleanSchema.default(true),
  available:canonicalBooleanSchema.default(true),
});
export const productUpdateSchema = productSchema.partial().extend({
  stock: z.coerce.number().finite().min(0).multipleOf(0.001).optional(),
  min_stock: z.coerce.number().finite().min(0).multipleOf(0.001).optional(),
  track_stock: canonicalBooleanSchema.optional(),
  is_active: canonicalBooleanSchema.optional(),
});
export const stockChangeSchema = z.object({
  quantity: z.coerce.number().finite().positive().multipleOf(0.001),
  note: z.string().nullable().optional(),
});
export const stockCorrectionSchema = z.object({
  stock: z.coerce.number().finite().min(0).multipleOf(0.001),
  note: z.string().nullable().optional(),
});
export const saleSchema = z.object({
  payment_method: z.string().max(50).nullable().optional(),
  note: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        product_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1),
});
const cashMoneySchema = z.union([z.string(), z.number()]).transform((value, context) => {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(text)) {
    context.addIssue({ code: "custom", message: "Le montant doit être un nombre positif avec au maximum deux décimales." });
    return z.NEVER;
  }
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    context.addIssue({ code: "custom", message: "Le montant est invalide." });
    return z.NEVER;
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
});
export const cashRegisterOpenSchema = z.object({
  opening_cash: cashMoneySchema,
  opening_note: z.string().trim().max(1000).nullable().optional(),
});
export const cashRegisterCloseSchema = z.object({
  actual_cash: cashMoneySchema,
  closing_note: z.string().trim().max(1000).nullable().optional(),
});
export const cashRegisterSessionQuerySchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["open", "closed"]).optional(),
  user_id: z.coerce.number().int().positive().optional(),
});
export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(1),
  role: roleSchema,
  is_active: z.boolean().default(true),
});
export const userUpdateSchema = userCreateSchema.partial().extend({
  password: z.string().min(1).nullable().optional(),
});
export const settingsSchema = z.object({
  cafe_name: z.string().min(1).max(100),
  cafe_subtitle: z.string().max(150).nullable(),
  cafe_address: z.string().max(200).nullable(),
  cafe_phone: z.string().max(50).nullable(),
  wifi_name: z.string().max(100).nullable(),
  wifi_code: z.string().max(100).nullable(),
  ticket_header: z.string().max(150).nullable(),
  ticket_footer: z.string().max(250).nullable(),
  ticket_note: z.string().max(250).nullable(),
  show_wifi_on_ticket: z.boolean(),
  show_phone_on_ticket: z.boolean(),
  show_address_on_ticket: z.boolean(),
  ticket_width: z.union([z.literal(58), z.literal(80)]),
  auto_print_after_order: z.boolean(),
  open_ticket_after_order: z.boolean(),
  thermal_printer_name: z.string().max(150).nullable(),
  direct_print_enabled: z.boolean(),
  fallback_browser_print: z.boolean(),
}).strict();
export const wifiSettingsSchema = settingsSchema.pick({ wifi_name: true, wifi_code: true }).extend({
  wifi_name: z.string().min(1).max(100),
});

const requiredMenuText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} est obligatoire.`).max(max, `${label} est trop long.`);
const optionalMenuText = (max: number) => z.string().trim().max(max).nullable().optional();
const moneyText = z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/, "Le prix doit contenir au maximum deux décimales.");

export const menuCategoryDecisionSchema = z.enum(["create", "use_existing", "skip"]);
export const menuProductDecisionSchema = z.enum(["create", "update_existing", "skip"]);
export const menuProductPreviewSchema = z.object({
  client_id: z.string().uuid(),
  name: requiredMenuText("Le nom du produit", 255),
  sale_price: moneyText.nullable(),
  description: optionalMenuText(1000),
  variant: optionalMenuText(100),
  currency: z.enum(["MAD"]).default("MAD"),
  requires_review: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]).default("high"),
  review_reasons: z.array(z.string().max(300)).default([]),
  decision: menuProductDecisionSchema,
  existing_product_id: z.number().int().positive().nullable(),
  duplicate_kind: z.enum(["none", "exact", "probable"]),
  initial_stock: z.number().int().min(0).optional(),
  track_stock: z.boolean().default(false),
});
export const menuCategoryPreviewSchema = z.object({
  client_id: z.string().uuid(),
  name: requiredMenuText("Le nom de la catégorie", 255),
  decision: menuCategoryDecisionSchema,
  existing_category_id: z.number().int().positive().nullable(),
  duplicate_kind: z.enum(["none", "exact", "probable"]),
  products: z.array(menuProductPreviewSchema).min(1, "La catégorie doit contenir au moins un produit."),
});
export const extractedMenuSchema = z.object({
  session_id: z.string().uuid(),
  page_count: z.number().int().positive(),
  currency: z.literal("MAD"),
  categories: z.array(menuCategoryPreviewSchema).min(1, "Aucun produit exploitable trouvé."),
  ignored_items: z.array(z.object({
    client_id: z.string().uuid(),
    page: z.number().int().positive(),
    text: z.string().trim().min(1).max(1000),
    reason: z.string().trim().min(1).max(300),
    confidence: z.literal("low"),
  })).default([]),
  warnings: z.array(z.string().max(500)),
});
export const menuImportRequestSchema = z.object({
  session_id: z.string().uuid(),
  categories: z.array(menuCategoryPreviewSchema).min(1),
}).superRefine((value, context) => {
  for (const [categoryIndex, category] of value.categories.entries()) {
    if (category.decision === "use_existing" && !category.existing_category_id) {
      context.addIssue({ code: "custom", path: ["categories", categoryIndex, "existing_category_id"], message: "Choisissez une catégorie existante." });
    }
    for (const [productIndex, product] of category.products.entries()) {
      if (category.decision !== "skip" && product.decision !== "skip" && product.sale_price === null) {
        context.addIssue({ code: "custom", path: ["categories", categoryIndex, "products", productIndex, "sale_price"], message: "Vérifiez et saisissez le prix de vente." });
      }
      if (category.decision !== "skip" && product.decision !== "skip" && product.confidence === "low" && product.requires_review) {
        context.addIssue({ code: "custom", path: ["categories", categoryIndex, "products", productIndex], message: "Vérifiez explicitement cet élément peu fiable avant de l’importer." });
      }
      if (product.decision === "update_existing" && !product.existing_product_id) {
        context.addIssue({ code: "custom", path: ["categories", categoryIndex, "products", productIndex, "existing_product_id"], message: "Choisissez explicitement le produit à modifier." });
      }
    }
  }
});
export const menuImportResultSchema = z.object({
  session_id: z.string().uuid(),
  replayed: z.boolean(),
  categories: z.object({ created: z.number().int().min(0), reused: z.number().int().min(0), ignored: z.number().int().min(0) }),
  products: z.object({ created: z.number().int().min(0), updated: z.number().int().min(0), ignored: z.number().int().min(0), failed: z.number().int().min(0) }),
});
