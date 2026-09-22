-- Durable idempotency boundary for the Vendor's commercial business workflow.
-- It is intentionally separate from runtime/tenant data so retrying a timed
-- out request cannot create a second customer, business, licence, or tenant.
CREATE TABLE IF NOT EXISTS vendor_business_onboarding_requests (
  idempotency_key uuid PRIMARY KEY,
  vendor_business_id uuid REFERENCES vendor_businesses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_business_onboarding_requests_business_idx
  ON vendor_business_onboarding_requests(vendor_business_id);
