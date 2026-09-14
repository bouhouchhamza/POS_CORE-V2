import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LocalPaths } from "./paths.js";
import { LOCAL_SCHEMA_VERSION } from "./migrations.js";
import { sha256File } from "./database.js";

export type BackupManifest = {
  format: 1;
  application: "Bimik Cafe";
  application_version: string;
  schema_version: number;
  created_at: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
  database_integrity: "ok";
};

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
const relativeFileName = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");

function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(candidate) : entry.isFile() ? [candidate] : [];
  });
}

function copyUploads(source: string, destination: string) {
  for (const file of filesBelow(source)) {
    const relative = path.relative(source, file);
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  }
}

export function validateLocalBackup(directory: string): BackupManifest {
  const manifestPath = path.join(directory, "manifest.json");
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (raw.format !== 1 || raw.application !== "Bimik Cafe" || !Array.isArray(raw.files)) {
    throw new Error("Le manifeste de sauvegarde locale n'est pas reconnu.");
  }
  for (const expected of raw.files) {
    const normalized = path.normalize(expected.path);
    if (path.isAbsolute(normalized) || normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
      throw new Error("Le manifeste contient un chemin non sûr.");
    }
    const file = path.join(directory, normalized);
    const stat = fs.statSync(file);
    if (stat.size !== expected.bytes || sha256File(file) !== expected.sha256) {
      throw new Error(`La somme de contrôle est invalide pour ${expected.path}.`);
    }
  }
  const databaseFile = path.join(directory, "data", "bimik-cafe.sqlite");
  const validation = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const result = String(validation.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (result !== "ok") throw new Error("La copie SQLite de sauvegarde est invalide.");
  } finally {
    validation.close();
  }
  return raw;
}

export function createLocalBackup(
  db: DatabaseSync,
  paths: LocalPaths,
  options: { applicationVersion?: string; keep?: number } = {},
) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const finalDirectory = path.join(paths.backups, `${stamp}-offline`);
  const temporaryDirectory = `${finalDirectory}.${crypto.randomUUID()}.partial`;
  fs.mkdirSync(path.join(temporaryDirectory, "data"), { recursive: true });
  fs.mkdirSync(path.join(temporaryDirectory, "uploads"), { recursive: true });
  try {
    const databaseCopy = path.join(temporaryDirectory, "data", "bimik-cafe.sqlite");
    db.exec(`VACUUM INTO ${sqlString(databaseCopy)}`);
    copyUploads(paths.uploads, path.join(temporaryDirectory, "uploads"));
    const payloadFiles = filesBelow(temporaryDirectory).filter((file) => path.basename(file) !== "manifest.json");
    const schemaVersion = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    const manifest: BackupManifest = {
      format: 1,
      application: "Bimik Cafe",
      application_version: options.applicationVersion ?? process.env.npm_package_version ?? "unknown",
      schema_version: schemaVersion,
      created_at: new Date().toISOString(),
      database_integrity: "ok",
      files: payloadFiles.map((file) => ({
        path: relativeFileName(temporaryDirectory, file),
        bytes: fs.statSync(file).size,
        sha256: sha256File(file),
      })),
    };
    fs.writeFileSync(path.join(temporaryDirectory, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    validateLocalBackup(temporaryDirectory);
    fs.renameSync(temporaryDirectory, finalDirectory);
    applyRetention(paths.backups, Math.max(1, options.keep ?? 7), finalDirectory);
    return { directory: finalDirectory, manifest };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

function applyRetention(backupsRoot: string, keep: number, protectedDirectory: string) {
  const backups = fs.readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-offline") && !entry.name.endsWith(".partial"))
    .map((entry) => path.join(backupsRoot, entry.name))
    .sort()
    .reverse();
  for (const obsolete of backups.slice(keep)) {
    if (path.resolve(obsolete) !== path.resolve(protectedDirectory)) fs.rmSync(obsolete, { recursive: true, force: true });
  }
}

export function validateRestoreIntoSeparateDirectory(backupDirectory: string, restoreRoot: string) {
  const manifest = validateLocalBackup(backupDirectory);
  if (manifest.schema_version > LOCAL_SCHEMA_VERSION) {
    throw new Error("Cette sauvegarde utilise un schéma plus récent que l'application.");
  }
  if (fs.existsSync(restoreRoot) && fs.readdirSync(restoreRoot).length > 0) {
    throw new Error("Le répertoire de validation de restauration doit être vide.");
  }
  fs.mkdirSync(restoreRoot, { recursive: true });
  for (const entry of manifest.files) {
    const source = path.join(backupDirectory, path.normalize(entry.path));
    const destination = path.join(restoreRoot, path.normalize(entry.path));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  const restored = path.join(restoreRoot, "data", "bimik-cafe.sqlite");
  const db = new DatabaseSync(restored, { readOnly: true });
  try {
    const integrity = String(db.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (integrity !== "ok") throw new Error("La restauration SQLite de validation est invalide.");
  } finally {
    db.close();
  }
  return manifest;
}
