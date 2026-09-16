-- Trusted public routing metadata. Operational menu/table data remains in the
-- tenant database; the control plane stores only an opaque token hash and the
-- tenant/table binding required to select that database.
CREATE TABLE IF NOT EXISTS public_table_links (
  token_hash varchar(64) PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES saas_tenants(id) ON DELETE CASCADE,
  table_id integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, table_id)
);

CREATE INDEX IF NOT EXISTS public_table_links_tenant_active_idx
  ON public_table_links(tenant_id, active);

