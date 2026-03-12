-- Compatibility migration: relax NOT NULL for users.role to support legacy inserts
ALTER TABLE IF EXISTS users
  ALTER COLUMN role DROP NOT NULL;

