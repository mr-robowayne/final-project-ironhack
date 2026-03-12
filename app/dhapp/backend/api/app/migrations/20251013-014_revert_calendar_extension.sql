-- Revert calendar extension: drop added tables and columns if they exist
DO $$ BEGIN
  -- Drop check constraint if present
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'appointments'
       AND constraint_type = 'CHECK'
       AND constraint_name = 'chk_appointments_status'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT chk_appointments_status;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

-- Drop columns (ignore if absent)
DO $$ BEGIN ALTER TABLE appointments DROP COLUMN IF EXISTS deleted_at; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE appointments DROP COLUMN IF EXISTS external_id; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE appointments DROP COLUMN IF EXISTS is_external; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE appointments DROP COLUMN IF EXISTS color; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE appointments DROP COLUMN IF EXISTS user_id; EXCEPTION WHEN others THEN NULL; END $$;

-- Drop related indexes if they exist
DO $$ BEGIN DROP INDEX IF EXISTS idx_appointments_tenant_user; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN DROP INDEX IF EXISTS idx_appointments_not_deleted; EXCEPTION WHEN others THEN NULL; END $$;

-- Drop integration tables if they exist
DROP TABLE IF EXISTS calendar_integrations CASCADE;
DROP TABLE IF EXISTS calendar_audit_logs CASCADE;

