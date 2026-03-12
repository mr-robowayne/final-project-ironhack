DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tenant_registry
     WHERE status = 'active'
       AND deleted_at IS NULL
  ) THEN
    PERFORM public.provision_all_active_tenants();
  END IF;
END
$$;
