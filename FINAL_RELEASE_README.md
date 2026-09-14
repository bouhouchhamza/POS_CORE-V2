# Core POS V2 — SaaS release candidate (2026-09-10)

This package is the consolidated source release candidate built from the uploaded Core POS source pack. It is **not a claim that production has already been migrated**.

## Included architecture/fixes

- database-per-client-business SaaS tenancy with a central control plane;
- immutable tenant slug/database naming and tenant-specific PostgreSQL migrations;
- tenant-bound JWT/session routing and tenant-isolated upload paths;
- total + Desktop/Web/Mobile/PWA device quotas and Vendor device revocation;
- one-time Desktop activation codes (default 24h, stored only as hashes, consumed atomically);
- commercial licence expiration is mandatory; default is 1 year and renewal must have a future expiry;
- existing device-bound `.posreq/.poslic` offline licensing remains supported;
- production Desktop release builds are blocked if the public verification key is absent/invalid;
- daily off-site SaaS backup script now includes the control plane, every tenant database, and tenant uploads;
- backup verification and non-destructive restore runbook are included.

## IMPORTANT: production public verification key

The uploaded source pack intentionally excluded `*.pem`, so this ZIP does not and must not invent a replacement key. **Do not rotate the existing signing key.** Copy only the current public key from production before building the final Windows installer:

```powershell
Set-Location "C:\Users\pc\Desktop\Core POS V2 Git"
scp root@195.35.0.63:/opt/core-pos-v2-prod/license-signing-public.pem "apps\desktop\src-tauri\resources\license-signing-public.pem"
npm run build:production-installer -w @bimik/desktop
```

The build script validates that the file is a public key, injects it at Rust compile time so `option_env!("LICENSE_SIGNING_PUBLIC_KEY")` is embedded in the EXE, runs the installer data-safety verifier, and prints the installer SHA-256. `build.rs` refuses a release build with no public key or with a private key.

## Database migration order

Apply control-plane migrations through `0016_require_commercial_license_expiry.sql` before enabling `SAAS_TENANCY_MODE=database_per_tenant`. Migration 0016 grants legacy perpetual commercial licences a one-year transition period from migration time and then makes commercial expiration mandatory.

New tenants are created only through the provisioning service. Do not manually derive a tenant database name from customer input.

## Production configuration

Required SaaS settings are documented in `deploy/docker-compose.prod.yml`: `CONTROL_PLANE_DATABASE_URL`, `SAAS_TENANCY_MODE=database_per_tenant`, `SAAS_TENANT_DATABASE_URL_TEMPLATE`, `SAAS_DATABASE_ADMIN_URL`, and `SAAS_TENANT_DB_OWNER`.

The current live production stack has separate Vendor auth and signing-secret wiring. Preserve those secret/override files when deploying; never put the private signing PEM in Git or this package.

## Backups

`deploy/postgres/backup.sh` produces one recoverable archive containing the control-plane dump, one custom PostgreSQL dump per tenant, uploads, an internal SHA-256 manifest, and an outer SHA-256. Daily/weekly/monthly copies are sent off-site. `verify-backup.sh` validates checksums and `pg_restore --list` without modifying a database.

## Gates that still require the real environment

Source syntax/YAML/shell checks can be run on this package, but final production acceptance still requires: full `npm ci` + typecheck/tests/build in the normal development environment; PostgreSQL migration/provisioning integration test; clean-PC Desktop activation with the real public key embedded; offline close/restart test; real thermal-printer test; off-site backup + isolated restore drill; and security/audit remediation of current dependency findings.

Complete two-way Desktop/cloud sync was not present in the uploaded baseline and is **not falsely advertised as complete by this release**. Do not enable an incomplete payment/order sync path in production.
