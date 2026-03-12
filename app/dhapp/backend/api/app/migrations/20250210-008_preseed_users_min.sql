-- Pre-seed minimal users so that 20250211-001_create_tenant_settings.sql can UPDATE them
-- and no NOT NULL violations occur during legacy flows.

DO $$
DECLARE
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
  v_admin_username TEXT;
  v_doctor_username TEXT;
  v_admin_email TEXT;
  v_doctor_email TEXT;
  v_admin_hash TEXT := '$2b$12$kKs.B68m4feaz8D9DU7aJOEtA0E2sFXa.CTdPkMjWn6lTAbG7wQqe'; -- Test123! (demo)
  v_doctor_hash TEXT := '$2b$12$ReWav9sx0.Nx.MsCuJJnQ.KjCmc8T/2RFuCGYsoUAdQlEagW1GETi'; -- Test123! (demo)
BEGIN
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := 'test';
  END IF;

  v_admin_username := v_tenant_id || '.admin';
  v_doctor_username := v_tenant_id || '.arzt';
  v_admin_email := v_admin_username || '@example.local';
  v_doctor_email := v_doctor_username || '@example.local';

  -- Ensure columns exist (idempotent safety)
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS tenant_id TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS vorname TEXT,
    ADD COLUMN IF NOT EXISTS nachname TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS rolle TEXT,
    ADD COLUMN IF NOT EXISTS role TEXT;

  -- Insert minimal admin
  IF NOT EXISTS (SELECT 1 FROM users WHERE username = v_admin_username) THEN
    INSERT INTO users (tenant_id, username, vorname, nachname, name, email, password_hash, rolle, role)
    VALUES (v_tenant_id, v_admin_username, 'Admin', initcap(v_tenant_id), 'Admin ' || initcap(v_tenant_id), v_admin_email, v_admin_hash, 'admin', 'admin');
  END IF;

  -- Insert minimal doctor
  IF NOT EXISTS (SELECT 1 FROM users WHERE username = v_doctor_username) THEN
    INSERT INTO users (tenant_id, username, vorname, nachname, name, email, password_hash, rolle, role)
    VALUES (v_tenant_id, v_doctor_username, 'Dr. Clarissa', initcap(v_tenant_id), 'Dr. Clarissa ' || initcap(v_tenant_id), v_doctor_email, v_doctor_hash, 'arzt', 'doctor');
  END IF;
END;
$$ LANGUAGE plpgsql;

