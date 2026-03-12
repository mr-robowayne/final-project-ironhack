-- 20251114-052_create_appointment_reminders.sql
-- Stores planned/sent reminders per appointment to avoid duplicates

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  appointment_id  BIGINT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'INTERNAL', -- INTERNAL, EMAIL, SMS
  due_at          TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  payload         JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_reminder_unique
  ON appointment_reminders (tenant_id, appointment_id, channel, due_at);

CREATE INDEX IF NOT EXISTS idx_appt_reminder_due
  ON appointment_reminders (tenant_id, status, due_at);

-- Optional FK when appointments table exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments'
  ) THEN
    BEGIN
      ALTER TABLE appointment_reminders
        ADD CONSTRAINT fk_appointment_reminders_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

