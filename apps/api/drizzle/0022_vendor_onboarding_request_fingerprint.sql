-- Bind every idempotency key to the exact commercial onboarding request.
-- Existing rows from the first additive idempotency migration remain readable;
-- they deliberately stay NULL and fail closed if replayed without a recorded
-- fingerprint.
ALTER TABLE vendor_business_onboarding_requests
  ADD COLUMN IF NOT EXISTS request_hash varchar(64);
