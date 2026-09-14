# Core POS V2 SaaS tenancy: database per client business

## Control plane

The control-plane PostgreSQL database contains Vendor customers, Vendor Businesses, plans, commercial licences, one-time activation/provisioning credentials, registered devices, audit logs, and `saas_tenants`. It is the only database used to decide which operational database belongs to a Vendor Business.

## Tenant databases

With `SAAS_TENANCY_MODE=database_per_tenant`, each provisioned Vendor Business receives one PostgreSQL database. A visible business name such as `Atlas Café` can produce an immutable technical identity such as `atlas-cafe-a31f7c82` and database `corepos_atlas_cafe_a31f7c82`. The UUID suffix prevents collisions and makes renaming the visible business safe.

Client requests never provide a database name. The browser sends only the workspace slug in `X-Bimik-Tenant`; the API resolves that slug through `saas_tenants`, establishes the request tenant context, and then operational DB calls use that resolved database. JWT access tokens contain the tenant ID and are rejected when used against a different workspace.

Operational records (users, orders, sales, payments, products, stock, suppliers, purchases, customers, tables, kitchen data, settings and tenant uploads) stay in that client's database/upload namespace. The control plane may keep a minimal shadow `businesses` row solely for backward-compatible control-plane relationships.

## Provisioning

The Vendor creates the client, Vendor Business and licence, then issues a one-time cloud provisioning credential. When the customer consumes it, the API creates/migrates the dedicated database, creates the initial business/branch/patron, stores the tenant registry record, binds the licence, and consumes the provisioning credential in a transaction. A consumed provisioning credential cannot create a second workspace.

## Migration safety

Do not automatically split an existing live shared database without a verified backup and reconciliation. Existing production data must be migrated client by client into a new tenant database, validated for record counts/financial totals/inventory, and only then cut over. Never restore or migrate destructively over the live database.
