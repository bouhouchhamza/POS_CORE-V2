-- One-time device activation credentials.
--
-- Commercial licences are renewable entitlements. They are NOT handed to
-- clients as reusable activation secrets. Each Desktop/Mobile activation uses
-- a short-lived one-time code stored only as a SHA-256 hash.

CREATE TABLE IF NOT EXISTS license_activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  key_hash varchar(64) NOT NULL UNIQUE,
  key_hint varchar(16),
  channel varchar(20) NOT NULL CHECK(channel IN ('desktop','mobile','web')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_device_id uuid REFERENCES license_devices(id),
  revoked_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_activation_codes_consumption_check CHECK (
    (consumed_at IS NULL AND consumed_device_id IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_device_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS license_activation_codes_lookup_idx
  ON license_activation_codes(key_hash, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS license_activation_codes_license_idx
  ON license_activation_codes(license_id, created_at DESC);

CREATE INDEX IF NOT EXISTS license_activation_codes_status_idx
  ON license_activation_codes(channel, consumed_at, revoked_at, expires_at);
