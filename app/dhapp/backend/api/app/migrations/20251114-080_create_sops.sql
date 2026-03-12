-- 20251114-080_create_sops.sql
-- SOPs / Qualitätsdokumente pro Tenant

CREATE TABLE IF NOT EXISTS sops (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  locked            BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sops_tenant ON sops (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sops_tenant_title ON sops (tenant_id, lower(title));

