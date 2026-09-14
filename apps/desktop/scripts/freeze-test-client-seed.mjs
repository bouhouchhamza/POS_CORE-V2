import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const expectedProducts = 92
const expectedCategories = 10
const expectedUsers = 2

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Argument requis: ${name}`)
  return path.resolve(process.argv[index + 1])
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function slug(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'produit'
}

function csv(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function rustString(value) {
  return JSON.stringify(String(value))
}

function count(db, table) {
  return Number(db.prepare(`SELECT count(*) count FROM "${table}"`).get().count)
}

const sourceDatabase = argument('--source-database')
const sourceAppData = argument('--source-app-data')
const outputDatabase = argument('--output-database')
const outputImages = argument('--output-images')
const outputMapping = argument('--output-mapping')
const outputModule = argument('--output-module')
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'

if (!fs.statSync(sourceDatabase).isFile()) throw new Error('La base Test source est introuvable.')
const uploadsRoot = path.resolve(sourceAppData, 'uploads')
const source = new DatabaseSync(sourceDatabase, { readOnly: true })
if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('La base Test échoue integrity_check.')
if (source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('La base Test contient des violations de clés étrangères.')
if (count(source, 'products') !== expectedProducts || count(source, 'categories') !== expectedCategories || count(source, 'users') !== expectedUsers) {
  throw new Error('Les compteurs de la base Test ne correspondent pas au périmètre approuvé 92/10/2.')
}

const products = source.prepare('SELECT id,name,image FROM products ORDER BY id').all()
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bimik-final-seed-'))
const stagedImages = path.join(temporary, 'product-images')
const stagedDatabase = path.join(temporary, 'bimik-cafe.seed.sqlite')
fs.mkdirSync(stagedImages)

const mapping = []
try {
  for (const product of products) {
    const image = String(product.image ?? '')
    if (!image.startsWith('/uploads/products/')) throw new Error(`Produit ${product.id}: URL image non locale.`)
    const sourceImage = path.resolve(uploadsRoot, image.slice('/uploads/'.length))
    if (!sourceImage.startsWith(`${uploadsRoot}${path.sep}`) || !fs.statSync(sourceImage).isFile()) throw new Error(`Produit ${product.id}: image source absente ou non sûre.`)
    const fileName = `bimik-bundled-${String(product.id).padStart(3, '0')}_${slug(product.name)}.png`
    const target = path.join(stagedImages, fileName)
    const converted = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', sourceImage, '-frames:v', '1', '-vf', 'format=rgba', '-pix_fmt', 'rgba', '-map_metadata', '-1', target], { stdio: 'pipe' })
    if (converted.error || converted.status !== 0) throw new Error(`Produit ${product.id}: conversion PNG impossible: ${converted.stderr?.toString().trim() || converted.error}`)
    const bytes = fs.readFileSync(target)
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Produit ${product.id}: PNG généré invalide.`)
    mapping.push({ id: Number(product.id), name: String(product.name), fileName, imageUrl: `/uploads/products/${fileName}` })
  }

  source.exec(`VACUUM INTO ${sqlString(stagedDatabase)}`)
  source.close()
  const seed = new DatabaseSync(stagedDatabase)
  seed.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  try {
    seed.exec(`
      DELETE FROM sale_items;
      DELETE FROM sales;
      DELETE FROM stock_movements;
      DELETE FROM cash_register_sessions;
      DELETE FROM refresh_tokens;
      DELETE FROM menu_import_sessions;
      UPDATE backup_status SET last_success_at=NULL,last_path=NULL,state='pending',last_error=NULL WHERE id=1;
    `)
    const updateImage = seed.prepare('UPDATE products SET image=? WHERE id=?')
    for (const entry of mapping) {
      if (updateImage.run(entry.imageUrl, entry.id).changes !== 1) throw new Error(`Produit ${entry.id}: impossible de fixer l’image du seed.`)
    }
    seed.exec(`DELETE FROM sqlite_sequence WHERE name IN ('sales','sale_items','stock_movements','cash_register_sessions','refresh_tokens','menu_import_sessions')`)
    for (const table of ['users', 'categories', 'products']) {
      const maximum = Number(seed.prepare(`SELECT coalesce(max(id),0) value FROM ${table}`).get().value)
      const updated = seed.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(maximum, table)
      if (updated.changes === 0) seed.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table, maximum)
    }
    seed.exec('COMMIT')
  } catch (error) {
    seed.exec('ROLLBACK')
    throw error
  }
  seed.exec('VACUUM')
  if (seed.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Le seed final échoue integrity_check.')
  if (seed.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Le seed final contient des violations de clés étrangères.')
  const expectedZero = ['sales', 'sale_items', 'stock_movements', 'cash_register_sessions', 'refresh_tokens', 'menu_import_sessions']
  for (const table of expectedZero) if (count(seed, table) !== 0) throw new Error(`Le seed contient encore des données transitoires: ${table}.`)
  if (count(seed, 'products') !== expectedProducts || count(seed, 'categories') !== expectedCategories || count(seed, 'users') !== expectedUsers) throw new Error('Le seed final ne respecte pas les compteurs approuvés.')
  const serialized = JSON.stringify({
    users: seed.prepare('SELECT * FROM users').all(),
    categories: seed.prepare('SELECT * FROM categories').all(),
    products: seed.prepare('SELECT * FROM products').all(),
    settings: seed.prepare('SELECT * FROM settings').all(),
  })
  if (/C:\\Users\\pc\\|bond\.nextora\.cafe\.test/i.test(serialized)) throw new Error('Le seed contient un chemin spécifique à la machine Test.')
  seed.close()

  const csvLines = ['product_id,product_name,image_file', ...mapping.map((entry) => [entry.id, csv(entry.name), entry.fileName].join(','))]
  const rust = `// AUTO-GENERATED FILE.\n// Source: resources/product-images-mapping.csv\n// Do not edit product entries manually.\n\n#[derive(Debug)]\npub(crate) struct BundledProductImage {\n    pub product_id: i64,\n    pub product_name: &'static str,\n    pub file_name: &'static str,\n    pub image_url: &'static str,\n    pub bytes: &'static [u8],\n}\n\npub(crate) static PRODUCT_IMAGES: &[BundledProductImage] = &[\n${mapping.map((entry) => `    BundledProductImage {\n        product_id: ${entry.id},\n        product_name: ${rustString(entry.name)},\n        file_name: ${rustString(entry.fileName)},\n        image_url: ${rustString(entry.imageUrl)},\n        bytes: include_bytes!("../resources/product-images/${entry.fileName}"),\n    },`).join('\n')}\n];\n`

  fs.rmSync(outputImages, { recursive: true, force: true })
  fs.renameSync(stagedImages, outputImages)
  fs.copyFileSync(stagedDatabase, outputDatabase)
  fs.writeFileSync(outputMapping, `\uFEFF${csvLines.join('\r\n')}\r\n`)
  fs.writeFileSync(outputModule, rust)

  const imageHash = crypto.createHash('sha256')
  for (const entry of mapping) {
    imageHash.update(entry.fileName)
    imageHash.update(fs.readFileSync(path.join(outputImages, entry.fileName)))
  }
  console.log(JSON.stringify({ products: mapping.length, image_set_sha256: imageHash.digest('hex').toUpperCase(), outputDatabase, outputImages }, null, 2))
} finally {
  try { source.close() } catch {}
  fs.rmSync(temporary, { recursive: true, force: true })
}
