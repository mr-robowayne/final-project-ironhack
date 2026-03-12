-- Compatibility migration: ensure legacy column "rolle" exists on users
-- This must run before 20250211-001_create_tenant_settings.sql which
-- references users.rolle during seed/update.

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS rolle TEXT;

