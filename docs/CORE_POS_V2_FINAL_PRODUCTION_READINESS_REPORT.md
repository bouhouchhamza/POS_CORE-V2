# Core POS V2 Final Production Readiness Report

Date: 2026-09-10
Repository: C:\Users\pc\Desktop\Core POS V2 Git
Branch: main
Local HEAD: 205465eadf9d406aa544a7ad2c38e6cb8d2fce65
Remote verified: origin -> https://github.com/bouhouchhamza/POS_GLOBAL

## Result

PARTIAL_PASS

Core production signing is fixed and verified. Local API, web, desktop, and installer safety gates passed. Full production-ready status is not claimed because physical Arabic thermal-printer hardware validation and a real external installed Windows desktop .posreq -> Vendor -> .poslic -> UI import cycle were not executed in this session.

## Production Runtime Evidence

- Host: 195.35.0.63
- Production URL: https://pos.workflowtools.space
- API container: core-pos-v2-prod-api-1
- API health: healthy
- /ready: HTTP 200
- Entrypoint: ["/bin/sh","-ec"]
- Command: reads /run/secrets/license_signing_private_key, exports LICENSE_SIGNING_PRIVATE_KEY, then execs Node through su as bimik.
- PID 1 process: node
- PID 1 UID/GID: 100/101
- LICENSE_SIGNING_PRIVATE_KEY: present and non-empty at runtime; value was not printed.
- Secret scan in local source excluding build/upload folders: no private key material found.

## V84 Signing-Key Diagnosis

The original blocker was the Docker secret file being mounted as root:root mode 600 while the API startup shell ran as the non-root bimik user. The mounted secret was present and matched the host file by SHA-256, but command substitution could not read it and exported an empty LICENSE_SIGNING_PRIVATE_KEY. The signing route then failed with "Vendor signing key is not configured."

The production runtime now starts a root wrapper only long enough to read the mounted Docker secret, then immediately execs Node as bimik. This preserves the private key as a Docker secret and avoids copying it into .env, source, frontend, logs, or reports.

## Source Changes Covered By Verification

- apps/api/src/license/crypto.ts: malformed public keys/signatures now fail closed instead of throwing.
- apps/api/src/license/crypto.test.ts: malformed signature, malformed key, and malformed certificate-field regressions covered.
- apps/api/src/core-v2/local-routes.ts and apps/api/src/local/server.ts: malformed or missing persisted certificate data no longer allows stale active state or internal errors.
- apps/api/src/local/server.test.ts: offline import persists after a full local API restart; malformed persisted licence state fails closed.
- apps/api/src/core-v2/routes.ts: production setup status does not suggest provisioning in development mode.
- apps/api/src/server.ts and apps/web cash/POS pages: register/dashboard role handling is aligned for manager, worker, and cashier access.
- apps/web/src/utils/nativePrint.ts and apps/desktop/src-tauri/src/lib.rs: Arabic thermal printing uses raster ESC/POS output through a validated native command, while FR/EN text printing remains available.
- apps/web i18n files: quick-product stock validation copy is present in FR/EN/AR.

## Verification Run On 2026-09-10

- npm run typecheck -w @bimik/api: PASS
- npm run test -w @bimik/api: PASS, 46 passed / 0 failed / 16 skipped
- npm run typecheck -w @bimik/web: PASS
- npm run test -w @bimik/web: PASS, 4 passed / 0 failed
- npm run build -w @bimik/web: PASS
- npm run typecheck -w @bimik/desktop: PASS, warning only for unused PrintError::Unsupported
- npm run test -w @bimik/desktop: PASS, 13 passed / 0 failed
- npm run build -w @bimik/desktop: PASS, produced MSI and NSIS setup
- npm run verify:installer-data-safety -w @bimik/desktop: PASS
- git diff --check: PASS, line-ending warnings only

Generated installer evidence after rebuild:
- MSI: apps/desktop/src-tauri/target/release/bundle/msi/Bimik POS_2.0.8_x64_en-US.msi
- NSIS: apps/desktop/src-tauri/target/release/bundle/nsis/Bimik POS_2.0.8_x64-setup.exe
- Generated NSIS BUNDLEID: bond.nextora.cafe
- NSIS_HOOK_PREUNINSTALL is inserted before AppData deletion checks.

## Remaining Gaps

- Physical Arabic thermal-printer hardware was not available, so raster output is validated by code/tests/build only, not by paper output.
- A real external installed Windows desktop UI activation/import cycle was not performed.
- No claim is made that backups, cloud two-way sync, observability, or performance are fully production-ready beyond the checks explicitly listed here.

DB_MIGRATION=NO
CADDY_CHANGED=NO
CORE_PRODUCTION_RUNTIME_CHANGED=YES
LOCAL_SOURCE_READY_FOR_REVIEW=YES
FINAL_RESULT=PARTIAL_PASS
