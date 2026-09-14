import path from "node:path";
import { createLocalBackup, validateRestoreIntoSeparateDirectory } from "../src/local/backup.js";
import { openLocalDatabase } from "../src/local/database.js";
import { ensureLocalPaths, resolveLocalPaths } from "../src/local/paths.js";

const paths = ensureLocalPaths(resolveLocalPaths());
const db = openLocalDatabase(paths);
try {
  const result = createLocalBackup(db, paths);
  const validationDirectory = path.join(paths.backups, ".restore-validation", path.basename(result.directory));
  validateRestoreIntoSeparateDirectory(result.directory, validationDirectory);
  console.log(`Sauvegarde locale vérifiée : ${result.directory}`);
  console.log(`Schéma : ${result.manifest.schema_version}; fichiers : ${result.manifest.files.length}; intégrité SQLite : ok`);
} finally {
  db.close();
}
