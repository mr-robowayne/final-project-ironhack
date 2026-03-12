-- 20251114-081_tasks_add_sop_id.sql
-- Optional linkage from tasks to SOPs

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tasks' AND column_name='sop_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN sop_id INTEGER REFERENCES sops(id) ON DELETE SET NULL;
  END IF;
END $$;

