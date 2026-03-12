-- Shim migration to skip legacy 20250211-001_create_tenant_settings.sql safely
-- 1) Ensure schema_migrations exists and mark 20250211-001 as applied
-- 2) Create tenant_settings table if missing (minimal compatible schema)

DO $$
BEGIN
  -- Ensure migration tracker exists
  EXECUTE 'CREATE TABLE IF NOT EXISTS schema_migrations (
             id TEXT PRIMARY KEY,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )';

  -- Mark the legacy migration as applied to avoid executing its fragile seed logic
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE id = '20250211-001_create_tenant_settings.sql'
  ) THEN
    INSERT INTO schema_migrations (id) VALUES ('20250211-001_create_tenant_settings.sql');
  END IF;

  -- Provide tenant_settings table if missing
  EXECUTE 'CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id TEXT PRIMARY KEY,
    iban TEXT,
    creditor_name TEXT,
    creditor_additional TEXT,
    address_lines TEXT[] DEFAULT ''{}''::TEXT[],
    zip TEXT,
    city TEXT,
    country CHAR(2) DEFAULT ''CH'',
    logo_path TEXT,
    bank_name TEXT,
    bank_address TEXT,
    payment_reference_type TEXT DEFAULT ''NON'',
    payment_reference TEXT,
    additional_text TEXT,
    metadata JSONB DEFAULT ''{}''::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )';
END;
$$ LANGUAGE plpgsql;

