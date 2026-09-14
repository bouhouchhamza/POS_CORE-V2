-- 0011_vendor_business_control_plane.sql
--
-- Introduces a stable Vendor-side business identity shared by
-- cloud/web, desktop, mobile and public merchant channels.
--
-- Runtime businesses.id remains an internal POS database identifier.
-- vendor_businesses.id is the canonical commercial identity.

CREATE TABLE vendor_businesses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    customer_id uuid NOT NULL
        REFERENCES license_customers(id),

    name text NOT NULL,

    business_type varchar(40),

    status varchar(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed')),

    notes text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_businesses_customer_idx
    ON vendor_businesses(customer_id);

ALTER TABLE businesses
    ADD COLUMN vendor_business_id uuid;

ALTER TABLE businesses
    ADD CONSTRAINT businesses_vendor_business_id_fkey
    FOREIGN KEY (vendor_business_id)
    REFERENCES vendor_businesses(id);

CREATE UNIQUE INDEX businesses_vendor_business_id_unique
    ON businesses(vendor_business_id)
    WHERE vendor_business_id IS NOT NULL;

ALTER TABLE licenses
    ADD COLUMN vendor_business_id uuid;

ALTER TABLE licenses
    ADD CONSTRAINT licenses_vendor_business_id_fkey
    FOREIGN KEY (vendor_business_id)
    REFERENCES vendor_businesses(id);

CREATE INDEX licenses_vendor_business_idx
    ON licenses(vendor_business_id);

-- Backfill every existing POS business into the Vendor control plane.
--
-- If the currently bound licence already belongs to a Vendor customer,
-- preserve that customer.
--
-- Legacy licences created by migration 0009 have customer_id = NULL,
-- so create one Vendor customer per existing legacy business.
DO $$
DECLARE
    record_item RECORD;
    resolved_customer_id uuid;
    created_vendor_business_id uuid;
BEGIN
    FOR record_item IN
        SELECT
            b.id AS business_id,
            b.name AS business_name,
            b.business_type,
            bl.license_id,
            l.customer_id
        FROM businesses b
        LEFT JOIN business_licenses bl
            ON bl.business_id = b.id
        LEFT JOIN licenses l
            ON l.id = bl.license_id
        WHERE b.vendor_business_id IS NULL
        ORDER BY b.id
    LOOP
        resolved_customer_id := record_item.customer_id;

        IF resolved_customer_id IS NULL THEN
            INSERT INTO license_customers (
                name,
                notes
            )
            VALUES (
                COALESCE(
                    NULLIF(BTRIM(record_item.business_name), ''),
                    'Business #' || record_item.business_id::text
                ),
                'Automatic Vendor control-plane backfill for POS business #' ||
                record_item.business_id::text
            )
            RETURNING id
            INTO resolved_customer_id;

            IF record_item.license_id IS NOT NULL THEN
                UPDATE licenses
                SET
                    customer_id = resolved_customer_id,
                    updated_at = now()
                WHERE id = record_item.license_id
                  AND customer_id IS NULL;
            END IF;
        END IF;

        INSERT INTO vendor_businesses (
            customer_id,
            name,
            business_type,
            notes
        )
        VALUES (
            resolved_customer_id,
            COALESCE(
                NULLIF(BTRIM(record_item.business_name), ''),
                'Business #' || record_item.business_id::text
            ),
            record_item.business_type,
            'Backfilled from runtime POS business #' ||
            record_item.business_id::text
        )
        RETURNING id
        INTO created_vendor_business_id;

        UPDATE businesses
        SET
            vendor_business_id = created_vendor_business_id,
            updated_at = now()
        WHERE id = record_item.business_id;

        IF record_item.license_id IS NOT NULL THEN
            UPDATE licenses
            SET
                vendor_business_id = created_vendor_business_id,
                updated_at = now()
            WHERE id = record_item.license_id;
        END IF;
    END LOOP;
END
$$;

-- Ensure every currently bound licence inherits the canonical
-- Vendor Business UUID from its runtime POS business.
UPDATE licenses l
SET
    vendor_business_id = b.vendor_business_id,
    updated_at = now()
FROM business_licenses bl
INNER JOIN businesses b
    ON b.id = bl.business_id
WHERE bl.license_id = l.id
  AND b.vendor_business_id IS NOT NULL
  AND l.vendor_business_id IS DISTINCT FROM b.vendor_business_id;

-- Every commercial licence must belong to a Vendor Client.
-- Existing legacy licences have been assigned above before this constraint.
ALTER TABLE licenses
    ALTER COLUMN customer_id SET NOT NULL;
