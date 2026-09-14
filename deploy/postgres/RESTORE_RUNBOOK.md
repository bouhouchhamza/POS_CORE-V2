# Core POS SaaS restore runbook

Backups are **never restored over production in place**. First download one `corepos-saas-*.tar.gz` archive and its `.sha256`, then run `verify-backup.sh` against the archive.

For a client-only recovery, extract the archive, identify `databases/tenant-corepos_<slug>_<suffix>.dump`, create a new isolated recovery database, and restore with `pg_restore --no-owner --no-acl --dbname=<recovery_database> <dump>`. Validate counts, financial totals, inventory totals, login, and business identity before any controlled cutover.

For a control-plane disaster, restore `databases/control-plane.dump` into a new recovery database first. Do not point the application at it until the tenant registry, licenses, device state, Vendor Businesses, and audit logs have been validated.

`uploads.tar.gz` restores the tenant-isolated upload tree. Never overwrite live uploads during a drill; extract to a recovery directory and compare first.

A production restore requires an operator-approved maintenance window, a fresh pre-restore backup, and a documented rollback point. The signing **private key is not part of database backups** and must stay in the separate secret-management/recovery process.
