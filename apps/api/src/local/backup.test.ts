import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalBackup, validateLocalBackup, validateRestoreIntoSeparateDirectory } from "./backup.js";
import { openLocalDatabase } from "./database.js";
import { ensureLocalPaths, resolveLocalPaths } from "./paths.js";

test("creates and validates a database plus uploads backup without changing active data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-offline-backup-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const db = openLocalDatabase(paths);
  try {
    db.prepare("INSERT INTO settings(key,value,created_at,updated_at) VALUES(?,?,?,?)")
      .run("cafe_name", "Test légal", new Date().toISOString(), new Date().toISOString());
    fs.writeFileSync(path.join(paths.uploads, "image-test.png"), Buffer.from("safe fixture"));
    const backup = createLocalBackup(db, paths, { applicationVersion: "test", keep: 2 });
    assert.equal(validateLocalBackup(backup.directory).application_version, "test");
    const restore = path.join(root, "restore-validation");
    validateRestoreIntoSeparateDirectory(backup.directory, restore);
    const restored = fs.readFileSync(path.join(restore, "uploads", "image-test.png"), "utf8");
    assert.equal(restored, "safe fixture");
    assert.equal(db.prepare("SELECT value FROM settings WHERE key=?").get("cafe_name")?.value, "Test légal");
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a modified backup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bimik-offline-corrupt-"));
  const paths = ensureLocalPaths(resolveLocalPaths({ BIMIK_DATA_DIR: root }));
  const db = openLocalDatabase(paths);
  try {
    const backup = createLocalBackup(db, paths);
    fs.appendFileSync(path.join(backup.directory, "data", "bimik-cafe.sqlite"), "corruption");
    assert.throws(() => validateLocalBackup(backup.directory), /somme de contrôle/);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
