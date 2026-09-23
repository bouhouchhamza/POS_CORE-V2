-- A single append-safe synchronization projection for editable master data.
-- Source tables keep their own serial ids; sync_id is the cross-database key.
CREATE TABLE master_sync_rows(
  id bigserial PRIMARY KEY,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type varchar(40) NOT NULL,
  entity_id integer NOT NULL,
  sync_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}',
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type,business_id,entity_id),
  UNIQUE(business_id,sync_id)
);
CREATE INDEX master_sync_rows_cursor_idx ON master_sync_rows(business_id,updated_at,id);

-- Units predate the common timestamp convention.  They are now tenant-owned
-- master records (global seed rows deliberately remain outside the stream).
ALTER TABLE units ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE units ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION corepos_capture_master_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; row_business integer; row_id integer;
BEGIN
  IF TG_OP='DELETE' THEN
    row_data:=to_jsonb(OLD)-'id'; row_business:=OLD.business_id; row_id:=OLD.id;
  ELSE
    row_data:=to_jsonb(NEW)-'id'; row_business:=NEW.business_id; row_id:=NEW.id;
  END IF;
  -- Built-in global units have no tenant and must never leak into a device.
  IF row_business IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload,deleted,updated_at)
  VALUES(row_business,TG_ARGV[0],row_id,row_data,TG_OP='DELETE',clock_timestamp())
  ON CONFLICT(entity_type,business_id,entity_id) DO UPDATE SET
    payload=EXCLUDED.payload, deleted=EXCLUDED.deleted, updated_at=EXCLUDED.updated_at;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER master_sync_branches AFTER INSERT OR UPDATE OR DELETE ON branches
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('branches');
CREATE TRIGGER master_sync_settings AFTER INSERT OR UPDATE OR DELETE ON settings
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('settings');
CREATE TRIGGER master_sync_categories AFTER INSERT OR UPDATE OR DELETE ON categories
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('categories');
CREATE TRIGGER master_sync_units AFTER INSERT OR UPDATE OR DELETE ON units
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('units');
CREATE TRIGGER master_sync_products AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('products');
CREATE TRIGGER master_sync_product_variants AFTER INSERT OR UPDATE OR DELETE ON product_variants
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('product_variants');
CREATE TRIGGER master_sync_product_modifiers AFTER INSERT OR UPDATE OR DELETE ON product_modifiers
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('product_modifiers');
CREATE TRIGGER master_sync_customers AFTER INSERT OR UPDATE OR DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('customers');
CREATE TRIGGER master_sync_suppliers AFTER INSERT OR UPDATE OR DELETE ON suppliers
FOR EACH ROW EXECUTE FUNCTION corepos_capture_master_sync('suppliers');

-- Existing merchant data becomes visible to an activated Desktop on its first
-- pull.  The generated sync ids are intentionally independent of serial ids.
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'branches',id,to_jsonb(branches)-'id' FROM branches
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'settings',id,to_jsonb(settings)-'id' FROM settings
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'categories',id,to_jsonb(categories)-'id' FROM categories
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'units',id,to_jsonb(units)-'id' FROM units WHERE business_id IS NOT NULL
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'products',id,to_jsonb(products)-'id' FROM products
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'product_variants',id,to_jsonb(product_variants)-'id' FROM product_variants
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'product_modifiers',id,to_jsonb(product_modifiers)-'id' FROM product_modifiers
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'customers',id,to_jsonb(customers)-'id' FROM customers
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
INSERT INTO master_sync_rows(business_id,entity_type,entity_id,payload)
SELECT business_id,'suppliers',id,to_jsonb(suppliers)-'id' FROM suppliers
ON CONFLICT(entity_type,business_id,entity_id) DO NOTHING;
