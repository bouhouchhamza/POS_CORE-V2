# Customer data migration

Stop writes first. Copy the active SQLite database and uploaded-image directory, calculate SHA-256 checksums, and retain those untouched originals. Never run the importer against the only source copy.

Create a new database without deleting the current one (for example `createdb bimik_cafe_import_new`), set `DATABASE_URL` to that explicit empty target, run `npm run db:migrate`, then run `npm run import:sqlite -w @bimik/api -- backend/database/database.sqlite` from the repository root. Root-relative and absolute source paths are supported.

The importer refuses a non-empty target and preserves IDs, timestamps, Laravel bcrypt password hashes and decimal values. The new login accepts legacy bcrypt hashes; newly set passwords use Argon2id. Copy images into the persistent uploads volume using a reviewed path mapping.

Before cutover compare exact row counts, product-stock sum, sales-total sum and sale-item-total sum. Also verify every sale total against its items, foreign keys, sampled low-stock products, dashboard figures, daily/monthly reports, one patron login, one worker login and sampled receipts. Keep the old application read-only until acceptance is signed off.

For a MySQL source, first create a consistent `mysqldump --single-transaction` backup, restore it on an isolated migration host, import through `pgloader` with explicit mappings, reset sequences, and perform the same validation. Do not point migration tooling at the production target before rehearsal.
