#!/bin/bash
# =============================================================
# inspect-db.sh — DB-Inhalte anzeigen (V5 Schema)
#
# Verwendung:
#   ./inspect-db.sh                    — vollständige Übersicht
#   ./inspect-db.sh tenants            — nur Tenants
#   ./inspect-db.sh users              — alle User aller Tenants
#   ./inspect-db.sh users <key>        — User eines Tenants
#   ./inspect-db.sh patients           — Patienten aller Tenants
#   ./inspect-db.sh patients <key>     — Patienten eines Tenants
#   ./inspect-db.sh appointments       — Termine aller Tenants
#   ./inspect-db.sh appointments <key> — Termine eines Tenants
#   ./inspect-db.sh rooms              — Räume aller Tenants
#   ./inspect-db.sh rooms <key>        — Räume eines Tenants
#   ./inspect-db.sh tasks              — Aufgaben aller Tenants
#   ./inspect-db.sh tasks <key>        — Aufgaben eines Tenants
#   ./inspect-db.sh invoices           — Rechnungen aller Tenants
#   ./inspect-db.sh invoices <key>     — Rechnungen eines Tenants
#   ./inspect-db.sh insurances         — Versicherungen aller Tenants
#   ./inspect-db.sh notes              — Notizen aller Tenants
#   ./inspect-db.sh letters            — Briefe aller Tenants
#   ./inspect-db.sh sicknotes          — Krankschreibungen aller Tenants
#   ./inspect-db.sh chat               — Chat-Kanäle aller Tenants
#   ./inspect-db.sh sops               — SOPs aller Tenants
#   ./inspect-db.sh workflows          — Workflows aller Tenants
#   ./inspect-db.sh audit              — Audit-Log aller Tenants
#   ./inspect-db.sh flyway             — Migrations-Historie
#   ./inspect-db.sh schema <key>       — Tabellen & Spalten eines Tenants
#   ./inspect-db.sh counts <key>       — Zeilenzahlen pro Tabelle
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
  CASE WHEN success THEN 'OK' ELSE 'FEHLER' END    AS "Status",
  execution_time || ' ms'                           AS "Dauer",
  to_char(installed_on,'YYYY-MM-DD HH24:MI:SS')    AS "Ausgeführt am",
  installed_by                                      AS "Von"
FROM public.flyway_schema_history
ORDER BY installed_rank;
SQL
}

# -- Helper: iterate tenants --
for_each_tenant() {
  local callback="$1"
  local filter="$2"
  local where="WHERE deleted_at IS NULL"
  [ -n "$filter" ] && where="$where AND tenant_key = '$filter'"

  local tenants
  tenants=$(psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT tenant_key||'|'||schema_name FROM public.tenant_registry $where ORDER BY created_at")
  [ -z "$tenants" ] && { warn "Keine Tenants gefunden."; return; }

  while IFS='|' read -r tkey tschema; do
    [ -z "$tkey" ] && continue
    echo -e "\n  ${YELLOW}Tenant: $tkey  (schema: $tschema)${NC}"
    $callback "$tkey" "$tschema"
  done <<< "$tenants"
}

# -- V5 views --

show_appointments() {
  echo -e "\n${BLUE}▶ TERMINE${NC}"
  for_each_tenant _show_appointments_tenant "$1"
}
_show_appointments_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  a.appointment_id                                          AS "ID",
  coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')  AS "Patient",
  a.title                                                   AS "Titel",
  to_char(a.start_at,'DD.MM.YYYY HH24:MI')                 AS "Von",
  to_char(a.end_at,'HH24:MI')                               AS "Bis",
  a.status                                                   AS "Status",
  c.name                                                     AS "Kalender"
FROM ${tschema}.appointments a
LEFT JOIN ${tschema}.patients p ON p.patient_id = a.patient_id
LEFT JOIN ${tschema}.calendars c ON c.calendar_id = a.calendar_id
WHERE a.deleted_at IS NULL
ORDER BY a.start_at DESC
LIMIT 30;
SQL
  psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT '  → '||count(*)||' Termin(e) total' FROM ${tschema}.appointments WHERE deleted_at IS NULL;"
}

