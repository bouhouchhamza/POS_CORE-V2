ALTER TABLE restaurant_tables ADD COLUMN qr_public_token varchar(64);
CREATE UNIQUE INDEX restaurant_tables_qr_public_token_unique ON restaurant_tables(qr_public_token) WHERE qr_public_token IS NOT NULL;
