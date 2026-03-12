-- Calendar audit logs (90 days retention handled by app)
CREATE TABLE IF NOT EXISTS calendar_audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  subject_id  TEXT,
  metadata    JSONB DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_audit_logs_tenant_time ON calendar_audit_logs (tenant_id, created_at DESC);

