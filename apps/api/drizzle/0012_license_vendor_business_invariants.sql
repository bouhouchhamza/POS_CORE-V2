-- 0012_license_vendor_business_invariants.sql
--
-- Strengthen the Vendor control-plane identity introduced in 0011.
--
-- Every licence must belong to exactly one Vendor Business,
-- one Vendor Client, and one explicit business type.
--
-- Runtime businesses may temporarily remain unlinked while the
-- provisioning flow is being migrated. Once linked, their business
-- type must agree with the Vendor Business.

-- Existing runtime-bound legacy licences inherit their real business type.
UPDATE licenses l
SET
    business_type = b.business_type,
    updated_at = now()
FROM business_licenses bl
JOIN businesses b
    ON b.id = bl.business_id
WHERE bl.license_id = l.id
  AND l.business_type IS NULL;

-- Keep already-linked Vendor Businesses aligned with their runtime business.
UPDATE vendor_businesses vb
SET
    business_type = b.business_type,
    updated_at = now()
FROM businesses b
WHERE b.vendor_business_id = vb.id
  AND (
      vb.business_type IS NULL
      OR vb.business_type IS DISTINCT FROM b.business_type
  );

-- Historical/test licences that already have a Vendor Client but do not yet
-- have a Vendor Business receive a dedicated control-plane business.
WITH orphan_licenses AS MATERIALIZED (
    SELECT
        l.id AS license_id,
        gen_random_uuid() AS vendor_business_id,
        l.customer_id,
        COALESCE(
            NULLIF(BTRIM(c.name), ''),
            'License ' || LEFT(l.id::text, 8)
        ) AS business_name,
        COALESCE(
            NULLIF(BTRIM(l.business_type), ''),
            'custom'
        ) AS business_type
    FROM licenses l
    JOIN license_customers c
        ON c.id = l.customer_id
    WHERE l.vendor_business_id IS NULL
),
inserted_vendor_businesses AS (
    INSERT INTO vendor_businesses (
        id,
        customer_id,
        name,
        business_type,
        notes
    )
    SELECT
        vendor_business_id,
        customer_id,
        business_name,
        business_type,
        'Automatic control-plane backfill for existing licence ' ||
        license_id::text
    FROM orphan_licenses
    RETURNING id
)
UPDATE licenses l
SET
    vendor_business_id = o.vendor_business_id,
    business_type = o.business_type,
    updated_at = now()
FROM orphan_licenses o
JOIN inserted_vendor_businesses i
    ON i.id = o.vendor_business_id
WHERE l.id = o.license_id;

-- Any remaining Vendor Business must have an explicit type.
UPDATE vendor_businesses
SET
    business_type = 'custom',
    updated_at = now()
WHERE business_type IS NULL
   OR BTRIM(business_type) = '';

-- A licence inherits the Vendor Business type when still missing.
UPDATE licenses l
SET
    business_type = vb.business_type,
    updated_at = now()
FROM vendor_businesses vb
WHERE vb.id = l.vendor_business_id
  AND (
      l.business_type IS NULL
      OR BTRIM(l.business_type) = ''
  );

ALTER TABLE vendor_businesses
    ALTER COLUMN business_type SET NOT NULL;

ALTER TABLE licenses
    ALTER COLUMN vendor_business_id SET NOT NULL;

ALTER TABLE licenses
    ALTER COLUMN business_type SET NOT NULL;

-- Allows PostgreSQL to enforce that the licence's Vendor Client and
-- business type are the same ones owned by its Vendor Business.
CREATE UNIQUE INDEX vendor_businesses_identity_owner_type_unique
    ON vendor_businesses(id, customer_id, business_type);

ALTER TABLE licenses
    ADD CONSTRAINT licenses_vendor_identity_owner_type_fkey
    FOREIGN KEY (
        vendor_business_id,
        customer_id,
        business_type
    )
    REFERENCES vendor_businesses(
        id,
        customer_id,
        business_type
    );

-- Runtime businesses are still temporarily allowed to have a NULL
-- vendor_business_id during provisioning migration. Once a UUID is present,
-- PostgreSQL enforces the business type relationship.
CREATE UNIQUE INDEX vendor_businesses_identity_type_unique
    ON vendor_businesses(id, business_type);

ALTER TABLE businesses
    ADD CONSTRAINT businesses_vendor_identity_type_fkey
    FOREIGN KEY (
        vendor_business_id,
        business_type
    )
    REFERENCES vendor_businesses(
        id,
        business_type
    );