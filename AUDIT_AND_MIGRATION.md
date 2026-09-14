# Architecture migration handoff

The original Laravel 13, React 19 and portable-PHP/SQLite installer are retained unchanged as the behavioral and data-migration reference. The new `apps/api` Fastify/Drizzle API mirrors authentication, categories, products, low stock, atomic stock changes, atomic sales, dashboard, daily/monthly reports, users, settings and compatibility response envelopes. `apps/web` is a copy of the existing UI with an environment-driven API base. `apps/desktop` is the Tauri shell and native Windows printing boundary. `deploy` contains PostgreSQL 18, private networking, Caddy TLS, persistent volumes and off-site backup automation.

Key hardening includes strict production origins, HTTPS cookies, hashed rotating refresh tokens, redacted auth logging, generic server errors, login rate limits, disabled public registration, patron authorization on administration, non-root API runtime, no public database/API/static-container ports, no committed production secrets, persistent uploads and verified backups.

The supplied active SQLite file was inspected read-only: 4 users, 4 categories, 5 products, 3 sales, 4 sale items, 4 stock movements and 18 settings; sales and sale-item totals both equal 49.00 and aggregate product stock is 345. These figures are the initial migration acceptance baseline, not permission to reset or overwrite the source.

Remaining release gates are listed in `docs/VALIDATION.md`. Do not remove the Laravel or installer trees until endpoint parity, migrated customer totals, real printer behavior and a signed Windows build have all been validated.
