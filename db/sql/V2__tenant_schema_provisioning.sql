CREATE OR REPLACE FUNCTION public.seed_tenant_rbac(p_schema_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_schema TEXT := lower(trim(COALESCE(p_schema_name, '')));
BEGIN
  IF v_schema = '' OR v_schema !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', p_schema_name;
  END IF;

  IF to_regnamespace(v_schema) IS NULL THEN
    RAISE EXCEPTION 'Schema % does not exist', v_schema;
  END IF;

  EXECUTE format($sql$
    INSERT INTO %1$I.roles (name, description, is_system_role)
    VALUES
      ('admin', 'Tenant administrator', true),
      ('arzt', 'Arzt', true),
      ('mpa', 'Medizinische Praxisassistenz', true),
      ('billing', 'Billing user', true)
    ON CONFLICT (name) DO UPDATE
      SET description = EXCLUDED.description,
          is_system_role = true
  $sql$, v_schema);

  EXECUTE format($sql$
    INSERT INTO %1$I.permissions (resource, action, description)
    VALUES
      ('patients', 'read', 'Patienten lesen'),
      ('patients', 'write', 'Patienten schreiben'),
      ('patients', 'delete', 'Patienten loeschen'),
      ('patients', 'export', 'Patienten exportieren'),
      ('appointments', 'read', 'Termine lesen'),
      ('appointments', 'write', 'Termine schreiben'),
      ('invoices', 'read', 'Rechnungen lesen'),
      ('invoices', 'write', 'Rechnungen schreiben'),
      ('billing', 'read', 'Abrechnung lesen'),
      ('billing', 'write', 'Abrechnung schreiben'),
      ('medidata', 'send', 'Medidata senden'),
      ('tasks', 'read', 'Aufgaben lesen'),
      ('tasks', 'write', 'Aufgaben schreiben'),
      ('users', 'manage', 'Benutzer verwalten'),
      ('audit', 'read', 'Audit lesen')
    ON CONFLICT (resource, action) DO NOTHING
  $sql$, v_schema);

  EXECUTE format($sql$
    WITH matrix(role_name, resource, action) AS (
      VALUES
        ('admin', 'patients', 'read'),
        ('admin', 'patients', 'write'),
        ('admin', 'patients', 'delete'),
        ('admin', 'patients', 'export'),
        ('admin', 'appointments', 'read'),
        ('admin', 'appointments', 'write'),
        ('admin', 'invoices', 'read'),
        ('admin', 'invoices', 'write'),
        ('admin', 'billing', 'read'),
        ('admin', 'billing', 'write'),
        ('admin', 'medidata', 'send'),
        ('admin', 'tasks', 'read'),
        ('admin', 'tasks', 'write'),
        ('admin', 'users', 'manage'),
        ('admin', 'audit', 'read'),

        ('arzt', 'patients', 'read'),
        ('arzt', 'patients', 'write'),
        ('arzt', 'patients', 'export'),
        ('arzt', 'appointments', 'read'),
        ('arzt', 'appointments', 'write'),
        ('arzt', 'medidata', 'send'),
        ('arzt', 'tasks', 'read'),
        ('arzt', 'tasks', 'write'),

        ('mpa', 'patients', 'read'),
        ('mpa', 'patients', 'write'),
        ('mpa', 'appointments', 'read'),
        ('mpa', 'appointments', 'write'),
        ('mpa', 'tasks', 'read'),
        ('mpa', 'tasks', 'write'),

        ('billing', 'invoices', 'read'),
        ('billing', 'invoices', 'write'),
        ('billing', 'billing', 'read'),
        ('billing', 'billing', 'write'),
        ('billing', 'tasks', 'read')
    )
    INSERT INTO %1$I.role_permissions (role_id, permission_id)
    SELECT r.role_id, p.permission_id
    FROM matrix m
    JOIN %1$I.roles r
      ON r.name = m.role_name
    JOIN %1$I.permissions p
      ON p.resource = m.resource
     AND p.action = m.action
    ON CONFLICT DO NOTHING
  $sql$, v_schema);
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_tenant_schema(
  p_tenant_id TEXT,
  p_schema_name TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_schema TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id must not be null';
  END IF;

  v_schema := NULLIF(trim(COALESCE(p_schema_name, '')), '');

  IF v_schema IS NULL THEN
    SELECT tr.schema_name
      INTO v_schema
      FROM public.tenant_registry tr
     WHERE tr.tenant_id = p_tenant_id
       AND tr.deleted_at IS NULL
     LIMIT 1;
  END IF;

  IF v_schema IS NULL THEN
    v_schema := 'tenant_' || regexp_replace(lower(p_tenant_id), '[^a-z0-9]+', '_', 'g');
  END IF;

  v_schema := lower(v_schema);

  IF v_schema !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', v_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.roles (
      role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_system_role BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.permissions (
      permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (resource, action)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.role_permissions (
      role_id UUID NOT NULL REFERENCES %1$I.roles(role_id) ON DELETE CASCADE,
      permission_id UUID NOT NULL REFERENCES %1$I.permissions(permission_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.users (
      user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_id UUID REFERENCES %1$I.roles(role_id) ON DELETE SET NULL,
      first_name TEXT,
      last_name TEXT,
      display_name TEXT,
      initials TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      mfa_enabled BOOLEAN NOT NULL DEFAULT false,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.users (lower(email)) WHERE deleted_at IS NULL',
    'uq_' || v_schema || '_users_email_active',
    v_schema
  );

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.user_sessions (
      session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      ip_address INET,
      user_agent TEXT,
      invalidated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.user_sessions (expires_at)',
    'idx_' || v_schema || '_user_sessions_expires_at',
    v_schema
  );

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patients (
      patient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_ref TEXT,
      first_name TEXT,
      last_name TEXT,
      birth_date DATE,
      ahv_number TEXT,
      email TEXT,
      phone TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      document_prefix TEXT
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.patients (created_at DESC)',
    'idx_' || v_schema || '_patients_created_at',
    v_schema
  );

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patient_consent (
      consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('behandlung', 'datenweitergabe', 'medidata')),
      granted_at TIMESTAMPTZ NOT NULL,
      consent_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      revoked_at TIMESTAMPTZ,
      revoked_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      document_url TEXT
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.rooms (
      room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.calendars (
      calendar_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      is_shared BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.calendar_members (
      calendar_id UUID NOT NULL REFERENCES %1$I.calendars(calendar_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (calendar_id, user_id)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.appointments (
      appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_id UUID NOT NULL REFERENCES %1$I.calendars(calendar_id) ON DELETE CASCADE,
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      room_id UUID REFERENCES %1$I.rooms(room_id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
      medidata_ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.appointments (start_at, end_at)',
    'idx_' || v_schema || '_appointments_window',
    v_schema
  );

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.tasks (
      task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      assigned_to UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      is_global BOOLEAN NOT NULL DEFAULT false,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      due_date TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.task_comments (
      comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES %1$I.tasks(task_id) ON DELETE CASCADE,
      user_id UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.task_attachments (
      attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES %1$I.tasks(task_id) ON DELETE CASCADE,
      s3_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      uploaded_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.invoices (
      invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'CHF',
      status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
      medidata_ref TEXT,
      sent_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.medidata_sync_log (
      sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('push', 'pull')),
      endpoint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      request_hash TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.inventory_items (
      item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      category TEXT,
      min_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
      current_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
      unit TEXT,
      last_updated_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.inventory_transactions (
      transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id UUID NOT NULL REFERENCES %1$I.inventory_items(item_id) ON DELETE CASCADE,
      change_amount NUMERIC(12, 2) NOT NULL,
      reason TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.chat_channels (
      channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('global', 'direct', 'group')),
      name TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.chat_channel_members (
      channel_id UUID NOT NULL REFERENCES %1$I.chat_channels(channel_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, user_id)
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.chat_messages (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id UUID NOT NULL REFERENCES %1$I.chat_channels(channel_id) ON DELETE CASCADE,
      user_id UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.audit_log (
      audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      resource_id UUID,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      data_before JSONB,
      data_after JSONB,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  $sql$, v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_roles_set_updated_at ON %I.roles', v_schema);
  EXECUTE format('CREATE TRIGGER trg_roles_set_updated_at BEFORE UPDATE ON %I.roles FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_users_set_updated_at ON %I.users', v_schema);
  EXECUTE format('CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON %I.users FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_patients_set_updated_at ON %I.patients', v_schema);
  EXECUTE format('CREATE TRIGGER trg_patients_set_updated_at BEFORE UPDATE ON %I.patients FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_rooms_set_updated_at ON %I.rooms', v_schema);
  EXECUTE format('CREATE TRIGGER trg_rooms_set_updated_at BEFORE UPDATE ON %I.rooms FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_appointments_set_updated_at ON %I.appointments', v_schema);
  EXECUTE format('CREATE TRIGGER trg_appointments_set_updated_at BEFORE UPDATE ON %I.appointments FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON %I.tasks', v_schema);
  EXECUTE format('CREATE TRIGGER trg_tasks_set_updated_at BEFORE UPDATE ON %I.tasks FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_invoices_set_updated_at ON %I.invoices', v_schema);
  EXECUTE format('CREATE TRIGGER trg_invoices_set_updated_at BEFORE UPDATE ON %I.invoices FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_inventory_items_set_updated_at ON %I.inventory_items', v_schema);
  EXECUTE format('CREATE TRIGGER trg_inventory_items_set_updated_at BEFORE UPDATE ON %I.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_chat_channels_set_updated_at ON %I.chat_channels', v_schema);
  EXECUTE format('CREATE TRIGGER trg_chat_channels_set_updated_at BEFORE UPDATE ON %I.chat_channels FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  PERFORM public.seed_tenant_rbac(v_schema);

  UPDATE public.tenant_registry
     SET schema_name = v_schema,
         updated_at = now()
   WHERE tenant_id = p_tenant_id;

  RETURN v_schema;
END;
$$;
