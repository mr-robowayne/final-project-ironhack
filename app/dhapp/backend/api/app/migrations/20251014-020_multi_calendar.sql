-- 20251014-020_multi_calendar.sql

-- 0) Safety: benötigte Helper bereitstellen (falls fehlen)
-- updated_at trigger function (idempotent via OR REPLACE)
CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- audit table (if missing)
CREATE TABLE IF NOT EXISTS public.calendar_audit_logs(
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id integer,
  action text NOT NULL,
  subject_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_audit_logs_tenant_time
  ON public.calendar_audit_logs(tenant_id, created_at DESC);

-- 1) calendars
CREATE TABLE IF NOT EXISTS public.calendars (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('tenant','user')),
  owner_user_id INTEGER,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_tenant_default
  ON public.calendars(tenant_id) WHERE (type='tenant' AND is_default=true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_tenant_owner_user
  ON public.calendars(tenant_id, owner_user_id) WHERE (type='user');

CREATE INDEX IF NOT EXISTS idx_calendars_tenant_type ON public.calendars(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_calendars_owner       ON public.calendars(owner_user_id);

DROP TRIGGER IF EXISTS trg_calendars_set_updated_at ON public.calendars;
CREATE TRIGGER trg_calendars_set_updated_at
BEFORE UPDATE ON public.calendars
FOR EACH ROW EXECUTE FUNCTION public.set_timestamp_updated_at();

-- 2) calendar_members
CREATE TABLE IF NOT EXISTS public.calendar_members (
  calendar_id BIGINT  NOT NULL,
  user_id     INTEGER NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (calendar_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_members_user     ON public.calendar_members(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_members_cal_role ON public.calendar_members(calendar_id, role);

-- Add FKs conditionally when referenced tables exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'
  ) THEN
    -- calendars.owner_user_id -> users(id)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name='calendars' AND constraint_name='fk_calendars_owner_user'
    ) THEN
      ALTER TABLE public.calendars
        ADD CONSTRAINT fk_calendars_owner_user
        FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL
        NOT VALID;
    END IF;
    -- calendar_members.user_id -> users(id)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name='calendar_members' AND constraint_name='fk_calmembers_user'
    ) THEN
      ALTER TABLE public.calendar_members
        ADD CONSTRAINT fk_calmembers_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
        NOT VALID;
    END IF;
  END IF;
  -- calendar_members.calendar_id -> calendars(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='calendar_members' AND constraint_name='fk_calmembers_calendar'
  ) THEN
    ALTER TABLE public.calendar_members
      ADD CONSTRAINT fk_calmembers_calendar
      FOREIGN KEY (calendar_id) REFERENCES public.calendars(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- 3) appointments.calendar_id (vorerst NULL + FK NOT VALID)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='appointments' AND column_name='calendar_id'
    ) THEN
      ALTER TABLE public.appointments ADD COLUMN calendar_id BIGINT;
    END IF;
    BEGIN
      ALTER TABLE public.appointments
        ADD CONSTRAINT fk_appointments_calendar
        FOREIGN KEY (calendar_id) REFERENCES public.calendars(id) ON DELETE RESTRICT
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN
      -- constraint already added
      NULL;
    END;
  END IF;
END$$;

-- 4) Default-Tenant-Kalender je Tenant anlegen (nur wenn Basis-Tabellen vorhanden)
DO $$
DECLARE has_users boolean; has_patients boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'
  ) INTO has_users;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='patients'
  ) INTO has_patients;
  IF has_users OR has_patients THEN
    EXECUTE (
      'WITH tenants AS (
         SELECT DISTINCT tenant_id FROM (
           ' || (CASE WHEN has_users THEN 'SELECT tenant_id FROM public.users' ELSE 'SELECT NULL::text WHERE false' END) ||
           ' UNION ' ||
           (CASE WHEN has_patients THEN 'SELECT tenant_id FROM public.patients' ELSE 'SELECT NULL::text WHERE false' END) ||
         ' ) x
       )
       INSERT INTO public.calendars(tenant_id, name, type, is_default, metadata)
       SELECT t.tenant_id, ''Praxis-Kalender'', ''tenant'', true, ''{}''::jsonb
       FROM tenants t
       LEFT JOIN public.calendars c
         ON c.tenant_id=t.tenant_id AND c.type=''tenant'' AND c.is_default
       WHERE c.id IS NULL'
    );
  END IF;
END$$;

