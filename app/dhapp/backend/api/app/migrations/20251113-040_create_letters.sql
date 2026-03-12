-- 20251113-040_create_letters.sql
-- Create letters table to store structured medical letters and metadata

CREATE TABLE IF NOT EXISTS letters (
  id                 SERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  patient_id         INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINAL')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content            JSONB DEFAULT '{}'::JSONB,
  pdf_path           TEXT,
  document_path      TEXT
);

CREATE INDEX IF NOT EXISTS idx_letters_tenant_patient
  ON letters (tenant_id, patient_id);

CREATE TRIGGER trg_letters_set_updated_at
  BEFORE UPDATE ON letters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

