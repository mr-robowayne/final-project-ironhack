-- Migration: create invoices table for tenant-scoped invoice metadata
CREATE TABLE IF NOT EXISTS invoices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patienten(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft',
  storage_path TEXT,
  tenant_storage_path TEXT,
  filesize BIGINT,
  pdf_checksum TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pdf_generated_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  total_amount NUMERIC(12,2),
  currency TEXT,
  CONSTRAINT invoices_pk PRIMARY KEY (tenant_id, id),
  CONSTRAINT invoices_pdf_checksum_chk CHECK (pdf_checksum IS NULL OR length(pdf_checksum) = 64)
);

CREATE INDEX IF NOT EXISTS idx_invoices_patient
  ON invoices (tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_created_at
  ON invoices (tenant_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_invoices_set_updated_at
      BEFORE UPDATE ON invoices
      FOR EACH ROW
      EXECUTE FUNCTION public.set_timestamp_updated_at();
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_seed_demo BOOLEAN := lower(coalesce(current_setting('app.seed_demo_data', true), 'on')) IN ('1','on','true','yes');
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
  v_admin_username TEXT;
  v_doctor_username TEXT;
  v_settings tenant_settings%ROWTYPE;
  v_contact_email TEXT;
  v_contact_phone TEXT;
  v_payment_terms TEXT;
  v_provider_org TEXT;
  v_provider_department TEXT;
  v_provider_street TEXT;
  v_provider_house TEXT;
  v_provider_zip TEXT;
  v_provider_city TEXT;
  v_provider_country TEXT;
  v_provider_iban TEXT;
  v_payment_type TEXT;
  v_payment_ref TEXT;
  v_patient_primary INTEGER;
  v_patient_secondary INTEGER;
  v_invoice_id_primary TEXT;
  v_invoice_id_secondary TEXT;
  v_payload JSONB;
BEGIN
  IF NOT v_seed_demo THEN
    RAISE NOTICE 'Skipping demo invoice seed because app.seed_demo_data is disabled.';
    RETURN;
  END IF;

  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := 'test';
  END IF;

  v_admin_username := v_tenant_id || '.admin';
  v_doctor_username := v_tenant_id || '.arzt';

  SELECT *
    INTO v_settings
    FROM tenant_settings
   WHERE tenant_id = v_tenant_id
   LIMIT 1;

  IF FOUND THEN
    v_contact_email := coalesce(v_settings.metadata ->> 'contact_email', v_tenant_id || '@example.local');
    v_contact_phone := coalesce(v_settings.metadata ->> 'contact_phone', '+41 44 000 00 00');
    v_payment_terms := coalesce(v_settings.additional_text, 'Zahlbar innert 30 Tagen netto.');
    v_provider_org := coalesce(v_settings.creditor_name, 'Demo Klinik');
    v_provider_department := coalesce(v_settings.creditor_additional, '');
    v_provider_street := coalesce(v_settings.address_lines[1], 'Hauptstrasse');
    v_provider_house := coalesce(v_settings.address_lines[2], '1');
    v_provider_zip := coalesce(v_settings.zip, '8000');
    v_provider_city := coalesce(v_settings.city, 'Zürich');
    v_provider_country := coalesce(v_settings.country, 'CH');
    v_provider_iban := coalesce(v_settings.iban, 'CH0000000000000000000');
    v_payment_type := upper(coalesce(v_settings.payment_reference_type, 'NON'));
    v_payment_ref := coalesce(v_settings.payment_reference, '');
  ELSE
    v_contact_email := v_tenant_id || '@example.local';
    v_contact_phone := '+41 44 000 00 00';
    v_payment_terms := 'Zahlbar innert 30 Tagen netto.';
    v_provider_org := initcap(v_tenant_id) || ' Clinic';
    v_provider_department := 'Demo Mandant';
    v_provider_street := 'Hauptstrasse';
    v_provider_house := '1';
    v_provider_zip := '8000';
    v_provider_city := 'Zürich';
    v_provider_country := 'CH';
    v_provider_iban := 'CH0000000000000000000';
    v_payment_type := 'NON';
    v_payment_ref := '';
  END IF;

  SELECT id INTO v_patient_primary
    FROM patienten
   WHERE versichertennummer = '7562000000001'
   LIMIT 1;

  SELECT id INTO v_patient_secondary
    FROM patienten
   WHERE versichertennummer = '7562000000002'
   LIMIT 1;

  v_invoice_id_primary := v_tenant_id || '-INV-2025-0001';
  v_invoice_id_secondary := v_tenant_id || '-INV-2025-0002';

  IF v_patient_primary IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoices WHERE tenant_id = v_tenant_id AND id = v_invoice_id_primary
  ) THEN
    v_payload := jsonb_build_object(
      'invoice', jsonb_build_object(
        'id', v_invoice_id_primary,
        'status', 'draft',
        'currency', 'CHF',
        'billing_mode', 'TP',
        'payment_terms', v_payment_terms,
        'payment_ref', jsonb_build_object(
          'type', v_payment_type,
          'value', CASE WHEN v_payment_type = 'NON' THEN '' ELSE v_payment_ref END
        )
      ),
      'patient', jsonb_build_object(
        'id', v_patient_primary,
        'name', jsonb_build_object(
          'family', 'Muster',
          'given', jsonb_build_array('Anna')
        ),
        'birthDate', '1987-03-15',
        'gender', 'female'
      ),
      'provider', jsonb_build_object(
        'organization', v_provider_org,
        'department', v_provider_department,
        'iban', v_provider_iban,
        'address', jsonb_build_object(
          'street', v_provider_street,
          'houseNo', v_provider_house,
          'zip', v_provider_zip,
          'city', v_provider_city,
          'country', v_provider_country
        ),
        'contact', jsonb_build_object(
          'phone', v_contact_phone,
          'email', v_contact_email
        )
      ),
      'totals', jsonb_build_object(
        'total_chf', 150.00,
        'net_chf', 150.00
      ),
      'items', jsonb_build_array(
        jsonb_build_object(
          'code', '00.0010',
          'description', 'Allgemeine Untersuchung',
          'amount_chf', 120.00,
          'quantity', 1
        ),
        jsonb_build_object(
          'code', '00.0060',
          'description', 'Blutlabor',
          'amount_chf', 30.00,
          'quantity', 1
        )
      )
    );

    INSERT INTO invoices (
      tenant_id,
      id,
      patient_id,
      status,
      payload,
      created_by,
      total_amount,
      currency
    )
    VALUES (
      v_tenant_id,
      v_invoice_id_primary,
      v_patient_primary,
      'draft',
      v_payload,
      v_admin_username,
      150.00,
      'CHF'
    );
  END IF;

  IF v_patient_secondary IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoices WHERE tenant_id = v_tenant_id AND id = v_invoice_id_secondary
  ) THEN
    v_payload := jsonb_build_object(
      'invoice', jsonb_build_object(
        'id', v_invoice_id_secondary,
        'status', 'finalized',
        'currency', 'CHF',
        'billing_mode', 'TP',
        'payment_terms', v_payment_terms,
        'payment_ref', jsonb_build_object(
          'type', v_payment_type,
          'value', CASE WHEN v_payment_type = 'NON' THEN '' ELSE v_payment_ref END
        )
      ),
      'patient', jsonb_build_object(
        'id', v_patient_secondary,
        'name', jsonb_build_object(
          'family', 'Keller',
          'given', jsonb_build_array('Marco')
        ),
        'birthDate', '1979-09-02',
        'gender', 'male'
      ),
      'provider', jsonb_build_object(
        'organization', v_provider_org,
        'department', v_provider_department,
        'iban', v_provider_iban,
        'address', jsonb_build_object(
          'street', v_provider_street,
          'houseNo', v_provider_house,
          'zip', v_provider_zip,
          'city', v_provider_city,
          'country', v_provider_country
        ),
        'contact', jsonb_build_object(
          'phone', v_contact_phone,
          'email', v_contact_email
        )
      ),
      'totals', jsonb_build_object(
        'total_chf', 285.50,
        'net_chf', 285.50
      ),
      'items', jsonb_build_array(
        jsonb_build_object(
          'code', '00.0020',
          'description', 'Erstkonsultation',
          'amount_chf', 180.00,
          'quantity', 1
        ),
        jsonb_build_object(
          'code', '00.0120',
          'description', 'Laborkontrolle',
          'amount_chf', 105.50,
          'quantity', 1
        )
      )
    );

    INSERT INTO invoices (
      tenant_id,
      id,
      patient_id,
      status,
      payload,
      created_by,
      total_amount,
      currency,
      pdf_generated_at
    )
    VALUES (
      v_tenant_id,
      v_invoice_id_secondary,
      v_patient_secondary,
      'finalized',
      v_payload,
      v_doctor_username,
      285.50,
      'CHF',
      now()
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
