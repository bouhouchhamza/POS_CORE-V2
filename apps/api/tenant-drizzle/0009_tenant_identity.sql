-- Tenant-only identity. The canonical Vendor Business row remains in the
-- control-plane database, so this UUID intentionally has no cross-database FK.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS vendor_business_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_vendor_business_id_unique
  ON businesses(vendor_business_id)
  WHERE vendor_business_id IS NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(
  role IN ('patron','worker','owner','admin','manager','cashier','seller','waiter','kitchen','stock_manager')
);
