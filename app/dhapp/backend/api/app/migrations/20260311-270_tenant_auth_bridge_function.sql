-- Stable bridge function for tenant-schema auth users.
-- Idempotent and safe to call during tenant bootstrap after tenant_registry write.

CREATE OR REPLACE FUNCTION public.sync_tenant_users_from_legacy(
  p_tenant_id TEXT,
  p_schema_name TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_schema TEXT;
  v_has_schema_name BOOLEAN := false;
  v_insert_count INTEGER := 0;
  v_update_count INTEGER := 0;
BEGIN
  IF COALESCE(trim(p_tenant_id), '') = '' THEN
    RETURN 0;
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RETURN 0;
  END IF;

  v_schema := NULLIF(trim(COALESCE(p_schema_name, '')), '');

  IF v_schema IS NULL AND to_regclass('public.tenant_registry') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tenant_registry'
         AND column_name = 'schema_name'
    )
      INTO v_has_schema_name;

    IF v_has_schema_name THEN
      EXECUTE $sql$
        SELECT COALESCE(
                 NULLIF(schema_name, ''),
                 'tenant_' || regexp_replace(lower(tenant_id), '[^a-z0-9]+', '_', 'g')
               )
          FROM public.tenant_registry
         WHERE tenant_id = $1
           AND COALESCE(status, 'active') = 'active'
         LIMIT 1
      $sql$
      INTO v_schema
      USING p_tenant_id;
    END IF;
  END IF;

  IF v_schema IS NULL THEN
    v_schema := 'tenant_' || regexp_replace(lower(p_tenant_id), '[^a-z0-9]+', '_', 'g');
  END IF;

  v_schema := lower(v_schema);

  IF v_schema !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid tenant schema name for %: %', p_tenant_id, v_schema;
  END IF;

  IF to_regnamespace(v_schema) IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = v_schema
       AND table_name = 'users'
  ) OR NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = v_schema
       AND table_name = 'roles'
  ) THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.users ADD COLUMN IF NOT EXISTS legacy_user_id INTEGER',
    v_schema
  );

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.users (legacy_user_id) WHERE legacy_user_id IS NOT NULL',
    'uq_' || v_schema || '_users_legacy_user_id',
    v_schema
  );

  EXECUTE format($sql$
    WITH src AS (
      SELECT
        u.id AS legacy_user_id,
        lower(trim(u.email)) AS email_lc,
        trim(u.email) AS email,
        u.password_hash,
        NULLIF(
          trim(
            COALESCE(
              NULLIF(u.name, ''),
              concat_ws(' ', NULLIF(u.vorname, ''), NULLIF(u.nachname, '')),
              NULLIF(u.username, ''),
              u.email
            )
          ),
          ''
        ) AS display_name,
        CASE lower(COALESCE(NULLIF(u.rolle, ''), NULLIF(u.role, ''), 'assistant'))
          WHEN 'admin' THEN 'admin'
          WHEN 'arzt' THEN 'arzt'
          WHEN 'doctor' THEN 'arzt'
          WHEN 'assistenz' THEN 'mpa'
          WHEN 'assistant' THEN 'mpa'
          WHEN 'mpa' THEN 'mpa'
          WHEN 'abrechnung' THEN 'billing'
          WHEN 'billing' THEN 'billing'
          ELSE 'mpa'
        END AS role_name
      FROM public.users u
      WHERE u.tenant_id = $1
        AND u.email IS NOT NULL
        AND trim(u.email) <> ''
    )
    INSERT INTO %1$I.users (
      email,
      password_hash,
      role_id,
      display_name,
      is_active,
      mfa_enabled,
      legacy_user_id
    )
    SELECT
      src.email,
      src.password_hash,
      r.role_id,
      src.display_name,
      true,
      false,
      src.legacy_user_id
    FROM src
    JOIN %1$I.roles r
      ON lower(r.name) = src.role_name
    WHERE NOT EXISTS (
      SELECT 1
      FROM %1$I.users tu
      WHERE lower(tu.email) = src.email_lc
        AND tu.deleted_at IS NULL
    )
  $sql$, v_schema)
  USING p_tenant_id;

  GET DIAGNOSTICS v_insert_count = ROW_COUNT;

  EXECUTE format($sql$
    WITH src AS (
      SELECT
        u.id AS legacy_user_id,
        lower(trim(u.email)) AS email_lc,
        u.password_hash,
        NULLIF(
          trim(
            COALESCE(
              NULLIF(u.name, ''),
              concat_ws(' ', NULLIF(u.vorname, ''), NULLIF(u.nachname, '')),
              NULLIF(u.username, ''),
              u.email
            )
          ),
          ''
        ) AS display_name,
        CASE lower(COALESCE(NULLIF(u.rolle, ''), NULLIF(u.role, ''), 'assistant'))
          WHEN 'admin' THEN 'admin'
          WHEN 'arzt' THEN 'arzt'
          WHEN 'doctor' THEN 'arzt'
          WHEN 'assistenz' THEN 'mpa'
          WHEN 'assistant' THEN 'mpa'
          WHEN 'mpa' THEN 'mpa'
          WHEN 'abrechnung' THEN 'billing'
          WHEN 'billing' THEN 'billing'
          ELSE 'mpa'
        END AS role_name
      FROM public.users u
      WHERE u.tenant_id = $1
        AND u.email IS NOT NULL
        AND trim(u.email) <> ''
    )
    UPDATE %1$I.users tu
    SET
      password_hash = src.password_hash,
      display_name = COALESCE(NULLIF(src.display_name, ''), tu.display_name),
      role_id = r.role_id,
      legacy_user_id = COALESCE(tu.legacy_user_id, src.legacy_user_id),
      is_active = true,
      updated_at = now()
    FROM src
    JOIN %1$I.roles r
      ON lower(r.name) = src.role_name
    WHERE lower(tu.email) = src.email_lc
      AND tu.deleted_at IS NULL
  $sql$, v_schema)
  USING p_tenant_id;

  GET DIAGNOSTICS v_update_count = ROW_COUNT;

  RETURN COALESCE(v_insert_count, 0) + COALESCE(v_update_count, 0);
END;
$$;

DO $$
DECLARE
  rec RECORD;
  v_has_schema_name BOOLEAN := false;
BEGIN
  IF to_regclass('public.tenant_registry') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tenant_registry'
       AND column_name = 'schema_name'
  )
    INTO v_has_schema_name;

  IF v_has_schema_name THEN
    FOR rec IN
      SELECT
        tenant_id,
        COALESCE(
          NULLIF(schema_name, ''),
          'tenant_' || regexp_replace(lower(tenant_id), '[^a-z0-9]+', '_', 'g')
        ) AS schema_name
      FROM public.tenant_registry
      WHERE COALESCE(status, 'active') = 'active'
    LOOP
      PERFORM public.sync_tenant_users_from_legacy(rec.tenant_id, rec.schema_name);
    END LOOP;
  ELSE
    FOR rec IN
      SELECT tenant_id
      FROM public.tenant_registry
      WHERE COALESCE(status, 'active') = 'active'
    LOOP
      PERFORM public.sync_tenant_users_from_legacy(rec.tenant_id, NULL);
    END LOOP;
  END IF;
END
$$;
