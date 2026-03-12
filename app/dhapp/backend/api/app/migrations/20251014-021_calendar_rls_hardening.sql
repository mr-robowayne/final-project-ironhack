BEGIN;

-- 1) Ensure set_timestamp_updated_at() exists (idempotent)
DO $$
BEGIN
  PERFORM 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'set_timestamp_updated_at'
    AND n.nspname = 'public';

  IF NOT FOUND THEN
    CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;$fn$;
  END IF;
END$$;

-- 2) Ensure calendar_audit_logs exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='calendar_audit_logs'
  ) THEN
    CREATE TABLE public.calendar_audit_logs (
      id         bigserial PRIMARY KEY,
      tenant_id  text NOT NULL,
      user_id    integer,
      action     text NOT NULL,
      subject_id text,
      metadata   jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_audit_logs_tenant_time
      ON public.calendar_audit_logs(tenant_id, created_at DESC);
  END IF;
END$$;

COMMIT;

-- 3) RLS hardening: replace policies with safe current_setting() usage
BEGIN;

-- calendars
DROP POLICY IF EXISTS calendars_read    ON public.calendars;
DROP POLICY IF EXISTS calendars_write   ON public.calendars;
DROP POLICY IF EXISTS calendars_update  ON public.calendars;
DROP POLICY IF EXISTS calendars_delete  ON public.calendars;

CREATE POLICY calendars_read ON public.calendars
FOR SELECT USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  (
    type = 'tenant'
    OR EXISTS (
      SELECT 1 FROM public.calendar_members m
      WHERE m.calendar_id = calendars.id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
    )
  )
);

CREATE POLICY calendars_update ON public.calendars
FOR UPDATE USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = calendars.id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
);

CREATE POLICY calendars_delete ON public.calendars
FOR DELETE USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = calendars.id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
);

-- calendar_members
DROP POLICY IF EXISTS calmem_rw ON public.calendar_members;

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
);

-- appointments
DROP POLICY IF EXISTS appts_read    ON public.appointments;
DROP POLICY IF EXISTS appts_write   ON public.appointments;
DROP POLICY IF EXISTS appts_insert  ON public.appointments;
DROP POLICY IF EXISTS appts_update  ON public.appointments;
DROP POLICY IF EXISTS appts_delete  ON public.appointments;

CREATE POLICY appts_read ON public.appointments
FOR SELECT USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = appointments.calendar_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
  )
);

CREATE POLICY appts_insert ON public.appointments
FOR INSERT
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = appointments.calendar_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
);

CREATE POLICY appts_update ON public.appointments
FOR UPDATE
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = appointments.calendar_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = appointments.calendar_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
);

CREATE POLICY appts_delete ON public.appointments
FOR DELETE
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '') AND
  EXISTS (
    SELECT 1 FROM public.calendar_members m
    WHERE m.calendar_id = appointments.calendar_id
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
      AND m.role IN ('owner','editor')
  )
);

COMMIT;

-- 4) Optional performance index for calendar views
CREATE INDEX IF NOT EXISTS idx_appointments_calendar_starts
  ON public.appointments(calendar_id, starts_at);
