-- 20251114-050_create_patient_journey_and_waiting_room.sql
-- Patienten-Journey und Wartezimmer-Status (Multi-Tenant)

-- Ensure helper exists
DO $$
BEGIN
  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'set_timestamp_updated_at'
     AND n.nspname = 'public';
  IF NOT FOUND THEN
    CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
  END IF;
END$$;

-- Patienten-Journey: eine Zeile pro Patient/Tenant
CREATE TABLE IF NOT EXISTS patient_journey (
  id                  SERIAL PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  stage               TEXT NOT NULL CHECK (stage IN (
                         'NEW','ABKLAERUNG','OP_GEPLANT','OP_ERFOLGT','NACHKONTROLLE','ABGESCHLOSSEN'
                       )),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_journey_tenant_patient
  ON patient_journey (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_journey_tenant_stage
  ON patient_journey (tenant_id, stage);

DROP TRIGGER IF EXISTS trg_patient_journey_updated ON patient_journey;
CREATE TRIGGER trg_patient_journey_updated
  BEFORE UPDATE ON patient_journey
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

-- Wartezimmer-Status: eine Zeile pro Patient/Tenant
CREATE TABLE IF NOT EXISTS waiting_room_status (
  id                      SERIAL PRIMARY KEY,
  tenant_id               TEXT NOT NULL,
  patient_id              INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL CHECK (status IN (
                            'ANGEMELDET','WARTEZIMMER','IN_BEHANDLUNG','FERTIG'
                          )),
  last_change_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_change_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_waiting_room_tenant_patient
  ON waiting_room_status (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_waiting_room_tenant_status
  ON waiting_room_status (tenant_id, status);

