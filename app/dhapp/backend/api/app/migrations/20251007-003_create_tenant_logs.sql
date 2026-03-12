-- Migration: persist tenant-specific audit logs in the database
CREATE TABLE IF NOT EXISTS tenant_logs (
  tenant_id TEXT NOT NULL,
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT,
  user_id TEXT,
  username TEXT,
  ip_address INET,
  user_agent TEXT,
  correlation_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes with compatibility for existing schema (action vs event)
DO $$
BEGIN
  -- Always ensure created_at index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'i' AND c.relname = 'idx_tenant_logs_tenant_created_at'
  ) THEN
    EXECUTE 'CREATE INDEX idx_tenant_logs_tenant_created_at ON tenant_logs (tenant_id, created_at DESC)';
  END IF;

  -- If column "event" exists, index it; otherwise skip (base schema may use "action")
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_logs' AND column_name = 'event'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'i' AND c.relname = 'idx_tenant_logs_tenant_event'
    ) THEN
      EXECUTE 'CREATE INDEX idx_tenant_logs_tenant_event ON tenant_logs (tenant_id, event)';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
