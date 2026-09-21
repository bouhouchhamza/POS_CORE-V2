-- Internal, replay-safe recipe used to finish or retry Vendor-created
-- business provisioning. The customer never receives this data. In
-- particular, the owner password is kept only as an Argon2 hash.
CREATE TABLE IF NOT EXISTS vendor_business_provisioning (
  vendor_business_id uuid PRIMARY KEY
    REFERENCES vendor_businesses(id) ON DELETE CASCADE,
  setup jsonb NOT NULL,
  owner_password_hash text NOT NULL,
  plan_id uuid NOT NULL REFERENCES license_plans(id),
  license_expires_at timestamptz,
  offline_validity_days integer,
  notes text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code varchar(80),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_business_provisioning_plan_idx
  ON vendor_business_provisioning(plan_id);
