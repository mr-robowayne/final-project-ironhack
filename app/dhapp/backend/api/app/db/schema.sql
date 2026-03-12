-- Base flat schema for the patientsync app.
--
-- Applied exactly ONCE at first startup if public.users does not exist
-- (see applyBaseSchemaIfMissing() in lib/tenant.js).
--
-- Flyway V1-V4 run before the app starts (scripts/db/init-db.sh) and handle:
--   public.plans, public.tenant_registry, public.global_audit_log
--
-- This file only creates what Flyway does NOT create — the three flat domain
-- tables that the app migrations (000-270) expect to exist.
--
-- App migrations then evolve these tables incrementally via ALTER TABLE.
-- Migration 004 renames: patienten → patients, kalender → appointments.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Trigger function referenced by app migrations (004 and later).
-- Flyway V1 creates set_row_updated_at() separately; both do the same thing.
CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- public.users
-- Minimal flat schema. Migration 004 adds columns and constraints.
-- Migration 240 creates user_sessions with FK → users(id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id            SERIAL PRIMARY KEY,
  email         TEXT,
  password_hash TEXT,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- public.patienten
-- Minimal flat schema. Migration 004 renames this to patients and adds columns.
-- Migration 002 creates invoices with FK → patienten(id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patienten (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- public.kalender
-- Minimal flat schema. Migration 004 renames this to appointments and adds columns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kalender (
  id         SERIAL PRIMARY KEY,
  patient_id INTEGER REFERENCES public.patienten(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
