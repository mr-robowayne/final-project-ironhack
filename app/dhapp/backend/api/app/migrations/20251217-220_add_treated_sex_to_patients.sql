ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS treated_sex TEXT;

COMMENT ON COLUMN patients.treated_sex IS 'Behandeltes Geschlecht für die Abrechnung (GeneralInvoice 5.0: sexType = male|female), erforderlich bei gender=diverse.';