show_rooms() {
  echo -e "\n${BLUE}▶ RÄUME${NC}"
  for_each_tenant _show_rooms_tenant "$1"
}
_show_rooms_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  room_id                                            AS "ID",
  name                                               AS "Name",
  type                                               AS "Typ",
  floor                                              AS "Stockwerk",
  CASE WHEN is_active THEN 'aktiv' ELSE 'inaktiv' END AS "Status",
  (SELECT count(*) FROM ${tschema}.room_bookings b WHERE b.room_id = r.room_id AND b.deleted_at IS NULL) AS "Buchungen"
FROM ${tschema}.rooms r
WHERE deleted_at IS NULL
ORDER BY name;
SQL
}

show_tasks() {
  echo -e "\n${BLUE}▶ AUFGABEN${NC}"
  for_each_tenant _show_tasks_tenant "$1"
}
_show_tasks_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  t.task_id                                                   AS "ID",
  left(t.title, 40)                                           AS "Titel",
  t.status                                                    AS "Status",
  t.priority                                                  AS "Prio",
  t.type                                                      AS "Typ",
  coalesce(u.display_name, u.email, '')                       AS "Zugewiesen an",
  to_char(t.due_date,'DD.MM.YYYY')                            AS "Fällig",
  to_char(t.created_at,'DD.MM.YYYY')                          AS "Erstellt"
FROM ${tschema}.tasks t
LEFT JOIN ${tschema}.users u ON u.user_id = t.assigned_to
WHERE t.deleted_at IS NULL
ORDER BY t.created_at DESC
LIMIT 30;
SQL
  psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT '  → '||count(*)||' Aufgabe(n) total ('||(SELECT count(*) FROM ${tschema}.tasks WHERE status='OPEN' AND deleted_at IS NULL)||' offen)' FROM ${tschema}.tasks WHERE deleted_at IS NULL;"
}

show_invoices() {
  echo -e "\n${BLUE}▶ RECHNUNGEN${NC}"
  for_each_tenant _show_invoices_tenant "$1"
}
_show_invoices_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  i.invoice_id                                                AS "ID",
  coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')    AS "Patient",
  i.amount                                                    AS "Betrag",
  i.currency                                                  AS "Währung",
  i.status                                                    AS "Status",
  to_char(i.due_date,'DD.MM.YYYY')                            AS "Fällig",
  to_char(i.created_at,'DD.MM.YYYY')                          AS "Erstellt"
FROM ${tschema}.invoices i
LEFT JOIN ${tschema}.patients p ON p.patient_id = i.patient_id
WHERE i.deleted_at IS NULL
ORDER BY i.created_at DESC
LIMIT 30;
SQL
  psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT '  → '||count(*)||' Rechnung(en) total' FROM ${tschema}.invoices WHERE deleted_at IS NULL;"
}

show_insurances() {
  echo -e "\n${BLUE}▶ VERSICHERUNGEN${NC}"
  for_each_tenant _show_insurances_tenant "$1"
}
_show_insurances_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  insurance_id                                        AS "ID",
  name                                                AS "Name",
  ean                                                 AS "EAN",
  city                                                AS "Ort",
  CASE WHEN is_active THEN 'aktiv' ELSE 'inaktiv' END AS "Status"
FROM ${tschema}.insurances
ORDER BY name;
SQL
}

show_notes() {
  echo -e "\n${BLUE}▶ NOTIZEN${NC}"
  for_each_tenant _show_notes_tenant "$1"
}
_show_notes_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  n.note_id                                                   AS "ID",
  left(n.title, 40)                                           AS "Titel",
  n.visibility                                                AS "Sichtbarkeit",
  coalesce(u.display_name, u.email, '')                       AS "Autor",
  to_char(n.created_at,'DD.MM.YYYY')                          AS "Erstellt"
FROM ${tschema}.notes n
LEFT JOIN ${tschema}.users u ON u.user_id = n.created_by
WHERE n.deleted_at IS NULL
ORDER BY n.created_at DESC
LIMIT 20;
SQL
  psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT '  → '||count(*)||' Notiz(en) total' FROM ${tschema}.notes WHERE deleted_at IS NULL;"
}

