-- Compatibility migration: relax NOT NULL for users.name so legacy inserts can succeed
ALTER TABLE IF EXISTS users
  ALTER COLUMN name DROP NOT NULL;

