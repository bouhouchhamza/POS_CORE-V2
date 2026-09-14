-- A NULL commercial expiry explicitly represents a Lifetime licence.
-- Existing dated licences are left unchanged.

ALTER TABLE licenses
  ALTER COLUMN expires_at DROP NOT NULL;
