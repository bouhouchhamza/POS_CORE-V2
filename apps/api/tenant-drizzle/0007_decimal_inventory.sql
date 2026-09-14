ALTER TABLE products
  ALTER COLUMN stock TYPE numeric(14,3) USING stock::numeric,
  ALTER COLUMN min_stock TYPE numeric(14,3) USING min_stock::numeric;

ALTER TABLE stock_movements
  ALTER COLUMN quantity TYPE numeric(14,3) USING quantity::numeric,
  ALTER COLUMN before_stock TYPE numeric(14,3) USING before_stock::numeric,
  ALTER COLUMN after_stock TYPE numeric(14,3) USING after_stock::numeric;
