# Validation and release gates

- Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in the canonical Windows development repository.
- Apply control-plane migrations through `0016` to a disposable PostgreSQL 18 database and verify migration replay is clean.
- In `database_per_tenant` mode, provision two test Vendor Businesses and prove that each has a different database, that workspace A cannot use workspace B's JWT, and that records/uploads never cross tenants.
- Exercise one-time Desktop activation: a fresh code activates exactly one device, the second use is rejected, expired/revoked codes are rejected, a revoked device frees a slot, and total/per-channel device limits are enforced.
- Build the Windows installer with `npm run build:production-installer -w @corepos/desktop`; a release build without the production public verification key must fail.
- On a clean Windows PC, activate without PowerShell environment injection, close all CorePOS processes, disconnect networking, reopen from the normal shortcut, login and use licensed POS modules.
- Verify commercial expiry and renewal; `offline_validity_days=null` must not bypass `expires_at`.
- Run the actual thermal printer on 58/80mm where applicable, including FR/EN and Arabic raster receipts.
- Run the SaaS backup, verify its outer and inner checksums, then restore the control plane and one tenant into isolated recovery databases. Never overwrite production during a drill.
- Review current npm audit findings manually and remediate exploitable production paths; never use `npm audit fix --force` blindly.
- Do not declare full bidirectional cloud/Desktop sync until its worker, authentication, idempotency, conflict handling, payment/order/inventory safety, and reconnect E2E are implemented and tested.
