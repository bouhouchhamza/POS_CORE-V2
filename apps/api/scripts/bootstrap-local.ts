import fs from "node:fs";
import { immediate, openLocalDatabase, sha256File } from "../src/local/database.js";
import { ensureLocalPaths, resolveLocalPaths } from "../src/local/paths.js";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const manifestPath = argument("--manifest");
const expectedChecksum = argument("--sha256");
const confirmation = argument("--confirm-empty-local-database");
if (!manifestPath || !expectedChecksum || confirmation !== "CREATE") {
  throw new Error("Usage: npm run local:bootstrap -- --manifest <fichier.json> --sha256 <somme> --confirm-empty-local-database CREATE");
}
if (sha256File(manifestPath) !== expectedChecksum.toLowerCase()) throw new Error("La somme SHA-256 du manifeste ne correspond pas.");
const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { users?: Array<{ name: string; email: string; password_hash: string; role: string; is_active: boolean }> };
if (!Array.isArray(payload.users) || payload.users.length === 0) throw new Error("Le manifeste vérifié ne contient aucun utilisateur.");
for (const user of payload.users) {
  if (!user.password_hash.startsWith("$2")) throw new Error("Le bootstrap local accepte uniquement les hashes bcrypt validés de la source Laravel.");
  if (!['patron','worker'].includes(user.role)) throw new Error("Un rôle utilisateur n'est pas canonique.");
}
const paths = ensureLocalPaths(resolveLocalPaths());
const existedBefore = fs.existsSync(paths.database);
const db = openLocalDatabase(paths);
try {
  const businessRows = ["users", "categories", "products", "sales", "sale_items", "stock_movements"].reduce((sum, table) => sum + Number(db.prepare(`SELECT count(*) count FROM ${table}`).get()?.count ?? 0), 0);
  if (existedBefore || businessRows !== 0) throw new Error("Initialisation refusée : la base locale existe déjà. Aucun écrasement n'a été effectué.");
  immediate(db, () => {
    const timestamp = new Date().toISOString();
    for (const user of payload.users!) db.prepare("INSERT INTO users(name,email,password,role,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(user.name.trim(), user.email.trim().toLowerCase(), user.password_hash, user.role, Number(user.is_active), timestamp, timestamp);
  });
  const activePatrons = Number(db.prepare("SELECT count(*) count FROM users WHERE role='patron' AND is_active=1").get()?.count ?? 0);
  if (activePatrons < 1) throw new Error("Initialisation invalide : aucun Patron actif.");
  console.log(`Initialisation locale vérifiée : ${payload.users.length} utilisateurs; ${activePatrons} Patron(s) actif(s). Aucun secret affiché.`);
} finally { db.close(); }