-- 5) User-Kalender je User anlegen (nur wenn users existiert)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    INSERT INTO public.calendars(tenant_id, name, type, owner_user_id, is_default, metadata)
    SELECT u.tenant_id,
           COALESCE(NULLIF(trim(u.name), ''), u.email, 'Benutzer-Kalender') AS name,
           'user', u.id, false, jsonb_build_object('role', u.role)
    FROM public.users u
    LEFT JOIN public.calendars c
      ON c.type='user' AND c.owner_user_id=u.id AND c.tenant_id=u.tenant_id
    WHERE c.id IS NULL;
  END IF;
END$$;

-- 6) Memberships seeden
-- Owner für User-Kalender
DO $$
BEGIN
  INSERT INTO public.calendar_members(calendar_id, user_id, role)
  SELECT c.id, c.owner_user_id, 'owner'
  FROM public.calendars c
  WHERE c.type='user' AND c.owner_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;
END$$;

-- Tenant-Kalender: admin/doctor = editor, assistant/billing = viewer
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    INSERT INTO public.calendar_members(calendar_id, user_id, role)
    SELECT c.id, u.id,
           CASE WHEN u.role IN ('admin','doctor') THEN 'editor' ELSE 'viewer' END
    FROM public.calendars c
    JOIN public.users u ON u.tenant_id = c.tenant_id
    WHERE c.type='tenant'
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

-- Optional: Admins als viewer in allen User-Kalendern
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    INSERT INTO public.calendar_members(calendar_id, user_id, role)
    SELECT c.id, a.id, 'viewer'
    FROM public.calendars c
    JOIN public.users a ON a.tenant_id=c.tenant_id AND a.role='admin'
    WHERE c.type='user' AND c.owner_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

-- 7) Backfill appointments.calendar_id
-- 7a) user-Appointments -> User-Kalender
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    WITH user_cal AS (
      SELECT id AS calendar_id, owner_user_id, tenant_id FROM public.calendars WHERE type='user'
    )
    UPDATE public.appointments a
    SET calendar_id = uc.calendar_id
    FROM user_cal uc
    WHERE a.calendar_id IS NULL
      AND a.user_id IS NOT NULL
      AND a.tenant_id = uc.tenant_id
      AND a.user_id   = uc.owner_user_id
      AND a.source = 'user';
  END IF;
END$$;

-- 7b) Rest -> Default-Tenant-Kalender
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    WITH tenant_cal AS (
      SELECT id AS calendar_id, tenant_id FROM public.calendars WHERE type='tenant' AND is_default
    )
    UPDATE public.appointments a
    SET calendar_id = tc.calendar_id
    FROM tenant_cal tc
    WHERE a.calendar_id IS NULL
      AND a.tenant_id = tc.tenant_id;
  END IF;
END$$;

-- 7c) Sicherstellen, dass alles gesetzt ist
DO $$
DECLARE v_missing INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    SELECT COUNT(*) INTO v_missing FROM public.appointments WHERE calendar_id IS NULL;
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'Backfill incomplete: % appointments without calendar_id', v_missing;
    END IF;
  END IF;
END$$;

-- 8) calendar_id NOT NULL & FK validieren
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='appointments' AND column_name='calendar_id') THEN
    BEGIN
      ALTER TABLE public.appointments ALTER COLUMN calendar_id SET NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.appointments VALIDATE CONSTRAINT fk_appointments_calendar;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END IF;
END$$;

-- 9) Konsistenz-Trigger (tenant_id von appt == tenant_id des Kalenders)
CREATE OR REPLACE FUNCTION public.ensure_calendar_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cal_tenant TEXT;
BEGIN
  IF NEW.calendar_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id INTO cal_tenant FROM public.calendars WHERE id=NEW.calendar_id;
  IF cal_tenant IS NULL THEN RAISE EXCEPTION 'calendar_id % not found', NEW.calendar_id; END IF;
  IF NEW.tenant_id IS DISTINCT FROM cal_tenant THEN
    RAISE EXCEPTION 'tenant mismatch: appointment.tenant_id=%, calendar.tenant_id=%', NEW.tenant_id, cal_tenant;
  END IF;
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    DROP TRIGGER IF EXISTS trg_appt_tenant_consistency ON public.appointments;
    CREATE TRIGGER trg_appt_tenant_consistency
    BEFORE INSERT OR UPDATE OF calendar_id, tenant_id ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.ensure_calendar_tenant_consistency();
  END IF;
END$$;

