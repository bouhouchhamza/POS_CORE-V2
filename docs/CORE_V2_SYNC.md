# CorePOS synchronization matrix

Desktop is offline-first: supported Desktop writes commit to SQLite before any
network work. The device-bound synchronizer is reconciliation infrastructure,
not a dependency of POS operation. A device resolves its tenant and Business
from the active certificate and Ed25519 proof; a client never supplies either
as authority.

## Current implementation

The hosted Web and mobile/installable browser use the same React/Vite runtime.
There is no service worker, Cache API, IndexedDB store, or browser outbox in
this repository. PWA business writes are therefore online-only hosted writes;
they are not an offline client and must not be presented as one.

| Entity | Web / PWA | Desktop | PWA offline | Desktop offline | Authority | Push / pull | Delete / conflict / dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- |
| businesses | Read after hosted login | Bootstrap read | No | Bootstrap only | Hosted | Bootstrap pull | Never client-deleted; root for all business data |
| branches | Hosted CRUD/read | Bootstrap read | No | Existing local read | Hosted | Not implemented | Deactivate/tombstone; dependency of users, tables, cash, orders |
| business_features | Hosted entitlement | Signed bootstrap read | No | Certificate read | Hosted licence | Bootstrap pull | No merchant write; gates modules |
| settings | Hosted CRUD | Local CRUD | No | Yes | Needs explicit policy | Not implemented | Version conflict; depends on business |
| users / profiles | Hosted management/login | Signed local profile bootstrap/login | No | Login only with existing verifier | Hosted security state | Bootstrap only | Deactivate tombstone; never plaintext verifier |
| categories | Hosted CRUD | Local CRUD | No | Yes | Intended bidirectional | Not implemented | Tombstone/version; product dependency |
| units | Hosted table, no local parity table | Not exposed locally | No | No | Hosted | Not implemented | Hosted/dependency of products |
| products | Hosted CRUD/stock APIs | Local CRUD/sales | No | Yes | Intended bidirectional master + stock events | Not implemented | Tombstone/version; category/unit/variant dependency |
| product_variants / modifiers | Hosted CRUD | Local CRUD | No | Yes | Intended bidirectional | Not implemented | Tombstone/version; product dependency |
| customers / suppliers | Hosted CRUD | Local CRUD | No | Yes | Intended bidirectional | Not implemented | Tombstone/version; referenced by orders/purchases |
| cash_register_sessions | Hosted open/close | Local open/close | No | Yes | Bidirectional state machine | Implemented | Explicit open conflict; branch dependency |
| sales / sale items / payments | Hosted transaction | Local transaction | No | Yes | Immutable event stream | Not implemented | Idempotent immutable sale/payment; cash/product dependencies |
| sale_returns | Hosted transaction | Local transaction | No | Yes | Immutable event stream | Not implemented | Explicit return event; sale/item dependency |
| orders / items / kitchen state | Hosted CRUD/state | Local CRUD/state | No | Yes | State machine | Local outbox primitive only | Client UUID create; explicit transition conflicts; table/product dependency |
| rooms / restaurant_tables | Hosted CRUD | Local CRUD | No | Yes | Topology/state split | Not implemented | Tombstone/version; branch/room dependency; never transfer QR secret authority |
| table_events | Hosted operational events | Local operational events | No | Yes | Immutable/state event | Not implemented | Idempotent event; table dependency |
| stock_movements / inventory_counts | Hosted event/count | Local event/count | No | Yes | Event-derived stock | Not implemented | Never overwrite stock; product dependency |
| purchases / purchase_returns | Hosted transaction | Local transaction | No | Yes | Immutable event stream | Not implemented | Idempotent receipt/return events; supplier/product dependency |
| library-specific entities | Hosted only where enabled | No confirmed local parity | No | No | Hosted | Not implemented | Excluded until matching Desktop contract exists |
| audit logs, migration tables, backup state, refresh tokens, licence/device state, provisioning data, tenant credentials and signing keys | Internal | Internal | N/A | N/A | Server/control plane | Never | Never business-sync entities |

| Entity class | Classification | Current transport | Identity/conflict rule |
| --- | --- | --- | --- |
| Business, branches, business features, settings | server-authoritative bootstrap data | Certificate/bootstrap only | Hosted IDs; Desktop must not invent commercial configuration |
| Users/profiles | server-authoritative security data | Certificate/bootstrap verifier only | Hosted verifier is copied verbatim; no plaintext or rehash |
| Categories, units, products, variants, modifiers | intended bidirectional master data | Not implemented | Requires stable server/local mapping, version and tombstone contract |
| Customers, suppliers | intended bidirectional master data | Not implemented | Requires stable server/local mapping, version and tombstone contract |
| Cash-register sessions | bidirectional state machine | Implemented | Local UUID mutation ID, server session ID, strict pull cursor, explicit conflict state |
| Sales, sale items, payments, returns | immutable transactional events | Not implemented (orders only have a local outbox primitive) | Must be server-idempotent event ingestion; never quantity/total overwrite |
| Orders, order items, kitchen states | bidirectional state machine | Not implemented (local order outbox exists only) | Client UUID for create; transition/version conflict rules required |
| Stock movements, inventory counts | event-derived / bidirectional events | Not implemented | Sync events, not product stock snapshots |
| Purchases and purchase returns | immutable transactional events | Not implemented | Client UUID plus server idempotency and dependency mapping required |
| Rooms, restaurant tables, table events | server-authoritative topology plus event state | Not implemented | Pull rooms/tables before orders; QR secrets are never replicated as authority |
| Audit logs, backups, refresh tokens, licence/device state, provisioning data | derived or never synchronized | Not implemented by design | Security/control-plane data never enters merchant sync |

## Cash-register protocol

1. Desktop user action commits the local session and outbox mutation in one
   SQLite transaction.
2. A module-wide single-flight worker pushes pending cash mutations in order.
3. The server resolves tenant and Business from the signed device identity,
   deduplicates `(business_id, client_id)`, and returns the hosted session ID.
4. Local ACK atomically marks only that mutation synced and updates queued
   close mutations with the hosted session ID.
5. The worker pulls server rows using a strict `(updated_at, id)` cursor.
6. SQLite applies a newer cursor transactionally. Older/reordered pull results
   are ignored. Remote applies write tables directly and never enqueue an
   outbox mutation.
7. A successful apply emits `cash-register-changed`; UI consumers refetch
   SQLite state and ignore older in-flight responses.

The legacy `/api/sync/cash-register/apply` endpoint remains only for local
compatibility. Desktop reconciliation uses `/apply-v2`.

## Required foundation before more entities are enabled

Every new entity contract must provide: a device-bound endpoint, durable
outbox mutation ID, server deduplication, server/local ID mapping, opaque
strict cursor, transactional apply, deletion tombstone, dependency ordering,
explicit conflict state, and PostgreSQL + SQLite integration coverage in both
shared and database-per-tenant modes. Transactional entities must use events
or immutable client identities rather than last-write-wins.

CorePOS must not be described as complete Web/Desktop synchronization until
the intentionally unimplemented rows above have those contracts and tests.
