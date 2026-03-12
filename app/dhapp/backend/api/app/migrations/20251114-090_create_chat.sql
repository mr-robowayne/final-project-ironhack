-- 20251114-090_create_chat.sql
-- Lightweight internal chat with @mentions and unread tracking

CREATE TABLE IF NOT EXISTS chat_channels (
  id          SERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'GLOBAL' CHECK (type IN ('GLOBAL','THEMA','PATIENT','TASK')),
  related_patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  related_task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_channels_tenant ON chat_channels (tenant_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           SERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  channel_id   INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant_channel ON chat_messages (tenant_id, channel_id, created_at);

CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id   INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  read_at      TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_user_unread ON chat_message_reads (tenant_id, user_id) WHERE read_at IS NULL;

