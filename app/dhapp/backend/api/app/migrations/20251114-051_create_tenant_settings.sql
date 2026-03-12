-- 20251114-051_create_tenant_settings.sql
-- Simple per-tenant settings for automation/reminders

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id   TEXT PRIMARY KEY,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_updated ON tenant_settings (updated_at DESC);

