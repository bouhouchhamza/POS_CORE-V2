import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { categories, products, saleItems, sales, settings, stockMovements, users } from "../src/db/schema.js";

const sourceArgument = process.argv[2];
if (!sourceArgument) throw new Error("Usage: npm run import:sqlite -w @corepos/api -- /path/database.sqlite");
const source = path.resolve(process.env.INIT_CWD ?? process.cwd(), sourceArgument);
const sqlite = new DatabaseSync(source, { readOnly: true });
const names = ["users", "categories", "products", "sales", "sale_items", "stock_movements", "settings"] as const;
const rows = Object.fromEntries(names.map((table) => [table, sqlite.prepare(`select * from ${table} order by id`).all()])) as Record<(typeof names)[number], any[]>;
const sourceSummary = { counts: Object.fromEntries(names.map((table) => [table, rows[table].length])), salesTotal: rows.sales.reduce((sum, row) => sum + Number(row.total), 0).toFixed(2), itemsTotal: rows.sale_items.reduce((sum, row) => sum + Number(row.total), 0).toFixed(2), stockTotal: rows.products.reduce((sum, row) => sum + Number(row.stock), 0) };
const date = (value: unknown) => new Date(String(value));
const importedRole = (value: unknown): "patron" | "worker" => {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "patron") return "patron";
  if (["worker", "caissier", "serveur"].includes(normalized)) return "worker";
  throw new Error(`Unsupported imported user role: ${String(value)}`);
};

try {
  const targetSummary = await db.transaction(async (tx) => {
    for (const table of names) {
      const result = await tx.execute(sql.raw(`select count(*)::int as count from ${table}`));
      if (Number(result.rows[0]?.count) !== 0) throw new Error(`Target table ${table} is not empty; import aborted.`);
    }
    if (rows.users.length) await tx.insert(users).values(rows.users.map((r) => ({ id:r.id,name:r.name,email:r.email,password:r.password,role:importedRole(r.role),isActive:Boolean(r.is_active ?? 1),createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.categories.length) await tx.insert(categories).values(rows.categories.map((r) => ({ id:r.id,name:r.name,image:r.image,createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.products.length) await tx.insert(products).values(rows.products.map((r) => ({ id:r.id,categoryId:r.category_id,name:r.name,purchasePrice:String(r.purchase_price ?? 0),salePrice:String(r.sale_price),stock:r.stock,minStock:r.min_stock,image:r.image,isActive:Boolean(r.is_active ?? 1),createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.sales.length) await tx.insert(sales).values(rows.sales.map((r) => ({ id:r.id,userId:r.user_id,paymentMethod:r.payment_method,note:r.note,total:String(r.total),profit:String(r.profit),createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.sale_items.length) await tx.insert(saleItems).values(rows.sale_items.map((r) => ({ id:r.id,saleId:r.sale_id,productId:r.product_id,quantity:r.quantity,unitPrice:String(r.unit_price),purchasePrice:String(r.purchase_price ?? 0),total:String(r.total),profit:String(r.profit),createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.stock_movements.length) await tx.insert(stockMovements).values(rows.stock_movements.map((r) => ({ id:r.id,productId:r.product_id,userId:r.user_id,type:r.type,quantity:r.quantity,beforeStock:r.before_stock,afterStock:r.after_stock,note:r.note,createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    if (rows.settings.length) await tx.insert(settings).values(rows.settings.map((r) => ({ id:r.id,key:r.key,value:r.value,createdAt:date(r.created_at),updatedAt:date(r.updated_at) })));
    for (const table of names) await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}','id'), coalesce((select max(id) from ${table}), 1), (select count(*) > 0 from ${table}))`));
    const counts: Record<string, number> = {};
    for (const table of names) counts[table] = Number((await tx.execute(sql.raw(`select count(*)::int as count from ${table}`))).rows[0]?.count);
    const totals = (await tx.execute(sql.raw("select (select coalesce(sum(total),0)::numeric(12,2) from sales) as sales_total,(select coalesce(sum(total),0)::numeric(12,2) from sale_items) as items_total,(select coalesce(sum(stock),0)::int from products) as stock_total"))).rows[0] as any;
    const summary = { counts, salesTotal:Number(totals.sales_total).toFixed(2), itemsTotal:Number(totals.items_total).toFixed(2), stockTotal:Number(totals.stock_total) };
    if (JSON.stringify(summary) !== JSON.stringify(sourceSummary)) throw new Error(`Import validation mismatch: ${JSON.stringify({ source: sourceSummary, target: summary })}`);
    return summary;
  });
  console.log(JSON.stringify({ source, sourceSummary, targetSummary }, null, 2));
} finally {
  sqlite.close();
  await pool.end();
}
