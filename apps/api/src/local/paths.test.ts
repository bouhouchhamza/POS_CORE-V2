import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveLocalPaths } from "./paths.js";

test("explicit desktop database path is the single source of truth", () => {
  const root = path.resolve("C:/Bimik-Test/bond.nextora.cafe.test");
  const database = path.join(root, "data", "bimik-cafe.sqlite");
  const paths = resolveLocalPaths({
    BIMIK_APP_DATA_DIR: root,
    BIMIK_DATABASE_PATH: database,
  });
  assert.equal(paths.root, root);
  assert.equal(paths.database, database);
});

test("sidecar refuses a database outside the transmitted AppData root", () => {
  const root = path.resolve("C:/Bimik-Test/bond.nextora.cafe.test");
  assert.throws(
    () => resolveLocalPaths({
      BIMIK_APP_DATA_DIR: root,
      BIMIK_DATABASE_PATH: path.resolve("C:/Bimik-Test/other/empty.sqlite"),
    }),
    /ne correspond pas/,
  );
});

test("sidecar refuses a relative explicit database path", () => {
  assert.throws(
    () => resolveLocalPaths({ BIMIK_DATABASE_PATH: "data/bimik-cafe.sqlite" }),
    /absolu/,
  );
});
