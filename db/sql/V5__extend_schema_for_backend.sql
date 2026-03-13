-- V5__extend_schema_for_backend.sql
-- Extends tenant schema with all tables/columns from legacy backend migrations.
-- Follows Flyway convention: UUID PKs, English names, timestamptz, soft deletes.
--
-- This migration replaces the provision_tenant_schema() function to include
-- every table the backend application requires, then re-provisions all tenants.
-- info
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

  -- =========================================================================
  -- RBAC
  -- =========================================================================

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

  -- =========================================================================
  -- USERS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.users (
      user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      legacy_user_id INTEGER,
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

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.users (legacy_user_id) WHERE legacy_user_id IS NOT NULL',
    'uq_' || v_schema || '_users_legacy_user_id',
    v_schema
  );

  -- =========================================================================
  -- USER SESSIONS
  -- =========================================================================

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

  -- =========================================================================
  -- INSURANCES
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.insurances (
      insurance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      short_name TEXT,
      address TEXT,
      postal_code TEXT,
      city TEXT,
      canton TEXT,
      ean TEXT,
      zsr_code TEXT,
      bfs_code TEXT,
      phone TEXT,
      email TEXT,
      billing_contact TEXT,
      kvnr TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.insurances (lower(name)) WHERE deleted_at IS NULL',
    'uq_' || v_schema || '_insurances_name',
    v_schema
  );

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.insurances (ean) WHERE ean IS NOT NULL AND deleted_at IS NULL',
    'uq_' || v_schema || '_insurances_ean',
    v_schema
  );

  -- =========================================================================
  -- PATIENTS (extended with all backend columns)
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patients (
      patient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      external_ref TEXT,
      first_name TEXT,
      last_name TEXT,
      birth_date DATE,
      sex TEXT,
      treated_sex TEXT,
      ahv_number TEXT,
      email TEXT,
      phone TEXT,
      street TEXT,
      house_number TEXT,
      postal_code TEXT,
      city TEXT,
      allergies TEXT,
      vaccination_status TEXT,
      medical_history TEXT,
      medication_plan TEXT,
      insurance_number TEXT,
      insurance_id UUID REFERENCES %1$I.insurances(insurance_id) ON DELETE SET NULL,
      notes TEXT,
      document_prefix TEXT,
      guardian_first_name TEXT,
      guardian_last_name TEXT,
      guardian_relationship TEXT,
      guardian_phone TEXT,
      guardian_email TEXT,
      guardian_same_address BOOLEAN NOT NULL DEFAULT false,
      guardian_street TEXT,
      guardian_house_number TEXT,
      guardian_postal_code TEXT,
      guardian_city TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.patients (created_at DESC)',
    'idx_' || v_schema || '_patients_created_at',
    v_schema
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.patients (last_name, first_name)',
    'idx_' || v_schema || '_patients_name',
    v_schema
  );

  -- =========================================================================
  -- PATIENT CONSENT
  -- =========================================================================

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

  -- =========================================================================
  -- ROOMS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.rooms (
      room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      type TEXT CHECK (type IN ('BEHANDLUNG','OP','LABOR','SONSTIGES','AUFWACHRAUM','SPRECHZIMMER','LAGER','WARTEZIMMER','BUERO')),
      floor TEXT,
      building TEXT,
      width INTEGER,
      height INTEGER,
      color TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- RESOURCES (medical equipment etc.)
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.resources (
      resource_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('GERAET','SONSTIGES')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- ROOM LAYOUT OBJECTS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.room_layout_objects (
      layout_object_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES %1$I.rooms(room_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('BED','OP_TABLE','MONITOR','MACHINE','CABINET','CHAIR','DESK','WALL','OTHER')),
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 1,
      height INTEGER NOT NULL DEFAULT 1,
      rotation INTEGER NOT NULL DEFAULT 0,
      z_index INTEGER,
      properties JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- ROOM BOOKINGS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.room_bookings (
      booking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID NOT NULL REFERENCES %1$I.rooms(room_id) ON DELETE CASCADE,
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      appointment_id UUID,
      doctor_id UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      procedure_type TEXT,
      status TEXT NOT NULL DEFAULT 'GEPLANT' CHECK (status IN ('GEPLANT','LAUFEND','ABGESCHLOSSEN','ABGESAGT')),
      color TEXT,
      note TEXT,
      staff_ids UUID[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- CALENDARS
  -- =========================================================================

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

  -- =========================================================================
  -- APPOINTMENTS
  -- =========================================================================

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

  -- =========================================================================
  -- APPOINTMENT REMINDERS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.appointment_reminders (
      reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id UUID NOT NULL REFERENCES %1$I.appointments(appointment_id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (channel IN ('INTERNAL','EMAIL','SMS')),
      due_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.appointment_reminders (appointment_id, channel, due_at)',
    'uq_' || v_schema || '_appt_reminder',
    v_schema
  );

  -- =========================================================================
  -- TASKS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.tasks (
      task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      assigned_to UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      related_appointment_id UUID REFERENCES %1$I.appointments(appointment_id) ON DELETE SET NULL,
      sop_id UUID,
      is_global BOOLEAN NOT NULL DEFAULT false,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      type TEXT,
      tags TEXT[],
      due_date TIMESTAMPTZ,
      read_at_assignee TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'archived')),
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

  -- =========================================================================
  -- INVOICES
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.invoices (
      invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'CHF',
      status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
      medidata_ref TEXT,
      due_date DATE,
      sent_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- MEDIDATA SYNC LOG
  -- =========================================================================

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

  -- =========================================================================
  -- MEDICATIONS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.medications (
      medication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      atc_code TEXT,
      name TEXT NOT NULL,
      manufacturer TEXT,
      active_substances TEXT[],
      forms TEXT[],
      indications TEXT,
      contraindications TEXT,
      side_effects TEXT,
      interactions TEXT,
      warnings TEXT,
      pregnancy TEXT,
      allergens TEXT,
      leaflet_ref TEXT,
      approved_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.medications (lower(name))',
    'idx_' || v_schema || '_medications_name',
    v_schema
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.medications (lower(atc_code))',
    'idx_' || v_schema || '_medications_atc',
    v_schema
  );

  -- =========================================================================
  -- PRESCRIPTIONS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.prescriptions (
      prescription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      medication_id UUID REFERENCES %1$I.medications(medication_id) ON DELETE SET NULL,
      prescribed_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      dosage TEXT,
      frequency TEXT,
      start_date DATE,
      end_date DATE,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- LETTERS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.letters (
      letter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
      content JSONB DEFAULT '{}'::jsonb,
      pdf_path TEXT,
      document_path TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- SICK NOTES
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.sick_notes (
      sick_note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE,
      open_end BOOLEAN NOT NULL DEFAULT false,
      degree_percent INTEGER NOT NULL DEFAULT 100 CHECK (degree_percent >= 0 AND degree_percent <= 100),
      diagnosis_short TEXT,
      remark TEXT,
      receiver_type TEXT NOT NULL DEFAULT 'PATIENT' CHECK (receiver_type IN ('ARBEITGEBER','VERSICHERUNG','PATIENT','SONSTIGER')),
      receiver_name TEXT,
      receiver_address TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
      pdf_path TEXT,
      document_path TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- NOTES
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.notes (
      note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      visibility_type TEXT NOT NULL CHECK (visibility_type IN ('PERSONAL','PRACTICE','PATIENT')),
      title TEXT,
      content TEXT,
      tags TEXT[],
      color TEXT,
      pinned BOOLEAN NOT NULL DEFAULT false,
      locked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.note_attachments (
      attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id UUID NOT NULL REFERENCES %1$I.notes(note_id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      uploaded_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- PATIENT JOURNEY
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patient_journey (
      journey_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('NEW','ABKLAERUNG','OP_GEPLANT','OP_ERFOLGT','NACHKONTROLLE','ABGESCHLOSSEN')),
      updated_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.patient_journey (patient_id)',
    'uq_' || v_schema || '_patient_journey_patient',
    v_schema
  );

  -- =========================================================================
  -- WAITING ROOM STATUS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.waiting_room_status (
      waiting_room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('ANGEMELDET','WARTEZIMMER','IN_BEHANDLUNG','FERTIG')),
      last_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_change_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.waiting_room_status (patient_id)',
    'uq_' || v_schema || '_waiting_room_patient',
    v_schema
  );

  -- =========================================================================
  -- PATIENT COMMUNICATION LOG
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patient_communication_log (
      log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('PHONE','EMAIL','SMS','LETTER','IN_PERSON')),
      direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
      summary TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- PATIENT MEDIA
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.patient_media (
      media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'OTHER' CHECK (type IN ('IMAGE','VIDEO','OTHER')),
      description TEXT,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- DOCUMENTS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.documents (
      document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id UUID NOT NULL REFERENCES %1$I.patients(patient_id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      uploaded_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      size_bytes BIGINT,
      hash TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- INVENTORY
  -- =========================================================================

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

  -- =========================================================================
  -- SOPS (Standard Operating Procedures)
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.sops (
      sop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      content TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      locked BOOLEAN NOT NULL DEFAULT false,
      created_by UUID REFERENCES %1$I.users(user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  -- =========================================================================
  -- CHAT
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.chat_channels (
      channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('global', 'direct', 'group', 'patient', 'task', 'dm')),
      name TEXT,
      related_patient_id UUID REFERENCES %1$I.patients(patient_id) ON DELETE SET NULL,
      related_task_id UUID REFERENCES %1$I.tasks(task_id) ON DELETE SET NULL,
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
    CREATE TABLE IF NOT EXISTS %1$I.chat_message_reads (
      message_id UUID NOT NULL REFERENCES %1$I.chat_messages(message_id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ,
      PRIMARY KEY (message_id, user_id)
    )
  $sql$, v_schema);

  -- =========================================================================
  -- WORKFLOW DEFINITIONS & RUNS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.workflow_definitions (
      workflow_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('NEW_PATIENT','NEW_LAB_RESULT','DISCHARGE','MANUAL')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      definition_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  $sql$, v_schema);

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.workflow_runs (
      workflow_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_definition_id UUID NOT NULL REFERENCES %1$I.workflow_definitions(workflow_definition_id) ON DELETE CASCADE,
      trigger_context JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- FAVORITES
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.favorites (
      favorite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('PATIENT','NOTE','TASK','SOP','VIEW')),
      target_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- USER DASHBOARD CONFIG
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.user_dashboard_config (
      user_id UUID NOT NULL REFERENCES %1$I.users(user_id) ON DELETE CASCADE,
      widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id)
    )
  $sql$, v_schema);

  -- =========================================================================
  -- TENANT SETTINGS
  -- =========================================================================

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS %1$I.tenant_settings (
      settings_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  $sql$, v_schema);

  -- =========================================================================
  -- AUDIT LOG (tenant-local)
  -- =========================================================================

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

  -- =========================================================================
  -- UPDATED_AT TRIGGERS
  -- =========================================================================

  EXECUTE format('DROP TRIGGER IF EXISTS trg_roles_set_updated_at ON %I.roles', v_schema);
  EXECUTE format('CREATE TRIGGER trg_roles_set_updated_at BEFORE UPDATE ON %I.roles FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_users_set_updated_at ON %I.users', v_schema);
  EXECUTE format('CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON %I.users FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_patients_set_updated_at ON %I.patients', v_schema);
  EXECUTE format('CREATE TRIGGER trg_patients_set_updated_at BEFORE UPDATE ON %I.patients FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_rooms_set_updated_at ON %I.rooms', v_schema);
  EXECUTE format('CREATE TRIGGER trg_rooms_set_updated_at BEFORE UPDATE ON %I.rooms FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_room_layout_objects_set_updated_at ON %I.room_layout_objects', v_schema);
  EXECUTE format('CREATE TRIGGER trg_room_layout_objects_set_updated_at BEFORE UPDATE ON %I.room_layout_objects FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_room_bookings_set_updated_at ON %I.room_bookings', v_schema);
  EXECUTE format('CREATE TRIGGER trg_room_bookings_set_updated_at BEFORE UPDATE ON %I.room_bookings FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_resources_set_updated_at ON %I.resources', v_schema);
  EXECUTE format('CREATE TRIGGER trg_resources_set_updated_at BEFORE UPDATE ON %I.resources FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_appointments_set_updated_at ON %I.appointments', v_schema);
  EXECUTE format('CREATE TRIGGER trg_appointments_set_updated_at BEFORE UPDATE ON %I.appointments FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_appointment_reminders_set_updated_at ON %I.appointment_reminders', v_schema);
  EXECUTE format('CREATE TRIGGER trg_appointment_reminders_set_updated_at BEFORE UPDATE ON %I.appointment_reminders FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON %I.tasks', v_schema);
  EXECUTE format('CREATE TRIGGER trg_tasks_set_updated_at BEFORE UPDATE ON %I.tasks FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_invoices_set_updated_at ON %I.invoices', v_schema);
  EXECUTE format('CREATE TRIGGER trg_invoices_set_updated_at BEFORE UPDATE ON %I.invoices FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_medications_set_updated_at ON %I.medications', v_schema);
  EXECUTE format('CREATE TRIGGER trg_medications_set_updated_at BEFORE UPDATE ON %I.medications FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_prescriptions_set_updated_at ON %I.prescriptions', v_schema);
  EXECUTE format('CREATE TRIGGER trg_prescriptions_set_updated_at BEFORE UPDATE ON %I.prescriptions FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_letters_set_updated_at ON %I.letters', v_schema);
  EXECUTE format('CREATE TRIGGER trg_letters_set_updated_at BEFORE UPDATE ON %I.letters FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_sick_notes_set_updated_at ON %I.sick_notes', v_schema);
  EXECUTE format('CREATE TRIGGER trg_sick_notes_set_updated_at BEFORE UPDATE ON %I.sick_notes FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_notes_set_updated_at ON %I.notes', v_schema);
  EXECUTE format('CREATE TRIGGER trg_notes_set_updated_at BEFORE UPDATE ON %I.notes FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_patient_journey_set_updated_at ON %I.patient_journey', v_schema);
  EXECUTE format('CREATE TRIGGER trg_patient_journey_set_updated_at BEFORE UPDATE ON %I.patient_journey FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_inventory_items_set_updated_at ON %I.inventory_items', v_schema);
  EXECUTE format('CREATE TRIGGER trg_inventory_items_set_updated_at BEFORE UPDATE ON %I.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_sops_set_updated_at ON %I.sops', v_schema);
  EXECUTE format('CREATE TRIGGER trg_sops_set_updated_at BEFORE UPDATE ON %I.sops FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_chat_channels_set_updated_at ON %I.chat_channels', v_schema);
  EXECUTE format('CREATE TRIGGER trg_chat_channels_set_updated_at BEFORE UPDATE ON %I.chat_channels FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_workflow_definitions_set_updated_at ON %I.workflow_definitions', v_schema);
  EXECUTE format('CREATE TRIGGER trg_workflow_definitions_set_updated_at BEFORE UPDATE ON %I.workflow_definitions FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_settings_set_updated_at ON %I.tenant_settings', v_schema);
  EXECUTE format('CREATE TRIGGER trg_tenant_settings_set_updated_at BEFORE UPDATE ON %I.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_user_dashboard_config_set_updated_at ON %I.user_dashboard_config', v_schema);
  EXECUTE format('CREATE TRIGGER trg_user_dashboard_config_set_updated_at BEFORE UPDATE ON %I.user_dashboard_config FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  EXECUTE format('DROP TRIGGER IF EXISTS trg_insurances_set_updated_at ON %I.insurances', v_schema);
  EXECUTE format('CREATE TRIGGER trg_insurances_set_updated_at BEFORE UPDATE ON %I.insurances FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at()', v_schema);

  -- =========================================================================
  -- SEED RBAC
  -- =========================================================================

  PERFORM public.seed_tenant_rbac(v_schema);

  -- =========================================================================
  -- UPDATE REGISTRY
  -- =========================================================================

  UPDATE public.tenant_registry
     SET schema_name = v_schema,
         updated_at = now()
   WHERE tenant_id = p_tenant_id;

  RETURN v_schema;
END;
$$;

-- Re-provision all active tenant schemas to pick up new tables
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT tenant_id, schema_name
      FROM public.tenant_registry
     WHERE status = 'active'
       AND deleted_at IS NULL
       AND schema_name IS NOT NULL
  LOOP
    PERFORM public.provision_tenant_schema(rec.tenant_id, rec.schema_name);
  END LOOP;
END
$$;
