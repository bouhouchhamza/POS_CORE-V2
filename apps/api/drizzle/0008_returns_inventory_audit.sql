CREATE TABLE sale_returns (
  id serial PRIMARY KEY, business_id integer NOT NULL REFERENCES businesses(id), branch_id integer REFERENCES branches(id),
  sale_id integer NOT NULL REFERENCES sales(id), user_id integer NOT NULL REFERENCES users(id), reason text NOT NULL,
  refund_method varchar(30) NOT NULL DEFAULT 'original', total numeric(12,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sale_return_items (
  id serial PRIMARY KEY, return_id integer NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id integer NOT NULL REFERENCES sale_items(id), product_id integer NOT NULL REFERENCES products(id),
  quantity numeric(14,3) NOT NULL CHECK(quantity>0), unit_price numeric(12,2) NOT NULL, total numeric(12,2) NOT NULL
);
CREATE INDEX sale_returns_business_sale_idx ON sale_returns(business_id,sale_id,created_at);

CREATE TABLE inventory_counts (
  id serial PRIMARY KEY, business_id integer NOT NULL REFERENCES businesses(id), branch_id integer REFERENCES branches(id),
  user_id integer NOT NULL REFERENCES users(id), status varchar(20) NOT NULL DEFAULT 'draft', reason text,
  created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE inventory_count_items (
  id serial PRIMARY KEY, count_id integer NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id), expected_stock numeric(14,3) NOT NULL,
  counted_stock numeric(14,3), UNIQUE(count_id,product_id)
);
CREATE INDEX inventory_counts_business_idx ON inventory_counts(business_id,created_at);

CREATE TABLE purchase_returns (
  id serial PRIMARY KEY, business_id integer NOT NULL REFERENCES businesses(id), branch_id integer REFERENCES branches(id),
  purchase_id integer NOT NULL REFERENCES purchases(id), purchase_item_id integer NOT NULL REFERENCES purchase_items(id),
  product_id integer NOT NULL REFERENCES products(id), user_id integer NOT NULL REFERENCES users(id),
  quantity numeric(14,3) NOT NULL CHECK(quantity>0), reason text NOT NULL, total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_returns_business_purchase_idx ON purchase_returns(business_id,purchase_id,created_at);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY, business_id integer NOT NULL REFERENCES businesses(id), branch_id integer REFERENCES branches(id),
  user_id integer REFERENCES users(id), action varchar(80) NOT NULL, entity_type varchar(60) NOT NULL,
  entity_id varchar(100), description text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_business_created_idx ON audit_logs(business_id,created_at DESC);
