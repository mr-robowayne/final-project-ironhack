-- Shared-DB tenant registry + persisted JWT session tokens

CREATE TABLE IF NOT EXISTS tenant_registry (
  tenant_id TEXT PRIMARY KEY,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  storage_root TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_lookup
  ON user_sessions (tenant_id, user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions (tenant_id, session_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token_hash
  ON user_sessions (token_hash);

CREATE OR REPLACE FUNCTION public.set_updated_at_user_sessions()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_sessions_set_updated_at ON user_sessions;
CREATE TRIGGER trg_user_sessions_set_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_user_sessions();
