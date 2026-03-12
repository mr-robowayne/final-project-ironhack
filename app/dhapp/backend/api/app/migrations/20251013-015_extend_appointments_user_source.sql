-- Extend appointments for user calendars and source semantics
DO $$ BEGIN
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT;
  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS synced BOOLEAN NOT NULL DEFAULT false;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'appointments'
       AND constraint_type = 'CHECK'
       AND constraint_name = 'chk_appointments_source'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_source CHECK (source IN ('general','user'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appts_tenant_source ON appointments (tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_appts_tenant_user ON appointments (tenant_id, user_id);

