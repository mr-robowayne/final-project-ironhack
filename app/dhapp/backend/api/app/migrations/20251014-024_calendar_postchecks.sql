-- 20251014-024_calendar_postchecks.sql
BEGIN;

DO $$
DECLARE v_cnt int;
BEGIN
  -- Sicherstellen, dass 023 da ist
  PERFORM 1
  FROM information_schema.views
  WHERE table_schema='public' AND table_name='v_calendar_integrity_violations';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing view public.v_calendar_integrity_violations (run 023 first)';
  END IF;

  SELECT COUNT(*) INTO v_cnt FROM public.v_calendar_integrity_violations;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'Calendar integrity violations detected: % (see public.v_calendar_integrity_violations)', v_cnt;
  END IF;
END$$;

COMMIT;

