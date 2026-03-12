CREATE OR REPLACE FUNCTION public.create_tenant(
  p_tenant_key TEXT,
  p_name TEXT,
  p_plan TEXT DEFAULT 'basic',
  p_country TEXT DEFAULT 'CH',
  p_data_residency TEXT DEFAULT 'eu-central-2',
  p_schema_name TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_key TEXT := lower(trim(COALESCE(p_tenant_key, '')));
  v_plan TEXT := lower(trim(COALESCE(p_plan, 'basic')));
  v_country TEXT := upper(trim(COALESCE(p_country, 'CH')));
  v_schema TEXT;
  v_tenant_id TEXT;
BEGIN
  IF v_tenant_key = '' OR v_tenant_key !~ '^[a-z0-9][a-z0-9_-]{1,62}$' THEN
    RAISE EXCEPTION 'Invalid tenant_key: %', p_tenant_key;
  END IF;

  IF trim(COALESCE(p_name, '')) = '' THEN
    RAISE EXCEPTION 'Tenant name must not be empty';
  END IF;

  IF v_plan NOT IN ('basic', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_plan;
  END IF;

  IF v_country NOT IN ('CH', 'DE', 'AT') THEN
    RAISE EXCEPTION 'Invalid country: %', p_country;
  END IF;

  v_schema := lower(trim(COALESCE(p_schema_name, '')));
  IF v_schema = '' THEN
    v_schema := 'tenant_' || regexp_replace(v_tenant_key, '[^a-z0-9]+', '_', 'g');
  END IF;

  IF v_schema !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid schema name: %', v_schema;
  END IF;

  v_tenant_id := v_tenant_key;

  INSERT INTO public.tenant_registry (
    tenant_id,
    tenant_key,
    schema_name,
    display_name,
    name,
    plan,
    status,
    country,
    data_residency
  )
  VALUES (
    v_tenant_id,
    v_tenant_key,
    v_schema,
    trim(p_name),
    trim(p_name),
    v_plan,
    'active',
    v_country,
    p_data_residency
  );

  PERFORM public.provision_tenant_schema(v_tenant_id, v_schema);

  RETURN v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_all_active_tenants()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT tenant_id, schema_name
      FROM public.tenant_registry
     WHERE status = 'active'
       AND deleted_at IS NULL
  LOOP
    PERFORM public.provision_tenant_schema(rec.tenant_id, rec.schema_name);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
