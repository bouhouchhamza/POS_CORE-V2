CREATE OR REPLACE FUNCTION corepos_stock_movement_client_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_id IS NULL THEN NEW.client_id=gen_random_uuid(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_movement_client_id ON stock_movements;
CREATE TRIGGER stock_movement_client_id BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION corepos_stock_movement_client_id();
