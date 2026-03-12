-- 20260311-250_multischema_rbac_foundation.sql
-- Foundation for schema-per-tenant architecture with global public metadata and RBAC.
-- Backward-compatible with existing tenant_id-based runtime.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- public.tenant_registry extensions (keep existing tenant_id TEXT PK)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.tenant_registry
  ADD COLUMN IF NOT EXISTS tenant_uuid UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS schema_name TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS data_residency TEXT NOT NULL DEFAULT 'eu-central-2',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE public.tenant_registry
   SET tenant_uuid = COALESCE(tenant_uuid, gen_random_uuid()),
       schema_name = COALESCE(
         NULLIF(schema_name, ''),
         'tenant_' || regexp_replace(lower(tenant_id), '[^a-z0-9]+', '_', 'g')
       ),
       plan = CASE WHEN plan IN ('basic','pro','enterprise') THEN plan ELSE 'basic' END,
       country = CASE WHEN country IN ('CH','DE','AT') THEN country ELSE 'CH' END,
       data_residency = COALESCE(NULLIF(data_residency, ''), 'eu-central-2');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'tenant_registry'
       AND constraint_name = 'chk_tenant_registry_plan'
  ) THEN
    ALTER TABLE public.tenant_registry
      ADD CONSTRAINT chk_tenant_registry_plan
      CHECK (plan IN ('basic','pro','enterprise'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND table_name = 'tenant_registry'
       AND constraint_name = 'chk_tenant_registry_country'
  ) THEN
    ALTER TABLE public.tenant_registry
      ADD CONSTRAINT chk_tenant_registry_country
      CHECK (country IN ('CH','DE','AT'));
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_registry_tenant_uuid
  ON public.tenant_registry (tenant_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_registry_schema_name_active
  ON public.tenant_registry (schema_name)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- public.plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  plan_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  max_users      INTEGER NOT NULL CHECK (max_users >= 0),
  max_patients   INTEGER NOT NULL CHECK (max_patients >= 0),
  features       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.plans (name, max_users, max_patients, features)
VALUES
  ('basic', 10, 5000, '{"modules":["patients","appointments","tasks"],"medidata":false}'::jsonb),
  ('pro', 50, 25000, '{"modules":["patients","appointments","tasks","billing"],"medidata":true}'::jsonb),
  ('enterprise', 500, 200000, '{"modules":["patients","appointments","tasks","billing","analytics"],"medidata":true,"sso":true}'::jsonb)
ON CONFLICT (name) DO NOTHING;

DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON public.plans;
CREATE TRIGGER trg_plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- ---------------------------------------------------------------------------
-- public.global_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.global_audit_log (
  audit_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT,
  user_id        UUID,
  action         TEXT NOT NULL,
  resource       TEXT,
  resource_id    TEXT,
  ip_address     INET,
  user_agent     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_audit_log_tenant_time
  ON public.global_audit_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tenant schema provisioner
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(
  p_tenant_id TEXT,
  p_schema_name TEXT,
  p_plan TEXT DEFAULT 'basic',
  p_country TEXT DEFAULT 'CH',
  p_data_residency TEXT DEFAULT 'eu-central-2'
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_schema TEXT;
  v_plan TEXT;
  v_country TEXT;
BEGIN
  IF COALESCE(trim(p_tenant_id), '') = '' THEN
    RAISE EXCEPTION 'p_tenant_id must not be empty';
  END IF;

  v_schema := lower(COALESCE(NULLIF(trim(p_schema_name), ''), 'tenant_' || regexp_replace(lower(p_tenant_id), '[^a-z0-9]+', '_', 'g')));
  IF v_schema !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', v_schema;
  END IF;

  v_plan := CASE WHEN p_plan IN ('basic','pro','enterprise') THEN p_plan ELSE 'basic' END;
  v_country := CASE WHEN p_country IN ('CH','DE','AT') THEN p_country ELSE 'CH' END;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema);

  -- RBAC core
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.roles (
      role_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name             TEXT NOT NULL UNIQUE,
      description      TEXT,
      is_system_role   BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.permissions (
      permission_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource         TEXT NOT NULL,
      action           TEXT NOT NULL,
      description      TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (resource, action)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.role_permissions (
      role_id          UUID NOT NULL REFERENCES %1$I.roles(role_id) ON DELETE CASCADE,
      permission_id    UUID NOT NULL REFERENCES %1$I.permissions(permission_id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    )
  $sql$, v_schema);

  -- Users / sessions
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.users (
      user_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email            TEXT NOT NULL,
      password_hash    TEXT NOT NULL,
      role_id          UUID REFERENCES %1$I.roles(role_id) ON DELETE SET NULL,
      display_name     TEXT,
      is_active        BOOLEAN NOT NULL DEFAULT true,
      mfa_enabled      BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.users (lower(email)) WHERE deleted_at IS NULL',
    'uq_' || v_schema || '_users_email_active', v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.user_sessions (
      session_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      ip_address       INET,
      user_agent       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at       TIMESTAMPTZ NOT NULL,
      revoked_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- Patients / consent
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patients (
      patient_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_ref     TEXT,
      first_name       TEXT,
      last_name        TEXT,
      birth_date       DATE,
      ahv_number       TEXT,
      email            TEXT,
      phone            TEXT,
      created_by       UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.patients (created_at DESC)',
    'idx_' || v_schema || '_patients_created', v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patient_consent (
      consent_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id       UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      type             TEXT NOT NULL CHECK (type IN ('behandlung','datenweitergabe','medidata')),
      granted_at       TIMESTAMPTZ NOT NULL,
      revoked_at       TIMESTAMPTZ,
      document_url     TEXT
    )
  $sql$, v_schema);

  -- Calendars
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.calendars (
      calendar_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id    UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      color            TEXT,
      is_shared        BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.calendar_members (
      calendar_id      UUID NOT NULL REFERENCES %1$I.calendars(calendar_id) ON DELETE CASCADE,
      user_id          UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      permission       TEXT NOT NULL CHECK (permission IN ('read','write')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (calendar_id, user_id)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.appointments (
      appointment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_id      UUID NOT NULL REFERENCES %1$I.calendars(calendar_id) ON DELETE CASCADE,
      patient_id       UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      created_by       UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      title            TEXT NOT NULL,
      start_at         TIMESTAMPTZ NOT NULL,
      end_at           TIMESTAMPTZ NOT NULL,
      room_id          UUID,
      status           TEXT NOT NULL CHECK (status IN ('scheduled','completed','cancelled')),
      medidata_ref     TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.appointments (start_at, end_at)',
    'idx_' || v_schema || '_appointments_window', v_schema);

  -- Tasks
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.tasks (
      task_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title            TEXT NOT NULL,
      description      TEXT,
      created_by       UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      assigned_to      UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      is_global        BOOLEAN NOT NULL DEFAULT false,
      priority         TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
      due_date         TIMESTAMPTZ,
      status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at       TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.task_comments (
      comment_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id          UUID NOT NULL REFERENCES %1$I.tasks(task_id) ON DELETE CASCADE,
      user_id          UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      content          TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.task_attachments (
      attachment_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id          UUID NOT NULL REFERENCES %1$I.tasks(task_id) ON DELETE CASCADE,
      s3_key           TEXT NOT NULL,
      filename         TEXT NOT NULL,
      uploaded_by      UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- Billing / Medidata
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.invoices (
      invoice_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id       UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      created_by       UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'CHF',
      status           TEXT NOT NULL CHECK (status IN ('draft','sent','paid','cancelled')),
      medidata_ref     TEXT,
      sent_at          TIMESTAMPTZ,
      paid_at          TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.medidata_sync_log (
      sync_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id       UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      action           TEXT NOT NULL CHECK (action IN ('push','pull')),
      endpoint         TEXT NOT NULL,
      status           TEXT NOT NULL CHECK (status IN ('success','error')),
      request_hash     TEXT,
      error_message    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- Tenant-local audit
  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.audit_log (
      audit_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      action           TEXT NOT NULL,
      resource         TEXT NOT NULL,
      resource_id      UUID,
      ip_address       INET,
      user_agent       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      data_before      JSONB,
      data_after       JSONB
    )
  $sql$, v_schema);

  -- Seed system roles
  EXECUTE format($sql$
    INSERT INTO %1$I.roles (name, description, is_system_role)
    VALUES
      ('admin', 'System administrator', true),
      ('arzt', 'Medical doctor', true),
      ('mpa', 'Medical practice assistant', true),
      ('billing', 'Billing specialist', true)
    ON CONFLICT (name) DO NOTHING
  $sql$, v_schema);

  -- Seed permissions matrix entries
  EXECUTE format($sql$
    INSERT INTO %1$I.permissions (resource, action, description)
    VALUES
      ('patients','read','Read patients'),
      ('patients','write','Create/update patients'),
      ('patients','delete','Delete patients'),
      ('patients','export','Export patient data'),
      ('appointments','read','Read appointments'),
      ('appointments','write','Create/update appointments'),
      ('invoices','read','Read invoices'),
      ('invoices','write','Create/update invoices'),
      ('billing','read','Read billing domain'),
      ('billing','write','Write billing domain'),
      ('medidata','send','Send data to Medidata'),
      ('tasks','read','Read tasks'),
      ('tasks','write','Create/update tasks'),
      ('users','manage','Manage users and roles'),
      ('audit','read','Read audit logs')
    ON CONFLICT (resource, action) DO NOTHING
  $sql$, v_schema);

  -- Seed role -> permission mapping from requested matrix
  EXECUTE format($sql$
    WITH matrix(role_name, resource, action) AS (
      VALUES
        ('admin','patients','read'),
        ('admin','patients','write'),
        ('admin','patients','delete'),
        ('admin','patients','export'),
        ('admin','appointments','read'),
        ('admin','appointments','write'),
        ('admin','invoices','read'),
        ('admin','invoices','write'),
        ('admin','billing','read'),
        ('admin','billing','write'),
        ('admin','medidata','send'),
        ('admin','tasks','read'),
        ('admin','tasks','write'),
        ('admin','users','manage'),
        ('admin','audit','read'),

        ('arzt','patients','read'),
        ('arzt','patients','write'),
        ('arzt','patients','export'),
        ('arzt','appointments','read'),
        ('arzt','appointments','write'),
        ('arzt','medidata','send'),
        ('arzt','tasks','read'),
        ('arzt','tasks','write'),

        ('mpa','patients','read'),
        ('mpa','patients','write'),
        ('mpa','appointments','read'),
        ('mpa','appointments','write'),
        ('mpa','tasks','read'),
        ('mpa','tasks','write'),

        ('billing','invoices','read'),
        ('billing','invoices','write'),
        ('billing','billing','read'),
        ('billing','billing','write'),
        ('billing','tasks','read')
    )
    INSERT INTO %1$I.role_permissions (role_id, permission_id)
    SELECT r.role_id, p.permission_id
      FROM matrix m
      JOIN %1$I.roles r ON r.name = m.role_name
      JOIN %1$I.permissions p ON p.resource = m.resource AND p.action = m.action
    ON CONFLICT DO NOTHING
  $sql$, v_schema);

  -- Keep global registry in sync
  INSERT INTO public.tenant_registry (
    tenant_id, display_name, status, schema_name, plan, country, data_residency, deleted_at
  ) VALUES (
    p_tenant_id, p_tenant_id, 'active', v_schema, v_plan, v_country, COALESCE(NULLIF(p_data_residency, ''), 'eu-central-2'), NULL
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET schema_name = EXCLUDED.schema_name,
        plan = EXCLUDED.plan,
        country = EXCLUDED.country,
        data_residency = EXCLUDED.data_residency,
        status = 'active',
        deleted_at = NULL,
        updated_at = now();
END;
$$;

-- Provision schemas for already-registered tenants.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT tenant_id, schema_name, plan, country, data_residency
      FROM public.tenant_registry
  LOOP
    PERFORM public.provision_tenant_schema(
      rec.tenant_id,
      COALESCE(NULLIF(rec.schema_name, ''), 'tenant_' || regexp_replace(lower(rec.tenant_id), '[^a-z0-9]+', '_', 'g')),
      rec.plan,
      rec.country,
      rec.data_residency
    );
  END LOOP;
END$$;
