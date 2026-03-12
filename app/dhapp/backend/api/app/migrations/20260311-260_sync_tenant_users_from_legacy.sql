-- Sync legacy public.users into tenant schema users and keep a stable ID bridge.
-- This enables tenant-schema-based auth/RBAC while preserving legacy integer user IDs
-- still referenced by existing domain tables.

DO $$
DECLARE
  rec RECORD;
  v_schema TEXT;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE NOTICE 'Skipping tenant user sync: public.users not found.';
    RETURN;
  END IF;

  IF to_regclass('public.tenant_registry') IS NULL THEN
    RAISE NOTICE 'Skipping tenant user sync: public.tenant_registry not found.';
    RETURN;
  END IF;

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
    v_schema := rec.schema_name;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.schemata
      WHERE schema_name = v_schema
    ) THEN
      CONTINUE;
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
    USING rec.tenant_id;

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
    USING rec.tenant_id;
  END LOOP;
END
$$;
