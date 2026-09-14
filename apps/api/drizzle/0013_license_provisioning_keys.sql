-- One-time commercial provisioning credentials.
--
-- The plaintext provisioning key is shown only at issuance time.
-- Only its SHA-256 hash and a non-secret hint are persisted.
--
-- A provisioning key resolves through licenses to the canonical
-- Vendor Client / Vendor Business / business type / plan / modules.
--
-- Successful consumption must happen atomically with creation of
-- the runtime business and business_licenses binding.

CREATE TABLE license_provisioning_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    license_id uuid NOT NULL
        REFERENCES licenses(id),

    key_hash varchar(64) NOT NULL,
    key_hint varchar(16),

    channel varchar(30) NOT NULL DEFAULT 'cloud',

    expires_at timestamptz,

    consumed_at timestamptz,
    consumed_business_id integer
        REFERENCES businesses(id),

    revoked_at timestamptz,

    notes text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT license_provisioning_keys_key_hash_unique
        UNIQUE(key_hash),

    CONSTRAINT license_provisioning_keys_channel_check
        CHECK(channel IN ('cloud','desktop','mobile')),

    CONSTRAINT license_provisioning_keys_consumption_check
        CHECK(
            (
                consumed_at IS NULL
                AND consumed_business_id IS NULL
            )
            OR
            (
                consumed_at IS NOT NULL
                AND consumed_business_id IS NOT NULL
            )
        )
);

CREATE INDEX license_provisioning_keys_license_idx
    ON license_provisioning_keys(license_id);

CREATE INDEX license_provisioning_keys_lookup_idx
    ON license_provisioning_keys(key_hash, revoked_at, expires_at);

-- One runtime business can only be the successful consumption target
-- of one provisioning credential.
CREATE UNIQUE INDEX license_provisioning_keys_consumed_business_unique
    ON license_provisioning_keys(consumed_business_id)
    WHERE consumed_business_id IS NOT NULL;

-- A commercial licence can successfully provision a runtime business
-- only once. Multiple unused/revoked replacement keys may still exist.
CREATE UNIQUE INDEX license_provisioning_keys_consumed_license_unique
    ON license_provisioning_keys(license_id)
    WHERE consumed_at IS NOT NULL;