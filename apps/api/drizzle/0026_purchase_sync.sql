ALTER TABLE purchases ADD COLUMN IF NOT EXISTS sync_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS sync_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS stock_client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_business_sync_id_unique ON purchases(business_id,sync_id);
CREATE INDEX IF NOT EXISTS purchases_business_sync_cursor_idx ON purchases(business_id,sync_updated_at,id);
CREATE OR REPLACE FUNCTION corepos_capture_purchase_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_updated_at=clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS purchase_sync_touch ON purchases;
CREATE TRIGGER purchase_sync_touch BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION corepos_capture_purchase_sync();
