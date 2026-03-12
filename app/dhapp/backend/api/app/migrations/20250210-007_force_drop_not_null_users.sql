-- Forcefully drop NOT NULL constraints on users columns required by legacy migrations
ALTER TABLE IF EXISTS users ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE IF EXISTS users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE IF EXISTS users ALTER COLUMN role DROP NOT NULL;

