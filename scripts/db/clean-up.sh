#!/bin/bash
# =============================================================
# clean-up.sh — Patientsync DB auf Flyway-Ausgangszustand zurücksetzen
#
# Löscht:
#   - Alle tenant_* Schemas (vom Backend auto-erstellt)
#   - Alle Tabellen im public-Schema
#   - Alle User-defined Functions im public-Schema
#   - Das Backend-eigene Migrations-Tracking (schema_migrations)
#
# Danach ist die DB sauber für:
#   ./init-db.sh --seed  (Flyway V1-V4 + Tenant + Admin-User)
#
# Verwendung:
#   ./clean-up.sh          — interaktiv (fragt nach Bestätigung)
#   ./clean-up.sh --force  — kein Prompt (für CI)
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

FORCE=false
[ "${1:-}" = "--force" ] && FORCE=true

header "Patientsync — DB Clean-up (Flyway-Reset)"
echo ""
warn "ACHTUNG: Dieses Script löscht ALLE Daten in der Datenbank!"
warn "         Schemas: alle tenant_* Schemas"
warn "         Tabellen: ALLE Tabellen im public-Schema"
warn "         Funktionen: ALLE user-defined Functions im public-Schema"
echo ""

if [ "$FORCE" = false ]; then
  read -rp "Wirklich fortfahren? Alle Daten werden gelöscht! [ja/N]: " CONFIRM
  CONFIRM_LOWER=$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]')
  [ "$CONFIRM_LOWER" = "ja" ] || { info "Abgebrochen."; exit 0; }
fi

tunnel_open

info "Starte DB Clean-up..."

python3 - << 'PYEOF'
import os, subprocess, pathlib, sys

sql = r"""
\set ON_ERROR_STOP on

-- -------------------------------------------------------
-- 1. Alle tenant_* Schemas löschen (CASCADE)
-- -------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT schema_name
      FROM information_schema.schemata
     WHERE schema_name LIKE 'tenant_%'
  LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.schema_name);
    RAISE NOTICE '[1] Schema gelöscht: %', r.schema_name;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[1] % Schemas gelöscht.', v_count;
END$$;

-- -------------------------------------------------------
-- 2. Alle Tabellen im public-Schema löschen (CASCADE)
-- -------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    RAISE NOTICE '[2] Tabelle gelöscht: public.%', r.tablename;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[2] % Tabellen gelöscht.', v_count;
END$$;

-- -------------------------------------------------------
-- 3. Alle user-defined Functions + Procedures im public-Schema löschen
-- -------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func_sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
  LOOP
    BEGIN
      EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.func_sig);
      RAISE NOTICE '[3] Funktion gelöscht: %', r.func_sig;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[3] Konnte nicht löschen: % — %', r.func_sig, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '[3] % Funktionen gelöscht.', v_count;
END$$;

-- -------------------------------------------------------
-- 4. Alle Sequences im public-Schema löschen
-- -------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT sequence_name
      FROM information_schema.sequences
     WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequence_name);
    RAISE NOTICE '[4] Sequence gelöscht: public.%', r.sequence_name;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[4] % Sequences gelöscht.', v_count;
END$$;

-- -------------------------------------------------------
-- 5. Alle Views im public-Schema löschen
-- -------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT viewname
      FROM pg_views
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
    RAISE NOTICE '[5] View gelöscht: public.%', r.viewname;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[5] % Views gelöscht.', v_count;
END$$;

SELECT 'Clean-up abgeschlossen.' AS status;
"""

f = pathlib.Path('/tmp/ps_cleanup.sql')
f.write_text(sql)
r = subprocess.run(
    ['psql', os.environ['DB_CONN_STRING'], '--no-psqlrc', '-f', str(f)],
    capture_output=True, text=True
)
f.unlink(missing_ok=True)
print(r.stdout)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr)
    sys.exit(r.returncode)
PYEOF

echo ""
success "DB Clean-up erfolgreich abgeschlossen."
echo ""
info "Nächster Schritt:"
echo "  ./scripts/db/init-db.sh --seed"
echo ""
warn "Danach: CI/CD Pipeline triggern um das Backend neu zu deployen."
