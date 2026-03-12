-- 20251114-140_chat_dm_members_and_type.sql
-- Extend chat channel type to include DM and add members table

DO $$ BEGIN
  ALTER TABLE chat_channels
    DROP CONSTRAINT IF EXISTS chat_channels_type_check;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

ALTER TABLE chat_channels
  ADD CONSTRAINT chat_channels_type_check
  CHECK (type IN ('GLOBAL','THEMA','PATIENT','TASK','DM'));

CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id  INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_channel_members (tenant_id, user_id);

