-- Migration: Align schema with unified multi-tenant domain model
-- Applies to: PostgreSQL 13+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
BEGIN
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := 'test';
  END IF;

  -- USERS -------------------------------------------------------------------
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS tenant_id TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS vorname TEXT,
    ADD COLUMN IF NOT EXISTS nachname TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS role TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

  UPDATE users
     SET tenant_id = COALESCE(tenant_id, v_tenant_id),
         name = COALESCE(NULLIF(name, ''), trim(both ' ' FROM concat_ws(' ', vorname, nachname))),
         vorname = COALESCE(vorname, split_part(trim(both ' ' FROM concat_ws(' ', vorname, nachname)), ' ', 1)),
         nachname = COALESCE(nachname, regexp_replace(trim(both ' ' FROM concat_ws(' ', vorname, nachname)), '^[^ ]+\\s*', '')),
         role = COALESCE(
           NULLIF(role, ''),
           CASE lower(coalesce(rolle, 'assistenz'))
             WHEN 'admin' THEN 'admin'
             WHEN 'arzt' THEN 'doctor'
             WHEN 'doctor' THEN 'doctor'
             WHEN 'assistenz' THEN 'assistant'
             WHEN 'abrechnung' THEN 'billing'
             ELSE 'assistant'
           END
         ),
         email = NULLIF(email, '')
   WHERE 1 = 1;

  UPDATE users
     SET email = concat('demo+', id, '@example.invalid')
   WHERE email IS NULL;

  UPDATE users
     SET username = COALESCE(username, lower(regexp_replace(name, '\\s+', '.','g')))
   WHERE username IS NULL;

  ALTER TABLE users
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN role SET NOT NULL;

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_role_valid'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_role_valid
        CHECK (role IN ('admin','doctor','assistant','billing'));
    END IF;
  END
  $inner$;

  UPDATE users
     SET rolle = role
   WHERE rolle IS DISTINCT FROM role;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email
    ON users (tenant_id, lower(email));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username
    ON users (tenant_id, lower(username));

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_set_updated_at'
    ) THEN
      CREATE TRIGGER trg_users_set_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION public.set_timestamp_updated_at();
    END IF;
  END
  $inner$;

  -- PATIENTS ----------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'patienten'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'patients'
  ) THEN
    ALTER TABLE patienten RENAME TO patients;
  END IF;

  -- Kompatibilitäts-View für Alt-Code
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'patients'
  ) THEN
    EXECUTE 'DROP VIEW IF EXISTS patienten CASCADE';
    EXECUTE 'CREATE VIEW patienten AS SELECT * FROM patients';
  END IF;

  ALTER TABLE IF EXISTS patients
    ADD COLUMN IF NOT EXISTS tenant_id TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS vorname TEXT,
    ADD COLUMN IF NOT EXISTS nachname TEXT,
    ADD COLUMN IF NOT EXISTS birthdate DATE,
    ADD COLUMN IF NOT EXISTS geburtsdatum DATE,
    ADD COLUMN IF NOT EXISTS gender TEXT,
    ADD COLUMN IF NOT EXISTS geschlecht TEXT,
    ADD COLUMN IF NOT EXISTS insurance TEXT,
    ADD COLUMN IF NOT EXISTS insurance_number TEXT,
    ADD COLUMN IF NOT EXISTS versichertennummer TEXT,
    ADD COLUMN IF NOT EXISTS krankenkasse TEXT,
    ADD COLUMN IF NOT EXISTS krankenkasse_adresse TEXT,
    ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS telefonnummer TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS adresse TEXT,
    ADD COLUMN IF NOT EXISTS hausnummer TEXT,
    ADD COLUMN IF NOT EXISTS plz TEXT,
    ADD COLUMN IF NOT EXISTS ort TEXT,
    ADD COLUMN IF NOT EXISTS address JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS krankengeschichte TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

  UPDATE patients
     SET tenant_id = COALESCE(tenant_id, v_tenant_id),
         name = COALESCE(NULLIF(name, ''), trim(both ' ' FROM concat_ws(' ', vorname, nachname))),
         vorname = COALESCE(vorname, split_part(trim(both ' ' FROM concat_ws(' ', vorname, nachname)), ' ', 1)),
         nachname = COALESCE(nachname, regexp_replace(trim(both ' ' FROM concat_ws(' ', vorname, nachname)), '^[^ ]+\\s*', '')),
         birthdate = COALESCE(birthdate, geburtsdatum),
         geburtsdatum = COALESCE(geburtsdatum, birthdate),
         gender = COALESCE(
           NULLIF(gender, ''),
           CASE lower(coalesce(geschlecht, ''))
             WHEN 'w' THEN 'female'
             WHEN 'f' THEN 'female'
             WHEN 'm' THEN 'male'
             WHEN 'd' THEN 'other'
             ELSE NULL
           END
         ),
         geschlecht = COALESCE(geschlecht, gender),
         insurance = COALESCE(insurance, krankenkasse),
         insurance_number = COALESCE(insurance_number, versichertennummer),
         versichertennummer = COALESCE(versichertennummer, insurance_number),
         krankenkasse = COALESCE(krankenkasse, insurance),
         phone = COALESCE(phone, telefonnummer),
         telefonnummer = COALESCE(telefonnummer, phone),
         address = jsonb_strip_nulls(
           COALESCE(
             address,
             jsonb_build_object(
               'street', adresse,
               'houseNo', hausnummer,
               'zip', plz,
               'city', ort
            )
          )
        ),
        adresse = COALESCE(adresse, (address ->> 'street')),
        hausnummer = COALESCE(hausnummer, (address ->> 'houseNo')),
        plz = COALESCE(plz, (address ->> 'zip')),
        ort = COALESCE(ort, (address ->> 'city')),
        notes = COALESCE(notes, krankengeschichte),
        krankengeschichte = COALESCE(krankengeschichte, notes)
   WHERE 1 = 1;

  ALTER TABLE patients
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN name SET NOT NULL;

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'patients_doctor_id_fkey'
    ) THEN
      ALTER TABLE patients
        ADD CONSTRAINT patients_doctor_id_fkey
        FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END
  $inner$;

  CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_patients_doctor ON patients (tenant_id, doctor_id);
  CREATE INDEX IF NOT EXISTS idx_patients_insurance ON patients (tenant_id, insurance_number);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_tenant_insurance ON patients (tenant_id, insurance_number);

  DO $inner$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'patienten_id_seq'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'patients_id_seq'
    ) THEN
      ALTER SEQUENCE patienten_id_seq RENAME TO patients_id_seq;
    END IF;
  END
  $inner$;

  -- APPOINTMENTS -------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'kalender'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    ALTER TABLE kalender RENAME TO appointments;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    EXECUTE 'DROP VIEW IF EXISTS kalender CASCADE';
    EXECUTE 'CREATE VIEW kalender AS SELECT * FROM appointments';
  END IF;

  ALTER TABLE IF EXISTS appointments
    ADD COLUMN IF NOT EXISTS tenant_id TEXT,
    ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled',
    ADD COLUMN IF NOT EXISTS termin_name TEXT,
    ADD COLUMN IF NOT EXISTS beschreibung TEXT,
    ADD COLUMN IF NOT EXISTS termin_datum DATE,
    ADD COLUMN IF NOT EXISTS startzeit TIME,
    ADD COLUMN IF NOT EXISTS endzeit TIME,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

  UPDATE appointments
     SET tenant_id = COALESCE(tenant_id, v_tenant_id),
         starts_at = COALESCE(
           starts_at,
           CASE
             WHEN termin_datum IS NOT NULL AND startzeit IS NOT NULL THEN
               (termin_datum::timestamp + startzeit)
             WHEN termin_datum IS NOT NULL THEN
               termin_datum::timestamp
             ELSE NULL
           END
         ),
         duration_minutes = COALESCE(
           duration_minutes,
           CASE
             WHEN startzeit IS NOT NULL AND endzeit IS NOT NULL THEN
               GREATEST(15, CEIL(EXTRACT(EPOCH FROM (endzeit - startzeit)) / 60)::INTEGER)
             ELSE 30
           END
         ),
        reason = COALESCE(reason, termin_name),
        termin_name = COALESCE(termin_name, reason),
        beschreibung = COALESCE(beschreibung, reason),
        termin_datum = COALESCE(termin_datum, DATE(starts_at)),
        startzeit = COALESCE(startzeit, (starts_at::time)),
        endzeit = COALESCE(
          endzeit,
          CASE
            WHEN starts_at IS NOT NULL THEN (starts_at + make_interval(mins => duration_minutes))::time
            ELSE NULL
          END
        ),
        status = COALESCE(NULLIF(status, ''), 'scheduled')
   WHERE 1 = 1;

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'appointments_doctor_id_fkey'
    ) THEN
      ALTER TABLE appointments
        ADD CONSTRAINT appointments_doctor_id_fkey
        FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END
  $inner$;

  CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date
    ON appointments (tenant_id, starts_at);
  CREATE INDEX IF NOT EXISTS idx_appointments_patient
    ON appointments (tenant_id, patient_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_tenant_patient_start
    ON appointments (tenant_id, patient_id, starts_at);

  DO $inner$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'kalender_id_seq'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'appointments_id_seq'
    ) THEN
      ALTER SEQUENCE kalender_id_seq RENAME TO appointments_id_seq;
    END IF;
  END
  $inner$;

  -- INVOICES -----------------------------------------------------------------
  ALTER TABLE IF EXISTS invoices
    ADD COLUMN IF NOT EXISTS doctor_id INTEGER,
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS storage_path TEXT,
    ADD COLUMN IF NOT EXISTS tenant_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS filesize BIGINT,
    ADD COLUMN IF NOT EXISTS pdf_checksum TEXT,
    ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

  DO $inner$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'invoices' AND column_name = 'total_amount'
    ) THEN
      ALTER TABLE invoices
        RENAME COLUMN total_amount TO total;
    END IF;
  END
  $inner$;

  UPDATE invoices inv
     SET doctor_id = COALESCE(
           doctor_id,
           (SELECT id
              FROM users u
             WHERE u.tenant_id = inv.tenant_id
               AND (lower(u.email) = lower(inv.payload ->> 'doctor_email')
                    OR u.name = (inv.payload ->> 'doctor_name'))
             LIMIT 1)
         );

  UPDATE invoices inv
     SET created_by_user_id = COALESCE(
           created_by_user_id,
           (SELECT id FROM users u
             WHERE u.tenant_id = inv.tenant_id
               AND (lower(u.email) = lower(inv.created_by)
                    OR u.username = inv.created_by
                    OR u.name = inv.created_by)
             LIMIT 1)
         );

  ALTER TABLE invoices
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN patient_id SET NOT NULL,
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN total SET NOT NULL,
    ALTER COLUMN currency SET NOT NULL;

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'invoices_doctor_id_fkey'
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT invoices_doctor_id_fkey
        FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END
  $inner$;

  DO $inner$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'invoices_created_by_user_id_fkey'
    ) THEN
      ALTER TABLE invoices
        ADD CONSTRAINT invoices_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END
  $inner$;

  CREATE INDEX IF NOT EXISTS idx_invoices_patient
    ON invoices (tenant_id, patient_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status
    ON invoices (tenant_id, status);

  -- DOCUMENTS ----------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS documents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    TEXT NOT NULL,
    patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    file_path    TEXT NOT NULL,
    type         TEXT NOT NULL,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    size_bytes   BIGINT,
    hash         TEXT,
    metadata     JSONB DEFAULT '{}'::JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_documents_patient
    ON documents (tenant_id, patient_id);
  CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at
    ON documents (tenant_id, uploaded_at DESC);

  -- TENANT LOGS --------------------------------------------------------------
  DO $inner$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tenant_logs' AND column_name = 'event'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tenant_logs' AND column_name = 'action'
    ) THEN
      ALTER TABLE tenant_logs RENAME COLUMN event TO action;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tenant_logs' AND column_name = 'ip_address'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tenant_logs' AND column_name = 'ip'
    ) THEN
      ALTER TABLE tenant_logs RENAME COLUMN ip_address TO ip;
    END IF;
  END
  $inner$;

  ALTER TABLE tenant_logs
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS correlation_id TEXT,
    ADD COLUMN IF NOT EXISTS payload JSONB,
    ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'info';

  UPDATE tenant_logs
     SET tenant_id = COALESCE(tenant_id, v_tenant_id);

  CREATE INDEX IF NOT EXISTS idx_tenant_logs_tenant_created_at
    ON tenant_logs (tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tenant_logs_tenant_action
    ON tenant_logs (tenant_id, action);
END;
$$ LANGUAGE plpgsql;
