-- 20251020-030_create_medications.sql
-- Create tenant-scoped medications table and updated_at trigger

-- Create or replace is idempotent and avoids nested DO $$ quoting issues
CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.medications (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  atc_code          TEXT,
  name              TEXT NOT NULL,
  manufacturer      TEXT,
  active_substances TEXT[],
  forms             TEXT[],
  indications       TEXT,
  contraindications TEXT,
  side_effects      TEXT,
  interactions      TEXT,
  warnings          TEXT,
  pregnancy         TEXT,
  allergens         TEXT,
  leaflet_ref       TEXT,
  approved_status   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Efficient filtering by tenant + name prefix/case-insensitive match
CREATE INDEX IF NOT EXISTS idx_medications_tenant_name
  ON public.medications USING btree (tenant_id, lower(name));

-- Helpful for ATC lookups
CREATE INDEX IF NOT EXISTS idx_medications_tenant_atc
  ON public.medications USING btree (tenant_id, lower(atc_code));

-- Array element search for substances/forms
CREATE INDEX IF NOT EXISTS idx_medications_active_substances
  ON public.medications USING GIN (active_substances);

CREATE INDEX IF NOT EXISTS idx_medications_forms
  ON public.medications USING GIN (forms);

DROP TRIGGER IF EXISTS trg_medications_set_updated_at ON public.medications;
CREATE TRIGGER trg_medications_set_updated_at
  BEFORE UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();
