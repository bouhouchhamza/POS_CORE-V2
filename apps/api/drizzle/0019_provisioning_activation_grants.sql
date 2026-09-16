-- Short-lived, one-time browser handoff from successful tenant provisioning
-- to device activation. Only the SHA-256 hash is stored; the opaque grant is
-- delivered in a narrowly scoped HttpOnly cookie.
CREATE TABLE IF NOT EXISTS provisioning_activation_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provisioning_key_id uuid NOT NULL UNIQUE
    REFERENCES license_provisioning_keys(id) ON DELETE CASCADE,
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  vendor_business_id uuid NOT NULL REFERENCES vendor_businesses(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES saas_tenants(id) ON DELETE CASCADE,
  grant_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_device_id uuid REFERENCES license_devices(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisioning_activation_grants_consumption_check CHECK (
    (consumed_at IS NULL AND consumed_device_id IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_device_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS provisioning_activation_grants_lookup_idx
  ON provisioning_activation_grants(grant_hash, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS provisioning_activation_grants_tenant_idx
  ON provisioning_activation_grants(tenant_id, created_at DESC);
