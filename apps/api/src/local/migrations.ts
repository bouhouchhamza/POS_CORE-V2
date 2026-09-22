export const LOCAL_SCHEMA_VERSION = 12;

export const localMigrations = [{
  version: 1,
  name: "initial_offline_schema",
  sql: `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('patron','worker','owner','admin','manager','cashier','seller','waiter','kitchen','stock_manager')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL, purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price_cents>=0),
      sale_price_cents INTEGER NOT NULL CHECK(sale_price_cents>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
      min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock>=0), track_stock INTEGER NOT NULL DEFAULT 1 CHECK(track_stock IN (0,1)),
      image TEXT, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX products_category_idx ON products(category_id);
    CREATE TABLE cash_register_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, business_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','closed')),
      opened_at TEXT NOT NULL, opened_by_user_id INTEGER NOT NULL REFERENCES users(id), opening_cash_cents INTEGER NOT NULL CHECK(opening_cash_cents>=0),
      opening_note TEXT, closed_at TEXT, closed_by_user_id INTEGER REFERENCES users(id), expected_cash_cents INTEGER,
      actual_cash_cents INTEGER, difference_cents INTEGER, closing_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX cash_register_one_open_idx ON cash_register_sessions(status) WHERE status='open';
    CREATE INDEX cash_register_business_date_idx ON cash_register_sessions(business_date);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      cash_register_session_id INTEGER REFERENCES cash_register_sessions(id) ON DELETE SET NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash', note TEXT, total_cents INTEGER NOT NULL DEFAULT 0,
      profit_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX sales_user_created_idx ON sales(user_id,created_at);
    CREATE INDEX sales_session_idx ON sales(cash_register_session_id);
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0),
      unit_price_cents INTEGER NOT NULL, purchase_price_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL, profit_cents INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX sale_items_sale_idx ON sale_items(sale_id);
    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id),
      user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, quantity INTEGER NOT NULL,
      before_stock INTEGER NOT NULL, after_stock INTEGER NOT NULL CHECK(after_stock>=0), note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX stock_product_created_idx ON stock_movements(product_id,created_at);
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX refresh_user_idx ON refresh_tokens(user_id);
    CREATE TABLE backup_status (
      id INTEGER PRIMARY KEY CHECK(id=1), last_success_at TEXT, last_path TEXT, last_sha256 TEXT,
      state TEXT NOT NULL DEFAULT 'pending', last_error TEXT, upload_attempts INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT
    );
    INSERT INTO backup_status(id,state) VALUES(1,'pending');
  `,
}, {
  version: 2,
  name: "local_menu_import_sessions",
  sql: `
    CREATE TABLE menu_import_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preview_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','confirmed')),
      result_json TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE INDEX menu_import_sessions_user_idx
      ON menu_import_sessions(user_id, created_at);
  `,
}, {
  version: 3,
  name: "core_v2_universal_pos",
  sql: `
    CREATE TABLE businesses(id INTEGER PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,business_type TEXT NOT NULL,logo TEXT,currency TEXT NOT NULL,locale TEXT NOT NULL,timezone TEXT NOT NULL,tax_settings_json TEXT NOT NULL DEFAULT '{}',receipt_settings_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    INSERT INTO businesses SELECT 1,'Bimik Cafe','bimik-cafe','cafe',NULL,'MAD','fr-MA','Africa/Casablanca','{}','{}',datetime('now'),datetime('now') WHERE EXISTS(SELECT 1 FROM users UNION ALL SELECT 1 FROM products UNION ALL SELECT 1 FROM sales LIMIT 1);
    CREATE TABLE branches(id INTEGER PRIMARY KEY,business_id INTEGER NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,code TEXT NOT NULL,address TEXT,phone TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(business_id,code));
    INSERT INTO branches SELECT 1,1,'Principal','MAIN',NULL,NULL,1,datetime('now'),datetime('now') WHERE EXISTS(SELECT 1 FROM businesses WHERE id=1);
    CREATE TABLE business_features(business_id INTEGER NOT NULL REFERENCES businesses(id),feature TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(business_id,feature));
    INSERT INTO business_features SELECT 1,feature,datetime('now') FROM (SELECT 'pos' feature UNION ALL SELECT 'inventory' UNION ALL SELECT 'tables' UNION ALL SELECT 'kitchen' UNION ALL SELECT 'qr_menu' UNION ALL SELECT 'takeaway') WHERE EXISTS(SELECT 1 FROM businesses WHERE id=1);
    ALTER TABLE users ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id); UPDATE users SET business_id=1,branch_id=1 WHERE business_id IS NULL;
    ALTER TABLE categories ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE categories ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1; UPDATE categories SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE products ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE products ADD COLUMN sku TEXT; ALTER TABLE products ADD COLUMN barcode TEXT; ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'; ALTER TABLE products ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0; ALTER TABLE products ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1; ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1; UPDATE products SET business_id=1 WHERE business_id IS NULL;
    ALTER TABLE cash_register_sessions ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE cash_register_sessions ADD COLUMN branch_id INTEGER REFERENCES branches(id); UPDATE cash_register_sessions SET business_id=1,branch_id=1 WHERE business_id IS NULL;
    ALTER TABLE sales ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE sales ADD COLUMN branch_id INTEGER REFERENCES branches(id); ALTER TABLE sales ADD COLUMN client_id TEXT; ALTER TABLE sales ADD COLUMN order_id INTEGER; UPDATE sales SET business_id=1,branch_id=1 WHERE business_id IS NULL;
    ALTER TABLE stock_movements ADD COLUMN business_id INTEGER REFERENCES businesses(id); ALTER TABLE stock_movements ADD COLUMN branch_id INTEGER REFERENCES branches(id); ALTER TABLE stock_movements ADD COLUMN client_id TEXT; UPDATE stock_movements SET business_id=1,branch_id=1 WHERE business_id IS NULL;
    ALTER TABLE settings ADD COLUMN business_id INTEGER REFERENCES businesses(id); UPDATE settings SET business_id=1 WHERE business_id IS NULL;
    CREATE TRIGGER users_default_tenant AFTER INSERT ON users WHEN NEW.business_id IS NULL BEGIN UPDATE users SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1),branch_id=(SELECT id FROM branches ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER categories_default_tenant AFTER INSERT ON categories WHEN NEW.business_id IS NULL BEGIN UPDATE categories SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER products_default_tenant AFTER INSERT ON products WHEN NEW.business_id IS NULL BEGIN UPDATE products SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER cash_default_tenant AFTER INSERT ON cash_register_sessions WHEN NEW.business_id IS NULL BEGIN UPDATE cash_register_sessions SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1),branch_id=(SELECT id FROM branches ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER sales_default_tenant AFTER INSERT ON sales WHEN NEW.business_id IS NULL BEGIN UPDATE sales SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1),branch_id=(SELECT id FROM branches ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER stock_default_tenant AFTER INSERT ON stock_movements WHEN NEW.business_id IS NULL BEGIN UPDATE stock_movements SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1),branch_id=(SELECT id FROM branches ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER settings_default_tenant AFTER INSERT ON settings WHEN NEW.business_id IS NULL BEGIN UPDATE settings SET business_id=(SELECT id FROM businesses ORDER BY id LIMIT 1) WHERE id=NEW.id; END;
    CREATE UNIQUE INDEX sales_business_client_unique ON sales(business_id,client_id) WHERE client_id IS NOT NULL; CREATE UNIQUE INDEX stock_business_client_unique ON stock_movements(business_id,client_id) WHERE client_id IS NOT NULL;
    CREATE TABLE customers(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,phone TEXT,email TEXT,address TEXT,notes TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE suppliers(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,contact TEXT,phone TEXT,email TEXT,address TEXT,notes TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE rooms(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER NOT NULL REFERENCES branches(id),name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE restaurant_tables(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER NOT NULL REFERENCES branches(id),room_id INTEGER NOT NULL REFERENCES rooms(id),table_number TEXT NOT NULL,name TEXT NOT NULL,capacity INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'available',qr_token_hash TEXT NOT NULL UNIQUE,qr_token_hint TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(business_id,branch_id,table_number));
    CREATE TABLE product_variants(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,sku TEXT,barcode TEXT,price_delta_cents INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE product_modifiers(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),product_id INTEGER NOT NULL REFERENCES products(id),name TEXT NOT NULL,price_cents INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),client_id TEXT NOT NULL,order_number TEXT NOT NULL,source TEXT NOT NULL,type TEXT NOT NULL,table_id INTEGER REFERENCES restaurant_tables(id),customer_id INTEGER REFERENCES customers(id),user_id INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',subtotal_cents INTEGER NOT NULL DEFAULT 0,discount_cents INTEGER NOT NULL DEFAULT 0,tax_cents INTEGER NOT NULL DEFAULT 0,total_cents INTEGER NOT NULL DEFAULT 0,payment_status TEXT NOT NULL DEFAULT 'unpaid',sync_status TEXT NOT NULL DEFAULT 'local',notes TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(business_id,client_id),UNIQUE(business_id,order_number));
    CREATE TABLE order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id),variant_id INTEGER REFERENCES product_variants(id),quantity REAL NOT NULL,unit_price_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL DEFAULT 0,tax_cents INTEGER NOT NULL DEFAULT 0,total_cents INTEGER NOT NULL,notes TEXT,preparation_status TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE order_item_modifiers(order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,modifier_id INTEGER NOT NULL REFERENCES product_modifiers(id),name TEXT NOT NULL,price_cents INTEGER NOT NULL,PRIMARY KEY(order_item_id,modifier_id));
    CREATE TABLE purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),supplier_id INTEGER NOT NULL REFERENCES suppliers(id),reference TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',subtotal_cents INTEGER NOT NULL,tax_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,payment_status TEXT NOT NULL,received_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(business_id,reference));
    CREATE TABLE purchase_items(id INTEGER PRIMARY KEY AUTOINCREMENT,purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id),quantity REAL NOT NULL,received_quantity REAL NOT NULL DEFAULT 0,purchase_price_cents INTEGER NOT NULL,tax_cents INTEGER NOT NULL DEFAULT 0,total_cents INTEGER NOT NULL);
    CREATE TABLE table_events(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,resolved_at TEXT,resolved_by_user_id INTEGER REFERENCES users(id));
    CREATE TABLE sync_mutations(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),client_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,operation TEXT NOT NULL,payload_json TEXT NOT NULL,sync_status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(business_id,client_id));
    INSERT INTO orders(business_id,branch_id,client_id,order_number,source,type,user_id,status,subtotal_cents,total_cents,payment_status,sync_status,created_at,updated_at) SELECT 1,1,'legacy-sale-'||id,'LEGACY-'||id,'pos','retail',user_id,'completed',total_cents,total_cents,'paid','local',created_at,updated_at FROM sales;
    UPDATE sales SET order_id=(SELECT id FROM orders WHERE order_number='LEGACY-'||sales.id);
    INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents,total_cents,created_at,updated_at) SELECT s.order_id,i.product_id,i.quantity,i.unit_price_cents,i.total_cents,i.created_at,i.updated_at FROM sale_items i JOIN sales s ON s.id=i.sale_id;
  `,
}, {
  version: 4,
  name: "stable_table_qr_tokens",
  sql: `
    ALTER TABLE restaurant_tables ADD COLUMN qr_public_token TEXT;
    CREATE UNIQUE INDEX restaurant_tables_qr_public_token_unique ON restaurant_tables(qr_public_token) WHERE qr_public_token IS NOT NULL;
  `,
}, {
  version: 5,
  name: "returns_inventory_audit",
  sql: `
    CREATE TABLE sale_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),sale_id INTEGER NOT NULL REFERENCES sales(id),user_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,refund_method TEXT NOT NULL DEFAULT 'original',total_cents INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE sale_return_items(id INTEGER PRIMARY KEY AUTOINCREMENT,return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),product_id INTEGER NOT NULL REFERENCES products(id),quantity REAL NOT NULL CHECK(quantity>0),unit_price_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL);
    CREATE INDEX sale_returns_business_sale_idx ON sale_returns(business_id,sale_id,created_at);
    CREATE TABLE inventory_counts(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),user_id INTEGER NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'draft',reason TEXT,created_at TEXT NOT NULL,confirmed_at TEXT);
    CREATE TABLE inventory_count_items(id INTEGER PRIMARY KEY AUTOINCREMENT,count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id),expected_stock REAL NOT NULL,counted_stock REAL,UNIQUE(count_id,product_id));
    CREATE TABLE purchase_returns(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),purchase_id INTEGER NOT NULL REFERENCES purchases(id),purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),product_id INTEGER NOT NULL REFERENCES products(id),user_id INTEGER NOT NULL REFERENCES users(id),quantity REAL NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,total_cents INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id INTEGER NOT NULL REFERENCES businesses(id),branch_id INTEGER REFERENCES branches(id),user_id INTEGER REFERENCES users(id),action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,description TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX audit_logs_business_created_idx ON audit_logs(business_id,created_at DESC);
  `,
}, {
  version: 6,
  name: "merchant_license_state",
  sql: `
    CREATE TABLE merchant_license_state(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'activation_required',license_id TEXT,certificate_json TEXT,certificate_signature TEXT,device_fingerprint TEXT,expires_at TEXT,last_validated_at TEXT,updated_at TEXT NOT NULL);
    INSERT INTO merchant_license_state(id,status,updated_at) SELECT 1,CASE WHEN EXISTS(SELECT 1 FROM businesses) THEN 'legacy' ELSE 'activation_required' END,datetime('now');
  `,
}, {
  version: 7,
  name: "remove_plaintext_license_identity",
  sql: `
    DROP TABLE IF EXISTS license_device_identity;
  `,
}, {
  version: 8,
  name: "vendor_commercial_binding",
  sql: `
    ALTER TABLE businesses ADD COLUMN vendor_business_id TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN customer_id TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN vendor_business_id TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN business_type TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN allowed_features_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE merchant_license_state ADD COLUMN certificate_id TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN certificate_version INTEGER;
    ALTER TABLE merchant_license_state ADD COLUMN offline_valid_until TEXT;
    ALTER TABLE merchant_license_state ADD COLUMN device_status TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE merchant_license_state ADD COLUMN reason_code TEXT;
    CREATE INDEX businesses_vendor_business_idx ON businesses(vendor_business_id);
  `,
}, {
  version: 9,
  name: "require_vendor_activation_for_legacy_businesses",
  sql: `
    UPDATE merchant_license_state
    SET status='activation_required',
        reason_code='LEGACY_ACTIVATION_REQUIRED',
        updated_at=datetime('now')
    WHERE status='legacy';
  `,
}, {
  version: 10,
  name: "expand_user_roles",
  sql: `
    DROP TRIGGER IF EXISTS users_default_tenant;

    CREATE TABLE users_v10 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(
        role IN (
          'patron',
          'worker',
          'owner',
          'admin',
          'manager',
          'cashier',
          'seller',
          'waiter',
          'kitchen',
          'stock_manager'
        )
      ),
      is_active INTEGER NOT NULL DEFAULT 1
        CHECK(is_active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      business_id INTEGER REFERENCES businesses(id),
      branch_id INTEGER REFERENCES branches(id)
    );

    INSERT INTO users_v10(
      id,
      name,
      email,
      password,
      role,
      is_active,
      created_at,
      updated_at,
      business_id,
      branch_id
    )
    SELECT
      id,
      name,
      email,
      password,
      role,
      is_active,
      created_at,
      updated_at,
      business_id,
      branch_id
    FROM users;

    DROP TABLE users;

    ALTER TABLE users_v10
      RENAME TO users;

    CREATE TRIGGER users_default_tenant
    AFTER INSERT ON users
    WHEN NEW.business_id IS NULL
    BEGIN
      UPDATE users
      SET
        business_id=(
          SELECT id
          FROM businesses
          ORDER BY id
          LIMIT 1
        ),
        branch_id=(
          SELECT id
          FROM branches
          ORDER BY id
          LIMIT 1
        )
      WHERE id=NEW.id;
    END;
  `,
}, {
  version:11,
  name:'unconfigured_empty_business_identity',
  sql:`
    -- Only discard an empty, unbound historical placeholder. Any customer row,
    -- configuration, certificate or operational record preserves the identity.
    CREATE TEMP TABLE empty_placeholder AS SELECT id FROM businesses
    WHERE vendor_business_id IS NULL AND business_type='cafe'
      AND name IN ('Bimik Cafe','Bimik POS') AND slug='bimik-cafe'
      AND (SELECT count(*) FROM businesses)=1
      AND NOT EXISTS(SELECT 1 FROM merchant_license_state WHERE certificate_json IS NOT NULL OR license_id IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM users)
      AND NOT EXISTS(SELECT 1 FROM categories)
      AND NOT EXISTS(SELECT 1 FROM products)
      AND NOT EXISTS(SELECT 1 FROM customers)
      AND NOT EXISTS(SELECT 1 FROM suppliers)
      AND NOT EXISTS(SELECT 1 FROM orders)
      AND NOT EXISTS(SELECT 1 FROM sales)
      AND NOT EXISTS(SELECT 1 FROM purchases)
      AND NOT EXISTS(SELECT 1 FROM settings)
      AND NOT EXISTS(SELECT 1 FROM stock_movements)
      AND NOT EXISTS(SELECT 1 FROM cash_register_sessions)
      AND NOT EXISTS(SELECT 1 FROM rooms)
      AND NOT EXISTS(SELECT 1 FROM sync_mutations)
      AND NOT EXISTS(SELECT 1 FROM audit_logs)
      AND NOT EXISTS(SELECT 1 FROM inventory_counts);
    DELETE FROM business_features WHERE business_id IN (SELECT id FROM empty_placeholder);
    DELETE FROM branches WHERE business_id IN (SELECT id FROM empty_placeholder);
    DELETE FROM businesses WHERE id IN (SELECT id FROM empty_placeholder);
    UPDATE merchant_license_state SET status='activation_required',business_type=NULL,allowed_features_json='[]',reason_code=NULL
      WHERE EXISTS(SELECT 1 FROM empty_placeholder);
    DROP TABLE empty_placeholder;
  `,
}, {
  // Server ids are deliberately separate from SQLite ids. A desktop can
  // create records while disconnected without ever being allowed to choose a
  // hosted primary key.
  version:12,
  name:'cash_register_sync_identity',
  sql:`
    ALTER TABLE cash_register_sessions ADD COLUMN client_id TEXT;
    ALTER TABLE cash_register_sessions ADD COLUMN server_id INTEGER;
    ALTER TABLE cash_register_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local'
      CHECK(sync_status IN ('local','pending','synced','conflict'));
    CREATE UNIQUE INDEX cash_register_client_id_unique
      ON cash_register_sessions(business_id,client_id) WHERE client_id IS NOT NULL;
    CREATE UNIQUE INDEX cash_register_server_id_unique
      ON cash_register_sessions(business_id,server_id) WHERE server_id IS NOT NULL;
    DROP INDEX cash_register_one_open_idx;
    CREATE UNIQUE INDEX cash_register_one_open_idx
      ON cash_register_sessions(business_id,branch_id)
      WHERE status='open' AND sync_status!='conflict';
    CREATE TABLE sync_state(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
}];

