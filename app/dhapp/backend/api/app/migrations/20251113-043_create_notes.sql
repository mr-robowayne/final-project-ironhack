-- 20251113-043_create_notes.sql
-- Multi-tenant Notes module: notes + note_attachments

-- Ensure helper exists
DO $$
BEGIN
  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.proname = 'set_timestamp_updated_at'
     AND n.nspname = 'public';
  IF NOT FOUND THEN
    CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END; $fn$ LANGUAGE plpgsql;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS notes (
  id               SERIAL PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  owner_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visibility_type  TEXT NOT NULL CHECK (visibility_type IN ('PERSONAL','PRACTICE','PATIENT')),
  patient_id       INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  title            TEXT,
  content          TEXT, -- stores HTML/Markdown per project standard
  tags             TEXT[],
  color            TEXT, -- optional simple color token (e.g. YELLOW, BLUE, GREEN, RED, PURPLE)
  pinned           BOOLEAN NOT NULL DEFAULT false,
  locked           BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_notes_tenant ON notes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notes_tenant_visibility ON notes (tenant_id, visibility_type);
CREATE INDEX IF NOT EXISTS idx_notes_tenant_owner ON notes (tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_notes_tenant_patient ON notes (tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_notes_tenant_updated ON notes (tenant_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_tags_gin ON notes USING GIN (tags);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_notes_set_updated_at ON notes;
CREATE TRIGGER trg_notes_set_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();

-- Attachments for notes
CREATE TABLE IF NOT EXISTS note_attachments (
  id                  SERIAL PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  note_id             INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  file_path           TEXT NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_attachments_tenant_note
  ON note_attachments (tenant_id, note_id, created_at DESC);

