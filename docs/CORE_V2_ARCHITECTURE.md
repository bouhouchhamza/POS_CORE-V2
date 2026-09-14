# Core V2 Architecture

Core V2 extends the existing shared monorepo. `businesses` own operational records; `branches` provide optional location scope. An authenticated user's stored business and branch select the tenant, never request-provided tenant identifiers.

Business type supplies recommended defaults. `business_features` controls capabilities independently of role permissions. PostgreSQL and local SQLite expose equivalent Core V2 route contracts. The React client uses those contracts in web and Tauri modes.

The universal `orders` and `order_items` model supports retail, dine-in, takeaway, and delivery sources while restaurant fields remain nullable.