-- 10) View "kalender" inkl. calendar_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    DROP VIEW IF EXISTS public.kalender;
    CREATE VIEW public.kalender AS
    SELECT a.id, a.tenant_id, a.patient_id, a.doctor_id,
           a.starts_at, a.duration_minutes, a.reason, a.status,
           a.termin_name, a.beschreibung, a.termin_datum, a.startzeit, a.endzeit,
           a.created_at, a.updated_at,
           a.calendar_id
    FROM public.appointments a;
  END IF;
END$$;

-- 11) Auditing für appointments
CREATE OR REPLACE FUNCTION public.log_appointment_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE act TEXT;
BEGIN
  IF TG_OP='INSERT' THEN act:='appointment.created';
  ELSIF TG_OP='UPDATE' THEN act:='appointment.updated';
  ELSIF TG_OP='DELETE' THEN act:='appointment.deleted';
  END IF;

  INSERT INTO public.calendar_audit_logs(tenant_id, user_id, action, subject_id, metadata, created_at)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    NULLIF(current_setting('app.user_id', true), '')::INT,
    act,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    jsonb_build_object('op', TG_OP, 'calendar_id', COALESCE(NEW.calendar_id, OLD.calendar_id), 'changed_at', now()),
    now()
  );
  RETURN COALESCE(NEW, OLD);
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    DROP TRIGGER IF EXISTS trg_appt_audit_ins ON public.appointments;
    DROP TRIGGER IF EXISTS trg_appt_audit_upd ON public.appointments;
    DROP TRIGGER IF EXISTS trg_appt_audit_del ON public.appointments;
    CREATE TRIGGER trg_appt_audit_ins AFTER INSERT ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.log_appointment_audit();
    CREATE TRIGGER trg_appt_audit_upd AFTER UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.log_appointment_audit();
    CREATE TRIGGER trg_appt_audit_del AFTER DELETE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.log_appointment_audit();
  END IF;
END$$;

-- 12) Performance: Index für Kalender-Zeit-Abfragen
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    CREATE INDEX IF NOT EXISTS idx_appointments_calendar_starts
      ON public.appointments(calendar_id, starts_at);
  END IF;
END$$;

-- 13) RLS aktivieren (Least-Privilege, GUC-basiert)
-- Achtung: RLS setzt voraus, dass Sessions app.tenant_id / app.user_id setzen.
DO $$
BEGIN
  -- calendars
  EXECUTE 'ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendars' AND policyname='calendars_read') THEN
    EXECUTE $p$
    CREATE POLICY calendars_read ON public.calendars
    FOR SELECT USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND (
        type='tenant'
        OR EXISTS (
          SELECT 1 FROM public.calendar_members m
          WHERE m.calendar_id = calendars.id
            AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
        )
      )
    ) $p$;
  END IF;

  -- Separate update/delete policies for calendars
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendars' AND policyname='calendars_update'
  ) THEN
    EXECUTE $p$
    CREATE POLICY calendars_update ON public.calendars
    FOR UPDATE
    USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = calendars.id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    )
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendars' AND policyname='calendars_delete'
  ) THEN
    EXECUTE $p$
    CREATE POLICY calendars_delete ON public.calendars
    FOR DELETE
    USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = calendars.id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    )
    $p$;
  END IF;

  -- calendar_members
  EXECUTE 'ALTER TABLE public.calendar_members ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='calendar_members' AND policyname='calmem_rw') THEN
    EXECUTE $p$
    CREATE POLICY calmem_rw ON public.calendar_members
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM public.calendars c
        WHERE c.id = calendar_members.calendar_id
          AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.calendars c
        WHERE c.id = calendar_members.calendar_id
          AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      )
    )
    $p$;
  END IF;

  -- appointments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    EXECUTE 'ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appts_read') THEN
    EXECUTE $p$
    CREATE POLICY appts_read ON public.appointments
    FOR SELECT USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = appointments.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      )
    ) $p$;
  END IF;

  -- Separate write policies: INSERT (check), UPDATE (using+check), DELETE (using)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appts_insert'
  ) THEN
    EXECUTE $p$
    CREATE POLICY appts_insert ON public.appointments
    FOR INSERT
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = appointments.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    ) $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appts_update'
  ) THEN
    EXECUTE $p$
    CREATE POLICY appts_update ON public.appointments
    FOR UPDATE
    USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = appointments.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    )
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = appointments.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    ) $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appts_delete'
  ) THEN
    EXECUTE $p$
    CREATE POLICY appts_delete ON public.appointments
    FOR DELETE
    USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = appointments.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
          AND m.role IN ('owner','editor')
      )
    ) $p$;
  END IF;
  END IF;
END$$;
