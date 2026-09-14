CREATE UNIQUE INDEX license_activations_license_nonce_unique
ON license_activations(license_id, request_nonce)
WHERE request_nonce IS NOT NULL;

CREATE UNIQUE INDEX business_licenses_license_unique
ON business_licenses(license_id)
WHERE license_id IS NOT NULL;
