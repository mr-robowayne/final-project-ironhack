-- 20251018-030_update_appt_unique_calendar.sql
-- Ziel: Erlaubt pro Patient mehrere Termine zum selben Zeitpunkt in unterschiedlichen Kalendern
-- Umsetzung: Unique-Constraint von (tenant_id, patient_id, starts_at) auf
--             (tenant_id, calendar_id, patient_id, starts_at) erweitern.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_appointments_tenant_patient_start'
  ) THEN
    DROP INDEX IF EXISTS public.uq_appointments_tenant_patient_start;
  END IF;
END$$;

-- Neues Unique-Constraint inkl. calendar_id
DO $$
BEGIN
  -- calendar_id ist in vorheriger Migration hinzugefügt worden; falls nicht vorhanden, abbrechen
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='calendar_id'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_appts_tenant_calendar_patient_start
      ON public.appointments(tenant_id, calendar_id, patient_id, starts_at);
  END IF;
END$$;

