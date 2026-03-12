-- 20251113-041_create_sick_notes.sql
-- Create sick_notes (Krankmeldungen / Arbeitsunfähigkeitszeugnisse)

CREATE TABLE IF NOT EXISTS sick_notes (
  id                   SERIAL PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  patient_id           INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,

  start_date           DATE NOT NULL,
  end_date             DATE,
  open_end             BOOLEAN NOT NULL DEFAULT false,
  degree_percent       INTEGER NOT NULL DEFAULT 100 CHECK (degree_percent >= 0 AND degree_percent <= 100),

  diagnosis_short      TEXT,
  remark               TEXT,

  receiver_type        TEXT NOT NULL DEFAULT 'PATIENT' CHECK (receiver_type IN ('ARBEITGEBER','VERSICHERUNG','PATIENT','SONSTIGER')),
  receiver_name        TEXT,
  receiver_address     TEXT,

  status               TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
  pdf_path             TEXT,
  document_path        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sick_notes_tenant_patient
  ON sick_notes (tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_sick_notes_created_at
  ON sick_notes (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sick_notes_set_updated_at ON sick_notes;
CREATE TRIGGER trg_sick_notes_set_updated_at
  BEFORE UPDATE ON sick_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

