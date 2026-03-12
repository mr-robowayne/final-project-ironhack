#!/bin/bash
# =============================================================
# inspect-db.sh — DB-Inhalte anzeigen
#
# Verwendung:
#   ./inspect-db.sh                    — vollständige Übersicht
#   ./inspect-db.sh tenants            — nur Tenants
#   ./inspect-db.sh users              — alle User aller Tenants
#   ./inspect-db.sh users <key>        — User eines Tenants
#   ./inspect-db.sh patients           — Patienten aller Tenants
#   ./inspect-db.sh patients <key>     — Patienten eines Tenants
#   ./inspect-db.sh flyway             — Migrations-Historie
#   ./inspect-db.sh schema <key>       — Tabellen & Spalten eines Tenants
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

MODE="${1:-all}"
FILTER="${2:-}"

header "Patientsync — DB Inspektion"

tunnel_open

# -------------------------------------------------------
show_tenants() {
  echo -e "\n${BLUE}▶ TENANTS${NC}"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << 'SQL'
SELECT
  tenant_key                                  AS "Key",
  name                                        AS "Name",
  schema_name                                 AS "Schema",
  plan                                        AS "Plan",
  status                                      AS "Status",
  country                                     AS "Land",
  to_char(created_at,'YYYY-MM-DD HH24:MI')   AS "Erstellt am"
FROM public.tenant_registry
WHERE deleted_at IS NULL
ORDER BY created_at;
SQL
}

show_users() {
  echo -e "\n${BLUE}▶ BENUTZER${NC}"
  local where="WHERE deleted_at IS NULL"
  [ -n "$1" ] && where="$where AND tenant_key = '$1'"

  local tenants
  tenants=$(psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT tenant_key||'|'||schema_name FROM public.tenant_registry $where ORDER BY created_at")

  [ -z "$tenants" ] && { warn "Keine Tenants gefunden."; return; }

  while IFS='|' read -r tkey tschema; do
    [ -z "$tkey" ] && continue
    echo -e "\n  ${YELLOW}Tenant: $tkey  (schema: $tschema)${NC}"
    psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  u.email                                           AS "E-Mail",
  r.name                                            AS "Rolle",
  coalesce(u.first_name,'')||' '||coalesce(u.last_name,'') AS "Name",
  CASE WHEN u.is_active THEN 'aktiv' ELSE 'inaktiv' END    AS "Status",
  to_char(u.created_at,'YYYY-MM-DD HH24:MI')        AS "Erstellt am",
  u.user_id                                          AS "User-ID"
FROM ${tschema}.users u
LEFT JOIN ${tschema}.roles r ON r.role_id = u.role_id
WHERE u.deleted_at IS NULL
ORDER BY r.name, u.email;
SQL
  done <<< "$tenants"
}

show_patients() {
  echo -e "\n${BLUE}▶ PATIENTEN${NC}"
  local where="WHERE deleted_at IS NULL"
  [ -n "$1" ] && where="$where AND tenant_key = '$1'"

  local tenants
  tenants=$(psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT tenant_key||'|'||schema_name FROM public.tenant_registry $where ORDER BY created_at")

  [ -z "$tenants" ] && { warn "Keine Tenants gefunden."; return; }

  while IFS='|' read -r tkey tschema; do
    [ -z "$tkey" ] && continue
    echo -e "\n  ${YELLOW}Tenant: $tkey  (schema: $tschema)${NC}"
    psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  coalesce(first_name,'')||' '||coalesce(last_name,'')  AS "Name",
  birth_date                                              AS "Geb. Datum",
  email                                                   AS "E-Mail",
  ahv_number                                              AS "AHV-Nr",
  CASE WHEN document_prefix IS NOT NULL THEN 'ja' ELSE 'nein' END AS "S3",
  to_char(created_at,'YYYY-MM-DD')                        AS "Erstellt",
  patient_id                                              AS "Patient-ID"
FROM ${tschema}.patients
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
SQL
    psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
      -c "SELECT '  → '||count(*)||' Patient(en) total' FROM ${tschema}.patients WHERE deleted_at IS NULL;"
  done <<< "$tenants"
}

show_flyway() {
  echo -e "\n${BLUE}▶ FLYWAY MIGRATIONS-HISTORIE${NC}"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << 'SQL'
SELECT
  version                                           AS "Version",
  description                                       AS "Beschreibung",
  state                                             AS "Status",
  execution_time                                    AS "ms",
  to_char(installed_on,'YYYY-MM-DD HH24:MI:SS')    AS "Ausgeführt am"
FROM public.flyway_schema_history
ORDER BY installed_rank;
SQL
}

show_schema() {
  [ -z "$1" ] && { error "Verwendung: ./inspect-db.sh schema <tenant_key>"; exit 1; }
  local tschema
  tschema=$(psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT schema_name FROM public.tenant_registry WHERE tenant_key='$1' AND deleted_at IS NULL")
  [ -z "$tschema" ] && { error "Tenant '$1' nicht gefunden."; exit 1; }

  echo -e "\n${BLUE}▶ SCHEMA: $tschema (Tenant: $1)${NC}"
  echo -e "\n  ${YELLOW}Tabellen & ca. Zeilenzahlen:${NC}"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off \
    -c "SELECT relname AS \"Tabelle\", n_live_tup AS \"Zeilen (ca.)\" FROM pg_stat_user_tables WHERE schemaname='${tschema}' ORDER BY relname;"

  echo -e "\n  ${YELLOW}Spalten:${NC}"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT table_name AS "Tabelle", column_name AS "Spalte", data_type AS "Typ", is_nullable AS "Nullable"
FROM information_schema.columns
WHERE table_schema = '${tschema}'
ORDER BY table_name, ordinal_position;
SQL
}

# -------------------------------------------------------
case "$MODE" in
  tenants)            show_tenants ;;
  users)              show_users "$FILTER" ;;
  patients)           show_patients "$FILTER" ;;
  flyway)             show_flyway ;;
  schema)             show_schema "$FILTER" ;;
  all)
    show_tenants
    show_users ""
    show_patients ""
    show_flyway
    ;;
  *)
    error "Unbekannter Modus: $MODE"
    echo ""
    echo "Verwendung:"
    echo "  ./inspect-db.sh                  — alles"
    echo "  ./inspect-db.sh tenants          — Tenants"
    echo "  ./inspect-db.sh users            — alle User"
    echo "  ./inspect-db.sh users <key>      — User eines Tenants"
    echo "  ./inspect-db.sh patients         — Patienten"
    echo "  ./inspect-db.sh patients <key>   — Patienten eines Tenants"
    echo "  ./inspect-db.sh flyway           — Migrations-Historie"
    echo "  ./inspect-db.sh schema <key>     — Tabellen & Spalten"
    exit 1
    ;;
esac

echo ""
success "Fertig."
