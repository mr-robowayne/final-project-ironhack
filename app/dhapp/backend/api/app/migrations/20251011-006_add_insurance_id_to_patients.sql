ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_id INTEGER;
ALTER TABLE patients
  ADD CONSTRAINT fk_patients_insurance
  FOREIGN KEY (insurance_id) REFERENCES insurances(id)
  ON DELETE SET NULL;