show_letters() {
  echo -e "\n${BLUE}▶ BRIEFE${NC}"
  for_each_tenant _show_letters_tenant "$1"
}
_show_letters_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  l.letter_id                                                  AS "ID",
  left(l.subject, 40)                                          AS "Betreff",
  l.letter_type                                                AS "Typ",
  coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')     AS "Patient",
  l.status                                                     AS "Status",
  to_char(l.created_at,'DD.MM.YYYY')                           AS "Erstellt"
FROM ${tschema}.letters l
LEFT JOIN ${tschema}.patients p ON p.patient_id = l.patient_id
WHERE l.deleted_at IS NULL
ORDER BY l.created_at DESC
LIMIT 20;
SQL
}

show_sicknotes() {
  echo -e "\n${BLUE}▶ KRANKSCHREIBUNGEN${NC}"
  for_each_tenant _show_sicknotes_tenant "$1"
}
_show_sicknotes_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  s.sick_note_id                                               AS "ID",
  coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')     AS "Patient",
  to_char(s.start_date,'DD.MM.YYYY')                           AS "Von",
  to_char(s.end_date,'DD.MM.YYYY')                             AS "Bis",
  s.incapacity_percent || '%'                                  AS "AU%",
  to_char(s.created_at,'DD.MM.YYYY')                           AS "Erstellt"
FROM ${tschema}.sick_notes s
LEFT JOIN ${tschema}.patients p ON p.patient_id = s.patient_id
WHERE s.deleted_at IS NULL
ORDER BY s.created_at DESC
LIMIT 20;
SQL
}

show_chat() {
  echo -e "\n${BLUE}▶ CHAT-KANÄLE${NC}"
  for_each_tenant _show_chat_tenant "$1"
}
_show_chat_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  ch.channel_id                                               AS "ID",
  ch.name                                                     AS "Kanal",
  ch.channel_type                                             AS "Typ",
  (SELECT count(*) FROM ${tschema}.chat_channel_members m WHERE m.channel_id = ch.channel_id) AS "Mitglieder",
  (SELECT count(*) FROM ${tschema}.chat_messages msg WHERE msg.channel_id = ch.channel_id)    AS "Nachrichten",
  to_char(ch.created_at,'DD.MM.YYYY')                         AS "Erstellt"
FROM ${tschema}.chat_channels ch
ORDER BY ch.created_at DESC
LIMIT 20;
SQL
}

show_sops() {
  echo -e "\n${BLUE}▶ SOPs${NC}"
  for_each_tenant _show_sops_tenant "$1"
}
_show_sops_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  sop_id                                              AS "ID",
  title                                               AS "Titel",
  version                                             AS "Version",
  CASE WHEN locked THEN 'gesperrt' ELSE 'bearbeitbar' END AS "Status",
  to_char(updated_at,'DD.MM.YYYY')                    AS "Aktualisiert"
FROM ${tschema}.sops
WHERE deleted_at IS NULL
ORDER BY title;
SQL
}

show_workflows() {
  echo -e "\n${BLUE}▶ WORKFLOWS${NC}"
  for_each_tenant _show_workflows_tenant "$1"
}
_show_workflows_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  wd.workflow_definition_id                           AS "ID",
  wd.name                                             AS "Name",
  wd.trigger_type                                     AS "Trigger",
  CASE WHEN wd.is_active THEN 'aktiv' ELSE 'inaktiv' END AS "Status",
  (SELECT count(*) FROM ${tschema}.workflow_runs wr WHERE wr.workflow_definition_id = wd.workflow_definition_id) AS "Runs",
  to_char(wd.updated_at,'DD.MM.YYYY')                 AS "Aktualisiert"
FROM ${tschema}.workflow_definitions wd
WHERE wd.deleted_at IS NULL
ORDER BY wd.name;
SQL
}

show_audit() {
  echo -e "\n${BLUE}▶ AUDIT-LOG (letzte 20)${NC}"
  for_each_tenant _show_audit_tenant "$1"
}
_show_audit_tenant() {
  local tschema="$2"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  a.action                                            AS "Aktion",
  a.resource                                          AS "Ressource",
  left(a.resource_id::text, 12)                       AS "Res-ID",
  coalesce(u.display_name, u.email, a.user_id::text)  AS "Benutzer",
  a.ip_address                                        AS "IP",
  to_char(a.created_at,'DD.MM.YYYY HH24:MI')          AS "Zeitpunkt"
FROM ${tschema}.audit_log a
LEFT JOIN ${tschema}.users u ON u.user_id = a.user_id
ORDER BY a.created_at DESC
LIMIT 20;
SQL
}

