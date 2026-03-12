-- Compatibility: provide legacy view "patienten" for migrations that still reference it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'patients'
  ) THEN
    RAISE NOTICE 'Table patients not found; creating minimal table for compatibility.';
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;

  -- Recreate view patienten mapping to patients
  EXECUTE 'DROP VIEW IF EXISTS patienten CASCADE';
  EXECUTE 'CREATE VIEW patienten AS SELECT * FROM patients';
END;
$$ LANGUAGE plpgsql;

