-- Compatibility migration: set a per-database DEFAULT for users.tenant_id
-- so legacy inserts without tenant_id succeed before full alignment.

ALTER TABLE IF EXISTS users
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE IF EXISTS users
  ALTER COLUMN tenant_id SET DEFAULT regexp_replace(current_database(), '^(patienten_|db_)', '');

UPDATE users
   SET tenant_id = COALESCE(tenant_id, regexp_replace(current_database(), '^(patienten_|db_)', ''))
 WHERE tenant_id IS NULL;

