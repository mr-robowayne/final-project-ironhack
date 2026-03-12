-- Compatibility: fill users defaults on legacy inserts (before alignment)

CREATE OR REPLACE FUNCTION public.compat_users_fill_defaults()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id TEXT := regexp_replace(current_database(), '^(patienten_|db_)', '');
  v_role TEXT;
BEGIN
  IF v_tenant_id IS NULL OR trim(v_tenant_id) = '' THEN
    v_tenant_id := 'test';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant_id;
  END IF;

  IF NEW.name IS NULL THEN
    NEW.name := trim(both ' ' FROM concat_ws(' ', NEW.vorname, NEW.nachname));
  END IF;

  IF NEW.role IS NULL THEN
    v_role := CASE lower(coalesce(NEW.rolle, 'assistant'))
                WHEN 'admin' THEN 'admin'
                WHEN 'arzt' THEN 'doctor'
                WHEN 'doctor' THEN 'doctor'
                WHEN 'assistenz' THEN 'assistant'
                WHEN 'abrechnung' THEN 'billing'
                ELSE 'assistant'
              END;
    NEW.role := v_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compat_users_fill_defaults ON users;
CREATE TRIGGER trg_compat_users_fill_defaults
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION public.compat_users_fill_defaults();

