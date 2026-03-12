-- 20251113-042_create_tasks.sql
-- Multi-tenant task/ticket system: tasks, task_comments, task_attachments

CREATE TABLE IF NOT EXISTS tasks (
  id                   SERIAL PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','DONE','ARCHIVED')),
  priority             TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  type                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date             TIMESTAMPTZ,
  read_at_assignee     TIMESTAMPTZ,
  patient_id           INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  related_appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  tags                 TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee ON tasks (tenant_id, assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_creator ON tasks (tenant_id, created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_patient ON tasks (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_due ON tasks (tenant_id, due_date);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON tasks;
CREATE TRIGGER trg_tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

-- Comments on tasks
CREATE TABLE IF NOT EXISTS task_comments (
  id               SERIAL PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment_text     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_tenant_task
  ON task_comments (tenant_id, task_id, created_at DESC);

-- Attachments: path to stored file (integrates with existing uploads/patient-files)
CREATE TABLE IF NOT EXISTS task_attachments (
  id                 SERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  task_id            INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path          TEXT NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_tenant_task
  ON task_attachments (tenant_id, task_id, uploaded_at DESC);

