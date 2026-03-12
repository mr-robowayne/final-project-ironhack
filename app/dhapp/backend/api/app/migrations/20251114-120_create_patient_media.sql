-- 20251114-120_create_patient_media.sql

CREATE TABLE IF NOT EXISTS patient_media (
  id           SERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'OTHER' CHECK (type IN ('IMAGE','VIDEO','OTHER')),
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_media_tenant_patient ON patient_media (tenant_id, patient_id, created_at DESC);

