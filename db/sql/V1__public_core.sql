CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Trigger function used by Flyway-provisioned tables
CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- public.plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  plan_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  max_users    INTEGER NOT NULL CHECK (max_users >= 0),
  max_patients INTEGER NOT NULL CHECK (max_patients >= 0),
  features     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON public.plans;
CREATE TRIGGER trg_plans_set_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

INSERT INTO public.plans (name, max_users, max_patients, features)
VALUES
  (
    'basic',
    10,
    5000,
    '{"modules":["patients","appointments","tasks","calendar"],"medidata":false}'::jsonb
  ),
  (
    'pro',
    50,
    25000,
    '{"modules":["patients","appointments","tasks","calendar","billing"],"medidata":true}'::jsonb
  ),
  (
    'enterprise',
    500,
    200000,
    '{"modules":["patients","appointments","tasks","calendar","billing","chat","inventory"],"medidata":true,"sso":true}'::jsonb
  )
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- public.tenant_registry
--
-- tenant_id TEXT PRIMARY KEY — aligned with app migration 240.
-- All columns from both Flyway and app-migration system are declared here
-- so that migration 240 (IF NOT EXISTS → no-op) and migration 250
-- (ADD COLUMN IF NOT EXISTS → no-ops) both pass without conflict.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_registry (
  tenant_id     TEXT PRIMARY KEY,
  tenant_key    TEXT,
  schema_name   TEXT,
  display_name  TEXT,
  name          TEXT,
  plan          TEXT NOT NULL DEFAULT 'basic' REFERENCES public.plans(name),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  country       TEXT NOT NULL DEFAULT 'CH' CHECK (country IN ('CH', 'DE', 'AT')),
  data_residency TEXT NOT NULL DEFAULT 'eu-central-2',
  storage_root  TEXT,
  tenant_uuid   UUID DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS trg_tenant_registry_set_updated_at ON public.tenant_registry;
CREATE TRIGGER trg_tenant_registry_set_updated_at
BEFORE UPDATE ON public.tenant_registry
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_registry_tenant_key_active
  ON public.tenant_registry (tenant_key)
  WHERE deleted_at IS NULL AND tenant_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_registry_schema_name_active
  ON public.tenant_registry (schema_name)
  WHERE deleted_at IS NULL AND schema_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_registry_tenant_uuid
  ON public.tenant_registry (tenant_uuid)
  WHERE tenant_uuid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- public.global_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.global_audit_log (
  audit_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT REFERENCES public.tenant_registry(tenant_id) ON DELETE SET NULL,
  user_id     UUID,
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id UUID,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_before JSONB,
  data_after  JSONB,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_global_audit_log_tenant_created_at
  ON public.global_audit_log (tenant_id, created_at DESC);
