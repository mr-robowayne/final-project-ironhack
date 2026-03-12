-- Compatibility migration: ensure users.tenant_id exists and is populated
-- Must run before 20250211-001_* migrations that insert/update users.

DO $$
DECLARE
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
BEGIN
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := 'test';
  END IF;

  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS tenant_id TEXT;

  UPDATE users
     SET tenant_id = COALESCE(tenant_id, v_tenant_id)
   WHERE tenant_id IS NULL;
END;
$$ LANGUAGE plpgsql;

