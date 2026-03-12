-- 20251014-022_calendar_autoprovision.sql
BEGIN;

-- 0) Safety: require prior tables
DO $$
BEGIN
  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='calendars';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table public.calendars not found. Run 020 first.';
  END IF;
  PERFORM 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='calendar_members';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table public.calendar_members not found. Run 020 first.';
  END IF;
END$$;

-- 1) Helper: ensure tenant default calendar
CREATE OR REPLACE FUNCTION public.ensure_tenant_default_calendar(p_tenant_id text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  -- existing default?
  SELECT id INTO v_id
  FROM public.calendars
  WHERE tenant_id = p_tenant_id AND type='tenant' AND is_default
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.calendars (tenant_id, name, type, is_default, metadata)
    VALUES (p_tenant_id, 'Praxis-Kalender', 'tenant', true, '{}'::jsonb)
    RETURNING id INTO v_id;

    -- seed memberships for all existing users in tenant
    INSERT INTO public.calendar_members (calendar_id, user_id, role)
    SELECT v_id, u.id,
           CASE WHEN u.role IN ('admin','doctor') THEN 'editor' ELSE 'viewer' END
    FROM public.users u
    WHERE u.tenant_id = p_tenant_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_id;
END
$$;

-- 2) Auto-provision on new tenant_settings
DROP TRIGGER IF EXISTS trg_tenant_settings_autocal ON public.tenant_settings;
CREATE OR REPLACE FUNCTION public.trgfn_tenant_settings_autocal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.ensure_tenant_default_calendar(NEW.tenant_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_tenant_settings_autocal
AFTER INSERT ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.trgfn_tenant_settings_autocal();

-- 3) Helper: ensure user calendar (+owner membership) and seed admin viewer
CREATE OR REPLACE FUNCTION public.ensure_user_calendar(p_tenant_id text, p_user_id int)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  SELECT c.id INTO v_id
  FROM public.calendars c
  WHERE c.type='user' AND c.owner_user_id = p_user_id AND c.tenant_id = p_tenant_id
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.calendars(tenant_id, name, type, owner_user_id, is_default, metadata)
    SELECT u.tenant_id,
           COALESCE(NULLIF(trim(u.name),''), u.email, 'Benutzer-Kalender'),
           'user', u.id, false, jsonb_build_object('role', u.role)
    FROM public.users u
    WHERE u.id = p_user_id AND u.tenant_id = p_tenant_id
    RETURNING id INTO v_id;

    -- owner membership
    INSERT INTO public.calendar_members(calendar_id, user_id, role)
    VALUES (v_id, p_user_id, 'owner')
    ON CONFLICT DO NOTHING;

    -- admins as viewer
    INSERT INTO public.calendar_members(calendar_id, user_id, role)
    SELECT v_id, u2.id, 'viewer'
    FROM public.users u2
    WHERE u2.tenant_id = p_tenant_id AND u2.role = 'admin'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_id;
END
$$;

-- 4) Auto-provision on new users
DROP TRIGGER IF EXISTS trg_users_autocal ON public.users;
CREATE OR REPLACE FUNCTION public.trgfn_users_autocal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- make sure tenant has a default calendar
  PERFORM public.ensure_tenant_default_calendar(NEW.tenant_id);
  -- and the user gets their personal calendar
  PERFORM public.ensure_user_calendar(NEW.tenant_id, NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_users_autocal
AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.trgfn_users_autocal();

-- 5) Helper to resolve target calendar for legacy API (by tenant/user/source)
-- Returns preferred calendar_id given (tenant, maybe user, maybe 'user'/'general')
CREATE OR REPLACE FUNCTION public.resolve_target_calendar_id(p_tenant_id text, p_user_id int, p_source text)
RETURNS bigint
STABLE
LANGUAGE sql
AS $$
  -- prefer user calendar when explicit 'user' and user present,
  -- else fall back to tenant default
  WITH cand AS (
    SELECT id
    FROM public.calendars
    WHERE tenant_id = p_tenant_id
      AND (
        (p_source = 'user' AND p_user_id IS NOT NULL AND type='user'
         AND owner_user_id = p_user_id)
        OR
        (COALESCE(p_source,'general') <> 'user' AND type='tenant' AND is_default)
      )
    ORDER BY is_default DESC
    LIMIT 1
  )
  SELECT id FROM cand
$$;

-- 6) Convenience view for API reads
DROP VIEW IF EXISTS public.v_calendars_accessible;
CREATE VIEW public.v_calendars_accessible AS
SELECT c.id, c.tenant_id, c.name, c.type, c.owner_user_id, c.is_default, c.created_at, c.updated_at
FROM public.calendars c
WHERE
  c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
  AND (
    c.type = 'tenant'
    OR EXISTS (
      SELECT 1 FROM public.calendar_members m
      WHERE m.calendar_id = c.id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
    )
  );

COMMIT;

-- How to use the helpers
-- Legacy create-appointment (no calendar_id sent):
-- INSERT INTO public.appointments
--   (tenant_id, patient_id, doctor_id, starts_at, duration_minutes, reason, status, calendar_id, user_id, source)
-- VALUES
--   ($1, $2, $3, $4, $5, $6, COALESCE($7,'scheduled'),
--    public.resolve_target_calendar_id($1, $9, $10),
--    $9, COALESCE($10,'general'))
-- RETURNING id, calendar_id;

-- Ensure calendars exist for an already-seeded tenant/users (one-off):
-- SELECT public.ensure_tenant_default_calendar('test');
-- -- create for every user in 'test'
-- SELECT public.ensure_user_calendar('test', id) FROM public.users WHERE tenant_id='test';

