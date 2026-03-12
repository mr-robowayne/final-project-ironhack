-- 20251114-100_create_patient_communication_log.sql

CREATE TABLE IF NOT EXISTS patient_communication_log (
  id           SERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('PHONE','EMAIL','SMS','LETTER','IN_PERSON')),
  direction    TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  summary      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_log_tenant_patient ON patient_communication_log (tenant_id, patient_id, created_at DESC);

