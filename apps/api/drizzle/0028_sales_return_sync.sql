ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE sale_returns ADD COLUMN IF NOT EXISTS sync_updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_business_client_unique ON sale_returns(business_id,client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_business_sync_cursor_idx ON sales(business_id,updated_at,id);
CREATE INDEX IF NOT EXISTS sale_returns_business_sync_cursor_idx ON sale_returns(business_id,sync_updated_at,id);
CREATE OR REPLACE FUNCTION corepos_capture_sale_return_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.sync_updated_at=clock_timestamp(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS sale_return_sync_touch ON sale_returns;
CREATE TRIGGER sale_return_sync_touch BEFORE UPDATE ON sale_returns FOR EACH ROW EXECUTE FUNCTION corepos_capture_sale_return_sync();
