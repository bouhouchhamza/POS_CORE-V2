CREATE TABLE license_customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,email text,phone text,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE license_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code varchar(60) NOT NULL UNIQUE,name text NOT NULL,features jsonb NOT NULL DEFAULT '[]',default_device_limit integer NOT NULL DEFAULT 1,offline_validity_days integer,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid REFERENCES license_customers(id),plan_id uuid REFERENCES license_plans(id),key_hash varchar(64) UNIQUE,status varchar(20) NOT NULL CHECK(status IN('active','suspended','expired','revoked')),business_type varchar(30),allowed_features jsonb NOT NULL DEFAULT '[]',max_devices integer NOT NULL DEFAULT 1,issued_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz,offline_validity_days integer,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE license_devices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),license_id uuid NOT NULL REFERENCES licenses(id),installation_id uuid NOT NULL,device_public_key text NOT NULL,device_fingerprint varchar(64) NOT NULL,device_name text,app_version text,status varchar(20) NOT NULL DEFAULT 'active',activated_at timestamptz NOT NULL DEFAULT now(),last_validated_at timestamptz,revoked_at timestamptz,UNIQUE(license_id,installation_id));
CREATE TABLE license_activations(id bigserial PRIMARY KEY,license_id uuid NOT NULL REFERENCES licenses(id),device_id uuid REFERENCES license_devices(id),certificate_id uuid,kind varchar(30) NOT NULL,status varchar(30) NOT NULL,request_nonce text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE license_audit_logs(id bigserial PRIMARY KEY,actor text NOT NULL,action varchar(80) NOT NULL,entity_type varchar(50) NOT NULL,entity_id text,description text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE business_licenses(business_id integer PRIMARY KEY REFERENCES businesses(id),license_id uuid REFERENCES licenses(id),certificate_json text,certificate_signature text,status varchar(20) NOT NULL DEFAULT 'activation_required',updated_at timestamptz NOT NULL DEFAULT now());

INSERT INTO license_plans(code,name,features,default_device_limit,offline_validity_days) VALUES
('legacy','Legacy','["pos","inventory","barcode","suppliers","purchases","customers","tables","qr_menu","kitchen","takeaway","delivery","reservations","product_variants","modifiers","weighted_products","expiry_tracking"]',999,NULL),
('essential','Essential','["pos","inventory","barcode","customers"]',1,30),
('business','Business','["pos","inventory","barcode","suppliers","purchases","customers","product_variants","weighted_products"]',2,30),
('restaurant','Restaurant','["pos","inventory","customers","tables","qr_menu","kitchen","takeaway","delivery","product_variants","modifiers"]',2,30)
ON CONFLICT(code) DO NOTHING;
WITH legacy_plan AS (
  SELECT id AS plan_id, features
  FROM license_plans
  WHERE code='legacy'
),
legacy_bindings AS MATERIALIZED (
  SELECT
    b.id AS business_id,
    gen_random_uuid() AS license_id,
    lp.plan_id,
    lp.features
  FROM businesses b
  CROSS JOIN legacy_plan lp
),
inserted AS (
  INSERT INTO licenses(
    id,
    plan_id,
    status,
    allowed_features,
    max_devices,
    notes
  )
  SELECT
    license_id,
    plan_id,
    'active',
    features,
    999,
    'Automatic non-destructive entitlement for pre-license business'
  FROM legacy_bindings
  RETURNING id
)
INSERT INTO business_licenses(
  business_id,
  license_id,
  status
)
SELECT
  lb.business_id,
  lb.license_id,
  'active'
FROM legacy_bindings lb
JOIN inserted i ON i.id=lb.license_id;
