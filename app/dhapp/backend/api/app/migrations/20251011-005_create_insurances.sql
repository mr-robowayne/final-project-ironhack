-- Create insurances (Krankenkassen) table per tenant
CREATE TABLE IF NOT EXISTS insurances (
  id              SERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  short_name      TEXT,
  address         TEXT,
  zip             TEXT,
  city            TEXT,
  canton          TEXT,
  ean             TEXT,
  zsr_code        TEXT,
  bfs_code        TEXT,
  phone           TEXT,
  email           TEXT,
  billing_contact TEXT,
  kvnr            TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_insurances_tenant_ean
  ON insurances (tenant_id, ean)
  WHERE ean IS NOT NULL AND ean <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_insurances_tenant_name
  ON insurances (tenant_id, lower(name));

CREATE TRIGGER trg_insurances_set_updated_at
  BEFORE UPDATE ON insurances
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

