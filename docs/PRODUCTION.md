# Bimik Cafe production operations

## Architecture

The browser and Tauri client use HTTPS at `cafe.doublelibrary.online`. Caddy terminates TLS and routes `/api`, `/health`, `/ready` and `/uploads` to Fastify; all other paths go to the static React container. Fastify alone reaches PostgreSQL 18 on the private Compose network. PostgreSQL, API and web have no host ports. Uploads, database data and Caddy certificates use named volumes. The backup container creates verified custom-format dumps and sends them to private S3-compatible off-site storage.

## Initial VPS deployment

Install Ubuntu security updates, Docker Engine and Compose plugin. Create a non-root deploy user, use SSH keys, disable password/root SSH after verifying access, and configure UFW to allow `OpenSSH`, `80/tcp` and `443/tcp` only. Point the DNS A/AAAA records at the VPS.

Clone the repository, copy `deploy/.env.production.example` to `deploy/.env.production`, generate independent strong PostgreSQL/JWT credentials, and configure a least-privilege private backup bucket credential. Never commit the env file. Run:

`docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml build`

`docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml up -d postgres`

Apply `apps/api/drizzle/0000_initial.sql` with `docker compose exec -T postgres psql ...`, migrate customer data following `DATA_MIGRATION.md`, then start the full stack. Verify `https://cafe.doublelibrary.online/health` and `/ready`, login, create a test sale only in an approved test database, and inspect container health. Compose restart policies provide reboot recovery.

## Safe GitHub update

Create and validate a fresh off-site backup first. Fetch and review the release, build new images without stopping PostgreSQL, apply forward-only schema migrations, then run `docker compose ... up -d --remove-orphans`. Check health, readiness, logs and a read-only smoke test. Named database/upload/certificate volumes are not replaced. Roll back application images to the prior tag if necessary; restore data only when a migration is not backward-compatible.

## Restore

Download the selected `.dump` and `.sha256` from private storage, run `sha256sum -c`, and validate with PostgreSQL 18 `pg_restore --list`. Stop API writes. Restore into a new empty database with `pg_restore --clean --if-exists --no-owner --no-acl`, run integrity/count/financial checks, then switch `DATABASE_URL` during a controlled maintenance window. Never restore unverified data over the only production database.

## Development

On Windows PowerShell run `docker compose -f deploy/docker-compose.dev.yml up -d`, `Copy-Item apps/api/.env.example apps/api/.env` once, `npm install`, `npm run db:migrate`, then `npm run dev`. The root script builds both shared workspaces before starting Fastify and Vite. Use `npm run dev:api` or `npm run dev:web` for one side. Vite proxies `/api` and `/uploads` to `127.0.0.1:3000`. Edit the untracked `.env` if the active database is named `bimik_cafe_import`; never commit it.

For Tauri, copy `apps/web/.env.desktop.example` to the untracked `apps/web/.env.desktop` and set the hosted HTTPS API. The Tauri build uses Vite desktop mode; the browser build continues to use same-origin `/api`. Routine validation must not publish or build a customer installer.

## Authentication and printing

The intentionally café-specific password/PIN rule is one character minimum for both roles. A stronger Patron password is normally recommended in production; protect this owner-approved exception with HTTPS, rate limiting, restricted administration and prompt account deactivation.

Access JWTs are short-lived and held only in memory. Browser/Tauri refresh tokens are opaque, hashed in PostgreSQL, rotated on use, and sent only as HttpOnly Secure SameSite cookies. Logout revokes refresh state. CORS is an exact-origin allowlist including the configured Tauri origin, and login is rate-limited.

The server never attempts to reach the café USB printer. React remains the receipt source of truth. The Tauri command validates printer name, payload size and copy count before submitting RAW receipt bytes to the selected Windows print queue; browser printing remains the fallback. Confirm model-specific ESC/POS encoding, cut command, drawer pulse, USB/LAN queue name and 58/80mm output on the real printer before releasing an installer.
