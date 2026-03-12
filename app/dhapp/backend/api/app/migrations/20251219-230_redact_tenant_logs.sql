-- Redact legacy PII from tenant_logs to align with privacy requirements
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_logs' AND column_name = 'username'
  ) THEN
    UPDATE tenant_logs SET username = NULL WHERE username IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_logs' AND column_name = 'ip'
  ) THEN
    UPDATE tenant_logs SET ip = NULL WHERE ip IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_logs' AND column_name = 'ip_address'
  ) THEN
    UPDATE tenant_logs SET ip_address = NULL WHERE ip_address IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant_logs' AND column_name = 'payload'
  ) THEN
    UPDATE tenant_logs SET payload = NULL WHERE payload IS NOT NULL;
  END IF;
END $$ LANGUAGE plpgsql;
