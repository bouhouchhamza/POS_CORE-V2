# Core V2 Migration

PostgreSQL migration `0005_core_v2_universal_pos.sql` and SQLite migration version 3 are additive. They create the default business and branch, backfill tenant columns, enable cafe defaults, and adapt historical sales into universal order records without deleting legacy rows.

Legacy identifiers, images, prices, stock, reports, settings, receipts, and cash sessions remain in place. Migrations must run through the existing startup/deployment migration mechanism and must not be replaced by database resets.
