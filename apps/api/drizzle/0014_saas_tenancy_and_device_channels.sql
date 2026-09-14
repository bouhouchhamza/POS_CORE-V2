-- SaaS tenancy + unified device accounting.
--
-- Control plane remains in this database. Operational POS data can be moved
-- to one PostgreSQL database per Vendor Business when SAAS_TENANCY_MODE is
-- set to database_per_tenant.

ALTER TABLE license_plans
  ADD COLUMN IF NOT EXISTS default_desktop_device_limit integer,
  ADD COLUMN IF NOT EXISTS default_web_device_limit integer,
  ADD COLUMN IF NOT EXISTS default_mobile_device_limit integer;

ALTER TABLE license_plans
  DROP CONSTRAINT IF EXISTS license_plans_default_desktop_device_limit_check,
  DROP CONSTRAINT IF EXISTS license_plans_default_web_device_limit_check,
  DROP CONSTRAINT IF EXISTS license_plans_default_mobile_device_limit_check;

ALTER TABLE license_plans
  ADD CONSTRAINT license_plans_default_desktop_device_limit_check
    CHECK (default_desktop_device_limit IS NULL OR default_desktop_device_limit >= 0),
  ADD CONSTRAINT license_plans_default_web_device_limit_check
    CHECK (default_web_device_limit IS NULL OR default_web_device_limit >= 0),
  ADD CONSTRAINT license_plans_default_mobile_device_limit_check
    CHECK (default_mobile_device_limit IS NULL OR default_mobile_device_limit >= 0);

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS max_desktop_devices integer,
  ADD COLUMN IF NOT EXISTS max_web_devices integer,
  ADD COLUMN IF NOT EXISTS max_mobile_devices integer;

ALTER TABLE licenses
  DROP CONSTRAINT IF EXISTS licenses_max_desktop_devices_check,
  DROP CONSTRAINT IF EXISTS licenses_max_web_devices_check,
  DROP CONSTRAINT IF EXISTS licenses_max_mobile_devices_check;

ALTER TABLE licenses
  ADD CONSTRAINT licenses_max_desktop_devices_check
    CHECK (max_desktop_devices IS NULL OR max_desktop_devices >= 0),
  ADD CONSTRAINT licenses_max_web_devices_check
    CHECK (max_web_devices IS NULL OR max_web_devices >= 0),
  ADD CONSTRAINT licenses_max_mobile_devices_check
    CHECK (max_mobile_devices IS NULL OR max_mobile_devices >= 0);

ALTER TABLE license_devices
  ADD COLUMN IF NOT EXISTS channel varchar(20) NOT NULL DEFAULT 'desktop',
  ADD COLUMN IF NOT EXISTS platform varchar(80),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE license_devices
SET last_seen_at = COALESCE(last_validated_at, activated_at)
WHERE last_seen_at IS NULL;

ALTER TABLE license_devices
  DROP CONSTRAINT IF EXISTS license_devices_channel_check;

ALTER TABLE license_devices
  ADD CONSTRAINT license_devices_channel_check
    CHECK (channel IN ('desktop','web','mobile'));

CREATE INDEX IF NOT EXISTS license_devices_license_channel_status_idx
  ON license_devices(license_id, channel, status);

CREATE INDEX IF NOT EXISTS license_devices_last_seen_idx
  ON license_devices(last_seen_at DESC);

-- `businesses` can remain as a tiny control-plane shadow record for backwards
-- compatibility. All transactional POS records live in the tenant database.
CREATE TABLE IF NOT EXISTS saas_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_business_id uuid NOT NULL UNIQUE REFERENCES vendor_businesses(id),
  control_business_id integer UNIQUE REFERENCES businesses(id),
  slug varchar(80) NOT NULL UNIQUE,
  database_name varchar(63) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','active','suspended','error','closed')),
  schema_version varchar(40),
  provisioned_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saas_tenants_status_idx
  ON saas_tenants(status);

-- Keep PostgreSQL role validation aligned with the application/local SQLite.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(
  role IN ('patron','worker','owner','admin','manager','cashier','seller','waiter','kitchen','stock_manager')
);
