-- Harden tenant_logs for schema compatibility and privacy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='event'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN event TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='ts'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN ts TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='purpose'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN purpose TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='username_hash'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN username_hash TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='ip_hash'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN ip_hash TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='prev_hash'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN prev_hash TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='tenant_logs' AND column_name='entry_hash'
  ) THEN
    ALTER TABLE tenant_logs ADD COLUMN entry_hash TEXT;
  END IF;
  -- Backfill event from action where empty
  UPDATE tenant_logs SET event = COALESCE(event, action) WHERE event IS NULL;
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_tenant_logs_tenant_ts') THEN
    CREATE INDEX idx_tenant_logs_tenant_ts ON tenant_logs(tenant_id, ts DESC);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_tenant_logs_tenant_event') THEN
    CREATE INDEX idx_tenant_logs_tenant_event ON tenant_logs(tenant_id, event);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_tenant_logs_corr') THEN
    CREATE INDEX idx_tenant_logs_corr ON tenant_logs(correlation_id);
  END IF;
END $$ LANGUAGE plpgsql;

