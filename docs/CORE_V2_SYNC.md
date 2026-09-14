# Core V2 Sync

Local order creation uses client UUIDs and writes the order plus a durable `sync_mutations` outbox entry in one SQLite transaction. Cloud ingestion is idempotent on `(business_id, client_id)`. Outbox entries expose pending, failed, retry, and acknowledgement operations.

Automatic cloud transport is deployment-dependent and not enabled by this repository because no secure local-to-cloud credential or endpoint policy exists. Payments are not replayed by the Core V2 sync foundation. Operators should not describe this as complete bidirectional cross-device sync.
