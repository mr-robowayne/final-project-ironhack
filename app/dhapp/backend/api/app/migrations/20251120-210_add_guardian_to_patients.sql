ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS guardian_first_name TEXT,
  ADD COLUMN IF NOT EXISTS guardian_last_name TEXT,
  ADD COLUMN IF NOT EXISTS guardian_relationship TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS guardian_address JSONB,
  ADD COLUMN IF NOT EXISTS guardian_same_address BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guardian_adresse TEXT,
  ADD COLUMN IF NOT EXISTS guardian_hausnummer TEXT,
  ADD COLUMN IF NOT EXISTS guardian_plz TEXT,
  ADD COLUMN IF NOT EXISTS guardian_ort TEXT;

COMMENT ON COLUMN patients.guardian_first_name IS 'Vorname der verantwortlichen Person für minderjährige Patienten';
COMMENT ON COLUMN patients.guardian_last_name IS 'Nachname der verantwortlichen Person';
COMMENT ON COLUMN patients.guardian_relationship IS 'Beziehung zum Patienten (z.B. Mutter/Vater/Beistand)';
COMMENT ON COLUMN patients.guardian_phone IS 'Pflicht-Telefonnummer der verantwortlichen Person';
COMMENT ON COLUMN patients.guardian_email IS 'Optionale E-Mail der verantwortlichen Person';
COMMENT ON COLUMN patients.guardian_address IS 'Adresse der verantwortlichen Person als JSON';
COMMENT ON COLUMN patients.guardian_same_address IS 'Gibt an, ob die Guardian-Adresse identisch mit der Patientenadresse ist';
COMMENT ON COLUMN patients.guardian_adresse IS 'Strasse der verantwortlichen Person (Legacy-Kompatibilität)';
COMMENT ON COLUMN patients.guardian_hausnummer IS 'Hausnummer der verantwortlichen Person (Legacy-Kompatibilität)';
COMMENT ON COLUMN patients.guardian_plz IS 'PLZ der verantwortlichen Person (Legacy-Kompatibilität)';
COMMENT ON COLUMN patients.guardian_ort IS 'Ort der verantwortlichen Person (Legacy-Kompatibilität)';
