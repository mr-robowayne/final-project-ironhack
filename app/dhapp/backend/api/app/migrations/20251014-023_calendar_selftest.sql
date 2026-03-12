-- 20251014-023_calendar_selftest.sql
BEGIN;

-- View: violations if any (should be empty)
DROP VIEW IF EXISTS public.v_calendar_integrity_violations;
CREATE VIEW public.v_calendar_integrity_violations AS
WITH
default_per_tenant AS (
  SELECT tenant_id, COUNT(*) AS cnt
  FROM public.calendars
  WHERE type='tenant' AND is_default
  GROUP BY tenant_id
  HAVING COUNT(*) <> 1
),
user_cal_counts AS (
  SELECT u.id AS user_id, u.tenant_id, COUNT(c.*) AS cal_cnt
  FROM public.users u
  LEFT JOIN public.calendars c
    ON c.type='user' AND c.owner_user_id=u.id AND c.tenant_id=u.tenant_id
  GROUP BY u.id, u.tenant_id
  HAVING COUNT(c.*) <> 1
),
appt_missing_calendar AS (
  SELECT id AS appointment_id, tenant_id
  FROM public.appointments
  WHERE calendar_id IS NULL
),
tenant_mismatch AS (
  SELECT a.id AS appointment_id, a.tenant_id AS appt_tenant, c.tenant_id AS cal_tenant
  FROM public.appointments a
  JOIN public.calendars c ON c.id=a.calendar_id
  WHERE a.tenant_id IS DISTINCT FROM c.tenant_id
)
SELECT 'default_per_tenant' AS check_name, row_to_json(t) AS payload FROM default_per_tenant t
UNION ALL
SELECT 'user_cal_counts', row_to_json(t) FROM user_cal_counts t
UNION ALL
SELECT 'appt_missing_calendar', row_to_json(t) FROM appt_missing_calendar t
UNION ALL
SELECT 'tenant_mismatch', row_to_json(t) FROM tenant_mismatch t;

-- Quick helpers to view accessible calendars/appointments for current GUCs
DROP VIEW IF EXISTS public.v_my_calendars;
CREATE VIEW public.v_my_calendars AS
SELECT id, name, type, owner_user_id, is_default
FROM public.calendars
WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
  AND (
       type='tenant'
    OR EXISTS (
         SELECT 1 FROM public.calendar_members m
         WHERE m.calendar_id=calendars.id
           AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
    )
  );

DROP VIEW IF EXISTS public.v_my_appointments;
CREATE VIEW public.v_my_appointments AS
SELECT a.*
FROM public.appointments a
WHERE a.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
  AND EXISTS (
        SELECT 1 FROM public.calendar_members m
        WHERE m.calendar_id = a.calendar_id
          AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::int
  );

COMMIT;

