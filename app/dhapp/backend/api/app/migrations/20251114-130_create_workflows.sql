-- 20251114-130_create_workflows.sql

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id           SERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('NEW_PATIENT','NEW_LAB_RESULT','DISCHARGE','MANUAL')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  definition_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_defs_tenant ON workflow_definitions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workflow_defs_trigger ON workflow_definitions (tenant_id, trigger_type) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id              SERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  trigger_context JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant ON workflow_runs (tenant_id, workflow_definition_id);

