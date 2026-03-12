-- Compatibility for legacy inserts into view "patienten":
-- 1) Ensure patients.tenant_id exists with a per-database default
-- 2) Provide an INSTEAD OF INSERT trigger on view patienten to map
--    legacy columns and auto-fill tenant_id

DO $$
DECLARE
  v_has_patients BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='patients'
  ) INTO v_has_patients;

  IF NOT v_has_patients THEN
    -- Create minimal patients table if missing (legacy compatibility)
    CREATE TABLE patients (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT,
      vorname TEXT,
      nachname TEXT,
      geburtsdatum DATE,
      geschlecht TEXT,
      adresse TEXT,
      hausnummer TEXT,
      plz TEXT,
      ort TEXT,
      telefonnummer TEXT,
      email TEXT,
      ahv_nummer TEXT,
      versichertennummer TEXT,
      krankenkasse TEXT,
      krankenkasse_adresse TEXT,
      krankengeschichte TEXT,
      medikationsplan TEXT,
      allergien TEXT,
      impfstatus TEXT,
      vorgesetzter TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;

  -- Ensure tenant_id column present and default per database
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE patients ALTER COLUMN tenant_id DROP NOT NULL;
  ALTER TABLE patients ALTER COLUMN tenant_id SET DEFAULT regexp_replace(current_database(), '^(patienten_|db_)', '');
  UPDATE patients
     SET tenant_id = COALESCE(tenant_id, regexp_replace(current_database(), '^(patienten_|db_)', ''))
   WHERE tenant_id IS NULL;

  -- Ensure legacy columns exist for compatibility with legacy view/trigger
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS ahv_nummer TEXT;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS medikationsplan TEXT;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergien TEXT;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS impfstatus TEXT;
  ALTER TABLE patients ADD COLUMN IF NOT EXISTS vorgesetzter TEXT;

  -- Ensure legacy view exists
  EXECUTE 'DROP VIEW IF EXISTS patienten CASCADE';
  EXECUTE '
    CREATE VIEW patienten AS
    SELECT id, vorname, nachname, geburtsdatum, geschlecht,
           adresse, hausnummer, plz, ort,
           telefonnummer, email, ahv_nummer, versichertennummer,
           krankenkasse, krankenkasse_adresse, krankengeschichte,
           medikationsplan, allergien, impfstatus, vorgesetzter, created_at
      FROM patients';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.compat_patienten_ins()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
BEGIN
  INSERT INTO patients (
    tenant_id, vorname, nachname, geburtsdatum, geschlecht,
    adresse, hausnummer, plz, ort, telefonnummer, email,
    ahv_nummer, versichertennummer, krankenkasse, krankenkasse_adresse,
    krankengeschichte, medikationsplan, allergien, impfstatus, vorgesetzter
  ) VALUES (
    COALESCE(NEW.tenant_id, v_tenant_id),
    NEW.vorname, NEW.nachname, NEW.geburtsdatum, NEW.geschlecht,
    NEW.adresse, NEW.hausnummer, NEW.plz, NEW.ort, NEW.telefonnummer, NEW.email,
    NEW.ahv_nummer, NEW.versichertennummer, NEW.krankenkasse, NEW.krankenkasse_adresse,
    NEW.krankengeschichte, NEW.medikationsplan, NEW.allergien, NEW.impfstatus, NEW.vorgesetzter
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compat_patienten_ins ON patienten;
CREATE TRIGGER trg_compat_patienten_ins
  INSTEAD OF INSERT ON patienten
  FOR EACH ROW
  EXECUTE FUNCTION public.compat_patienten_ins();
