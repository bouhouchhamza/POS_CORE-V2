# Core POS V2 SaaS tenancy: database per client business

## Control plane

The control-plane PostgreSQL database contains Vendor customers, Vendor Businesses, plans, commercial licences, one-time activation/provisioning credentials, registered devices, audit logs, and `saas_tenants`. It is the only database used to decide which operational database belongs to a Vendor Business.

## Tenant databases

With `SAAS_TENANCY_MODE=database_per_tenant`, each provisioned Vendor Business receives one PostgreSQL database. A visible business name such as `Atlas Café` can produce an immutable technical identity such as `atlas-cafe-a31f7c82` and database `corepos_atlas_cafe_a31f7c82`. The UUID suffix prevents collisions and makes renaming the visible business safe.

Client requests never provide a database name, tenant ID, or workspace slug. Desktop activation creates a registered Vendor device and the API issues a signed HttpOnly activated-device cookie containing only the device reference. On startup the control plane validates that device, its licence and Vendor Business, resolves `saas_tenants`, and only then establishes the operational database context. JWT access tokens contain the resolved tenant ID and are rejected in another tenant context.

Public table QRs contain only a high-entropy table token (`/m/:token`). The control plane stores its SHA-256 hash in `public_table_links`; that binding resolves the tenant database and expected table before any public menu query runs. Internal tenant slugs are not encoded in newly generated QRs.

Operational records (users, orders, sales, payments, products, stock, suppliers, purchases, customers, tables, kitchen data, settings and tenant uploads) stay in that client's database/upload namespace. The control plane may keep a minimal shadow `businesses` row solely for backward-compatible control-plane relationships.

## Provisioning

The Vendor creates the client, Vendor Business and licence, then issues a one-time cloud provisioning credential. When the customer consumes it, the API creates/migrates the dedicated database, creates the initial business/branch/patron, stores the tenant registry record, binds the licence, and consumes the provisioning credential in a transaction. The same transaction creates a ten-minute, single-use activation grant bound to that provisioning key, licence, Vendor Business, and tenant. Its opaque value is delivered only in a narrowly scoped HttpOnly cookie and is exchanged for the activated-device cookie; it is never exposed in a URL or browser storage. A consumed provisioning credential cannot create a second workspace.

## Migration safety

Do not automatically split an existing live shared database without a verified backup and reconciliation. Existing production data must be migrated client by client into a new tenant database, validated for record counts/financial totals/inventory, and only then cut over. Never restore or migrate destructively over the live database.
