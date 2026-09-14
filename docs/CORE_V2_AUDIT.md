# Core V2 Audit

The production React, Fastify, PostgreSQL, SQLite, Tauri, printing, and reporting paths remain canonical. Core V2 is additive: existing cafe products, sales, stock, users, settings, and images are retained and assigned to a migrated default cafe business.

Implemented surfaces include tenant-scoped business configuration, modules, universal orders, retail inventory fields, suppliers, purchases/receiving, rooms/tables, QR ordering and service requests, kitchen workflow, and a persistent local sync outbox.

Cross-device synchronization is intentionally limited to an idempotent order ingestion API plus the local durable outbox. Automatic background transport requires deployment-specific cloud endpoint credentials and is not claimed as complete.
