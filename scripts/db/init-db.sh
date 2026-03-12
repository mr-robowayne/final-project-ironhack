#!/bin/bash
# =============================================================
# init-db.sh — Initiale DB-Struktur aufsetzen
#
# Verwendung:
#   ./init-db.sh              — nur Flyway Migrationen (V1–V4)
#   ./init-db.sh --seed       — Migrationen + Seed (Tenant + Admin-User)
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps

RUN_SEED=false
[ "${1:-}" = "--seed" ] && RUN_SEED=true

header "Patientsync — DB Initialisierung"

tunnel_open

# -------------------------------------------------------
# Flyway-User erstellen
# -------------------------------------------------------
header "Flyway DB-User konfigurieren"
echo ""
info "Passwort für den DB-User 'patientsync_flyway' festlegen:"
read -rsp "Flyway-Passwort: " FLYWAY_PASS
echo ""
[ -z "$FLYWAY_PASS" ] && { error "Passwort darf nicht leer sein."; exit 1; }

python3 - << PYEOF
import os, subprocess, pathlib, sys

pw = """${FLYWAY_PASS}""".replace("'", "''")
sql = f"""
DO \$body\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'patientsync_flyway') THEN
    CREATE USER patientsync_flyway WITH PASSWORD '{pw}';
    RAISE NOTICE 'Flyway-User erstellt.';
  ELSE
    ALTER USER patientsync_flyway WITH PASSWORD '{pw}';
    RAISE NOTICE 'Flyway-User Passwort aktualisiert.';
  END IF;
END\$body\$;
GRANT CONNECT ON DATABASE patientsync TO patientsync_flyway;
GRANT USAGE, CREATE ON SCHEMA public TO patientsync_flyway;
GRANT ALL ON ALL TABLES IN SCHEMA public TO patientsync_flyway;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO patientsync_flyway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO patientsync_flyway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO patientsync_flyway;
"""
f = pathlib.Path('/tmp/ps_flyway_user.sql')
f.write_text(sql)
r = subprocess.run(['psql', '${DB_CONN_STRING}', '--no-psqlrc', '-f', str(f)], capture_output=True, text=True)
f.unlink(missing_ok=True)
print(r.stdout)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr); sys.exit(r.returncode)
PYEOF

success "Flyway-User konfiguriert."

# -------------------------------------------------------
# Flyway Config schreiben
# -------------------------------------------------------
python3 - << PYEOF
import pathlib
cfg = (
    "flyway.url=jdbc:postgresql://host.docker.internal:${LOCAL_PORT}/${DB_NAME}?ssl=true&sslmode=require\n"
    "flyway.user=patientsync_flyway\n"
    "flyway.password=${FLYWAY_PASS}\n"
    "flyway.locations=filesystem:/flyway/sql\n"
    "flyway.schemas=public\n"
    "flyway.defaultSchema=public\n"
    "flyway.table=flyway_schema_history\n"
    "flyway.connectRetries=10\n"
    "flyway.validateMigrationNaming=true\n"
    "flyway.cleanDisabled=true\n"
    "flyway.baselineOnMigrate=true\n"
)
pathlib.Path("${FLYWAY_CONF_TMP}").write_text(cfg)
PYEOF

# -------------------------------------------------------
# Flyway Migrationen
# -------------------------------------------------------
header "Flyway Migrationen (V1–V4)"

FLYWAY_CONTAINER="patientsync-flyway-$$"
docker create --name "${FLYWAY_CONTAINER}" --network host flyway/flyway:10 migrate
docker cp "${DB_SQL_DIR}/." "${FLYWAY_CONTAINER}:/flyway/sql/"
docker cp "${FLYWAY_CONF_TMP}" "${FLYWAY_CONTAINER}:/flyway/conf/flyway.conf"
docker start -a "${FLYWAY_CONTAINER}"
docker rm "${FLYWAY_CONTAINER}" 2>/dev/null

rm -f "${FLYWAY_CONF_TMP}"
success "Flyway Migrationen abgeschlossen."

# -------------------------------------------------------
# Seed (optional)
# -------------------------------------------------------
if [ "$RUN_SEED" = true ]; then
  header "Seed — Tenant 'dhpatientsync' + Admin-User"
  echo ""
  read -rp "Admin E-Mail:    " ADMIN_EMAIL
  read -rp "Admin Vorname:   " ADMIN_FNAME
  read -rp "Admin Nachname:  " ADMIN_LNAME
  read -rsp "Admin Passwort:  " ADMIN_PASS
  echo ""

  [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASS" ] && { error "E-Mail und Passwort sind Pflicht."; exit 1; }

  psql "${DB_CONN_STRING}" \
    --no-psqlrc \
    -c "SET app.admin_email = '${ADMIN_EMAIL}';" \
    -c "SET app.admin_fname = '${ADMIN_FNAME}';" \
    -c "SET app.admin_lname = '${ADMIN_LNAME}';" \
    -c "SET app.admin_pass = '${ADMIN_PASS}';" \
    -f "${DB_SEED_DIR}/seed-initial-data.sql"

  echo ""
  success "Seed abgeschlossen."
  warn "WICHTIG: Admin-Passwort nach dem ersten Login ändern!"
fi

echo ""
success "DB Initialisierung erfolgreich abgeschlossen."
