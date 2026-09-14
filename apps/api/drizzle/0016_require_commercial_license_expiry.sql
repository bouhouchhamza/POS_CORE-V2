-- Commercial licences must expire.
--
-- Legacy perpetual licences are granted one transition year from the moment
-- this migration is applied, avoiding an unexpected immediate lockout while
-- ensuring every commercial entitlement becomes renewable and time-bounded.

UPDATE licenses
SET expires_at = now() + interval '1 year',
    updated_at = now()
WHERE expires_at IS NULL;

ALTER TABLE licenses
  ALTER COLUMN expires_at SET NOT NULL;
