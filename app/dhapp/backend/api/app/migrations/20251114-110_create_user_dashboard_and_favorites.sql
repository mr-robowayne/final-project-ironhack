-- 20251114-110_create_user_dashboard_and_favorites.sql

CREATE TABLE IF NOT EXISTS user_dashboard_config (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  TEXT NOT NULL,
  widgets    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id         SERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('PATIENT','NOTE','TASK','SOP','VIEW')),
  target_id  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (tenant_id, user_id, type);

