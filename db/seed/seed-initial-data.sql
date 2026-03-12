-- =============================================================
-- Seed: Initial tenant "dhpatientsync" + admin user
-- =============================================================
-- Idempotent: safe to run multiple times, will NOT overwrite
-- existing data.
--
-- Required psql variables (pass via -v on command line):
--   ADMIN_EMAIL        — admin user e-mail
--   ADMIN_FIRST_NAME   — admin first name
--   ADMIN_LAST_NAME    — admin last name
--   ADMIN_PASSWORD     — admin initial password (plain text, bcrypt-hashed in DB)
--
-- Example:
--   psql "postgresql://..." \
--     -v ADMIN_EMAIL='you@example.com' \
--     -v ADMIN_FIRST_NAME='Max' \
--     -v ADMIN_LAST_NAME='Mustermann' \
--     -v ADMIN_PASSWORD='changeme123' \
--     -f db/seed/seed-initial-data.sql
-- =============================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_tenant_id    UUID;
  v_schema       TEXT;
  v_role_id      UUID;
  v_user_id      UUID;

  -- Variables injected from psql -v flags
  v_admin_email    TEXT := :'ADMIN_EMAIL';
  v_admin_fname    TEXT := :'ADMIN_FIRST_NAME';
  v_admin_lname    TEXT := :'ADMIN_LAST_NAME';
  v_admin_password TEXT := :'ADMIN_PASSWORD';

  -- Fixed tenant configuration
  c_tenant_key     CONSTANT TEXT := 'dhpatientsync';
  c_tenant_name    CONSTANT TEXT := 'DH Patientsync';
  c_schema_name    CONSTANT TEXT := 'dhpatientsync';
  c_plan           CONSTANT TEXT := 'pro';
  c_country        CONSTANT TEXT := 'CH';
  c_data_residency CONSTANT TEXT := 'eu-central-2';
BEGIN

  -- ===========================================================
  -- PART 1: Create tenant dhpatientsync (idempotent)
  -- ===========================================================
  SELECT tenant_id, schema_name
    INTO v_tenant_id, v_schema
    FROM public.tenant_registry
   WHERE tenant_key = c_tenant_key
     AND deleted_at IS NULL;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '[SEED] Creating tenant "%" ...', c_tenant_key;

    v_tenant_id := public.create_tenant(
      c_tenant_key,
      c_tenant_name,
      c_plan,
      c_country,
      c_data_residency,
      c_schema_name   -- explicit schema name = "dhpatientsync"
    );

    SELECT schema_name
      INTO v_schema
      FROM public.tenant_registry
     WHERE tenant_id = v_tenant_id;

    RAISE NOTICE '[SEED] Tenant created: id=%, schema="%"', v_tenant_id, v_schema;
  ELSE
    -- Tenant exists — ensure schema is fully provisioned (idempotent)
    RAISE NOTICE '[SEED] Tenant "%" already exists (id=%, schema="%"). Ensuring schema is provisioned...', c_tenant_key, v_tenant_id, v_schema;
    PERFORM public.provision_tenant_schema(v_tenant_id, v_schema);
    RAISE NOTICE '[SEED] Schema provisioning confirmed.';
  END IF;

  -- ===========================================================
  -- PART 2: Create admin user (idempotent)
  -- ===========================================================

  -- Verify admin role exists in tenant schema
  EXECUTE format('SELECT role_id FROM %I.roles WHERE name = ''admin''', v_schema)
    INTO v_role_id;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '[SEED] Admin role not found in schema "%". Schema provisioning may have failed.', v_schema;
  END IF;

  -- Check if admin user already exists
  EXECUTE format(
    'SELECT user_id FROM %I.users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
    v_schema
  )
  INTO v_user_id
  USING v_admin_email;

  IF v_user_id IS NOT NULL THEN
    RAISE NOTICE '[SEED] Admin user "%" already exists (id=%). Skipping.', v_admin_email, v_user_id;
  ELSE
    -- Insert admin user with bcrypt-hashed password (pgcrypto gen_salt bf = bcrypt rounds 10)
    EXECUTE format($$
      INSERT INTO %I.users (
        email,
        password_hash,
        role_id,
        first_name,
        last_name,
        is_active
      )
      VALUES (
        $1,
        crypt($2, gen_salt('bf', 10)),
        $3,
        $4,
        $5,
        true
      )
      RETURNING user_id
    $$, v_schema)
    INTO v_user_id
    USING
      v_admin_email,
      v_admin_password,
      v_role_id,
      v_admin_fname,
      v_admin_lname;

    RAISE NOTICE '[SEED] Admin user "%" created in schema "%" (id=%)', v_admin_email, v_schema, v_user_id;
    RAISE NOTICE '[SEED] IMPORTANT: Change the admin password after first login!';
  END IF;

  RAISE NOTICE '[SEED] Seed completed successfully.';

END$$;
