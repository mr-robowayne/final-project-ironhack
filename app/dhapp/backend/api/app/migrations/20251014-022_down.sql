-- 20251014-022_down.sql
BEGIN;

-- drop view
DROP VIEW IF EXISTS public.v_calendars_accessible;

-- drop triggers
DROP TRIGGER IF EXISTS trg_users_autocal           ON public.users;
DROP TRIGGER IF EXISTS trg_tenant_settings_autocal ON public.tenant_settings;

-- drop functions (helpers + trigger fns)
DROP FUNCTION IF EXISTS public.resolve_target_calendar_id(text,int,text);
DROP FUNCTION IF EXISTS public.trgfn_users_autocal();
DROP FUNCTION IF EXISTS public.trgfn_tenant_settings_autocal();
DROP FUNCTION IF EXISTS public.ensure_user_calendar(text,int);
DROP FUNCTION IF EXISTS public.ensure_tenant_default_calendar(text);

COMMIT;