show_counts() {
  [ -z "$1" ] && { error "Verwendung: ./inspect-db.sh counts <tenant_key>"; exit 1; }
  local tschema
  tschema=$(psql "${DB_CONN_STRING}" --no-psqlrc -t -A \
    -c "SELECT schema_name FROM public.tenant_registry WHERE tenant_key='$1' AND deleted_at IS NULL")
  [ -z "$tschema" ] && { error "Tenant '$1' nicht gefunden."; exit 1; }

  echo -e "\n${BLUE}▶ ZEILENZAHLEN: $tschema (Tenant: $1)${NC}"
  psql "${DB_CONN_STRING}" --no-psqlrc -P pager=off << SQL
SELECT
  relname                           AS "Tabelle",
  n_live_tup                        AS "Zeilen (ca.)"
FROM pg_stat_user_tables
WHERE schemaname = '${tschema}'
ORDER BY n_live_tup DESC, relname;
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
  appointments|termine) show_appointments "$FILTER" ;;
  rooms|raeume)       show_rooms "$FILTER" ;;
  tasks|aufgaben)     show_tasks "$FILTER" ;;
  invoices|rechnungen) show_invoices "$FILTER" ;;
  insurances|versicherungen) show_insurances "$FILTER" ;;
  notes|notizen)      show_notes "$FILTER" ;;
  letters|briefe)     show_letters "$FILTER" ;;
  sicknotes|krankschreibungen) show_sicknotes "$FILTER" ;;
  chat)               show_chat "$FILTER" ;;
  sops)               show_sops "$FILTER" ;;
  workflows)          show_workflows "$FILTER" ;;
  audit)              show_audit "$FILTER" ;;
  flyway)             show_flyway ;;
  schema)             show_schema "$FILTER" ;;
  counts)             show_counts "$FILTER" ;;
  all)
    show_tenants
    show_users ""
    show_patients ""
    show_flyway
    ;;
  full)
    show_tenants
    show_users ""
    show_patients ""
    show_appointments ""
    show_rooms ""
    show_tasks ""
    show_invoices ""
    show_insurances ""
    show_notes ""
    show_letters ""
    show_sicknotes ""
    show_chat ""
    show_sops ""
    show_workflows ""
    show_audit ""
    show_flyway
    ;;
  *)
    error "Unbekannter Modus: $MODE"
    echo ""
    echo "Verwendung:"
    echo "  ./inspect-db.sh                  — Übersicht (Tenants, Users, Patients, Flyway)"
    echo "  ./inspect-db.sh full             — ALLES anzeigen"
    echo "  ./inspect-db.sh tenants          — Tenants"
    echo "  ./inspect-db.sh users [key]      — Benutzer"
    echo "  ./inspect-db.sh patients [key]   — Patienten"
    echo "  ./inspect-db.sh appointments [key] — Termine"
    echo "  ./inspect-db.sh rooms [key]      — Räume"
    echo "  ./inspect-db.sh tasks [key]      — Aufgaben"
    echo "  ./inspect-db.sh invoices [key]   — Rechnungen"
    echo "  ./inspect-db.sh insurances [key] — Versicherungen"
    echo "  ./inspect-db.sh notes [key]      — Notizen"
    echo "  ./inspect-db.sh letters [key]    — Briefe"
    echo "  ./inspect-db.sh sicknotes [key]  — Krankschreibungen"
    echo "  ./inspect-db.sh chat [key]       — Chat-Kanäle"
    echo "  ./inspect-db.sh sops [key]       — SOPs"
    echo "  ./inspect-db.sh workflows [key]  — Workflows"
    echo "  ./inspect-db.sh audit [key]      — Audit-Log"
    echo "  ./inspect-db.sh flyway           — Migrations-Historie"
    echo "  ./inspect-db.sh schema <key>     — Tabellen & Spalten"
    echo "  ./inspect-db.sh counts <key>     — Zeilenzahlen pro Tabelle"
    exit 1
    ;;
esac

echo ""
success "Fertig."
