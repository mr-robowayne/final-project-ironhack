#!/bin/bash
# =============================================================
# init-db.sh — Patientsync DB initialisation (Flyway migrations)
#
# Usage:
#   ./init-db.sh                     — run Flyway migrations V1–V5 only
#   ./init-db.sh --seed              — migrations + seed (tenant + admin user)
#   ./init-db.sh --baseline          — baseline existing DB at V5 then migrate
#   ./init-db.sh --clean             — clean-up first (interactive confirm), then migrate
#   ./init-db.sh --clean --seed      — clean + migrate + seed
#   ./init-db.sh --psql              — skip Flyway, apply SQL files directly via psql
#   ./init-db.sh --local             — use local postgres (127.0.0.1:5432, no SSM tunnel)
#
# Flags can be combined. Order does not matter.
#
# Environment overrides:
#   LOCAL_PORT        — local tunnel port (default 5433)
#   DB_NAME           — database name (default patientsync)
#   FLYWAY_PASSWORD   — skip interactive Flyway password prompt
#   LOCAL_DB_USER     — local postgres user  (default: patientsync_admin)
#   LOCAL_DB_PASS     — local postgres password
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

# -------------------------------------------------------
# Parse flags
# -------------------------------------------------------
RUN_SEED=false
RUN_CLEAN=false
RUN_BASELINE=false
USE_PSQL_DIRECT=false
USE_LOCAL=false

for arg in "$@"; do
  case "$arg" in
    --seed)     RUN_SEED=true ;;
    --clean)    RUN_CLEAN=true ;;
    --baseline) RUN_BASELINE=true ;;
    --psql)     USE_PSQL_DIRECT=true ;;
    --local)    USE_LOCAL=true ;;
    *)          warn "Unknown flag: $arg" ;;
  esac
done

# -------------------------------------------------------
# Dependency check — relax when not using Docker Flyway
# -------------------------------------------------------
if [ "$USE_PSQL_DIRECT" = true ]; then
  # psql-direct mode: only need psql (no docker, no aws)
  for tool in psql; do
    command -v "$tool" &>/dev/null || { error "Missing tool: $tool"; exit 1; }
  done
elif [ "$USE_LOCAL" = true ]; then
  # Local mode: need psql + docker (no aws/ssm)
  for tool in psql docker; do
    command -v "$tool" &>/dev/null || { error "Missing tool: $tool"; exit 1; }
  done
else
  # Remote mode: full dependency check (psql + docker + aws + ssm-plugin)
  check_deps
fi

header "Patientsync — DB Initialisation"

# -------------------------------------------------------
# Connection setup: local or remote (SSM tunnel)
# -------------------------------------------------------
if [ "$USE_LOCAL" = true ]; then
  LOCAL_PORT="${LOCAL_PORT:-5432}"
  DB_ADMIN_USER="${LOCAL_DB_USER:-patientsync_admin}"
  export PGPASSWORD="${LOCAL_DB_PASS:-}"
  DB_CONN_STRING="postgresql://${DB_ADMIN_USER}@127.0.0.1:${LOCAL_PORT}/${DB_NAME}"
  export DB_CONN_STRING
  info "Using local postgres at 127.0.0.1:${LOCAL_PORT}"
else
  tunnel_open
fi

# -------------------------------------------------------
# Verify DB connectivity
# -------------------------------------------------------
info "Verifying database connectivity..."
if ! psql "${DB_CONN_STRING}" --no-psqlrc -c "SELECT 1" &>/dev/null; then
  error "Cannot connect to database. Check credentials and connectivity."
  exit 1
fi
success "Database connection OK."

# -------------------------------------------------------
# Clean-up (optional, with confirmation)
# -------------------------------------------------------
if [ "$RUN_CLEAN" = true ]; then
  header "Clean-up — resetting DB"
  echo ""
  warn "WARNING: This will delete ALL data in the database!"
  warn "         The existing filipe@admin user will be LOST."
  echo ""
  read -rp "Proceed? All data will be deleted! [yes/N]: " CONFIRM
  CONFIRM_LOWER=$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]')
  if [ "$CONFIRM_LOWER" != "yes" ] && [ "$CONFIRM_LOWER" != "ja" ]; then
    info "Aborted."
    exit 0
  fi

  info "Running clean-up script..."
  bash "$SCRIPT_DIR/clean-up.sh" --force
  success "Clean-up complete."
fi

# -------------------------------------------------------
# Flyway user creation (idempotent)
# -------------------------------------------------------
header "Configuring Flyway DB user"
echo ""

if [ -n "${FLYWAY_PASSWORD:-}" ]; then
  FLYWAY_PASS="$FLYWAY_PASSWORD"
  info "Using FLYWAY_PASSWORD from environment."
else
  info "Set password for DB user 'patientsync_flyway':"
  read -rsp "Flyway password: " FLYWAY_PASS
  echo ""
fi

[ -z "$FLYWAY_PASS" ] && { error "Password must not be empty."; exit 1; }

# Escape single quotes for SQL
FLYWAY_PASS_ESCAPED="${FLYWAY_PASS//\'/\'\'}"

cat > /tmp/ps_flyway_user.sql << SQLEOF
DO \$body\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'patientsync_flyway') THEN
    CREATE USER patientsync_flyway WITH PASSWORD '${FLYWAY_PASS_ESCAPED}';
    RAISE NOTICE 'Flyway user created.';
  ELSE
    ALTER USER patientsync_flyway WITH PASSWORD '${FLYWAY_PASS_ESCAPED}';
    RAISE NOTICE 'Flyway user password updated.';
  END IF;
END\$body\$;

GRANT CONNECT ON DATABASE ${DB_NAME} TO patientsync_flyway;
GRANT USAGE, CREATE ON SCHEMA public TO patientsync_flyway;
GRANT ALL ON ALL TABLES IN SCHEMA public TO patientsync_flyway;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO patientsync_flyway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO patientsync_flyway;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO patientsync_flyway;
SQLEOF

psql "${DB_CONN_STRING}" --no-psqlrc -f /tmp/ps_flyway_user.sql
rm -f /tmp/ps_flyway_user.sql
success "Flyway user configured."

# -------------------------------------------------------
# Determine SSL mode for JDBC
# -------------------------------------------------------
if [ "$USE_LOCAL" = true ]; then
  JDBC_SSL_PARAMS=""
else
  JDBC_SSL_PARAMS="?ssl=true&sslmode=require"
fi

# -------------------------------------------------------
# Apply migrations — via Docker Flyway or direct psql
# -------------------------------------------------------
if [ "$USE_PSQL_DIRECT" = true ]; then
  # =====================================================
  # Direct psql migration (no Docker needed)
  # =====================================================
  header "Applying migrations V1–V5 via psql (direct)"

  # Check if flyway_schema_history exists — if so, skip already-applied
  HAS_FLYWAY_TABLE=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flyway_schema_history')")

  # Sort migration files by version number
  MIGRATION_FILES=$(ls -1 "${DB_SQL_DIR}"/V*.sql 2>/dev/null | sort -t'V' -k2 -n)

  if [ -z "$MIGRATION_FILES" ]; then
    error "No migration files found in ${DB_SQL_DIR}"
    exit 1
  fi

  for sql_file in $MIGRATION_FILES; do
    filename=$(basename "$sql_file")
    # Extract version number (e.g. V1 -> 1, V5 -> 5)
    version=$(echo "$filename" | sed 's/^V\([0-9]*\)__.*/\1/')
    description=$(echo "$filename" | sed 's/^V[0-9]*__//;s/\.sql$//' | tr '_' ' ')

    # Check if this version was already applied
    if [ "$HAS_FLYWAY_TABLE" = "t" ]; then
      already_applied=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
        "SELECT EXISTS (SELECT 1 FROM flyway_schema_history WHERE installed_rank > 0 AND version = '${version}' AND success = true)")
      if [ "$already_applied" = "t" ]; then
        info "V${version} already applied — skipping: ${description}"
        continue
      fi
    fi

    info "Applying V${version}: ${description} ..."
    if psql "${DB_CONN_STRING}" --no-psqlrc -v ON_ERROR_STOP=1 -f "$sql_file"; then
      success "V${version} applied successfully."

      # Record in flyway_schema_history for tracking (create table if needed)
      psql "${DB_CONN_STRING}" --no-psqlrc -v ON_ERROR_STOP=1 << FHSQL
CREATE TABLE IF NOT EXISTS public.flyway_schema_history (
  installed_rank INTEGER NOT NULL PRIMARY KEY,
  version        VARCHAR(50),
  description    VARCHAR(200) NOT NULL,
  type           VARCHAR(20) NOT NULL,
  script         VARCHAR(1000) NOT NULL,
  checksum       INTEGER,
  installed_by   VARCHAR(100) NOT NULL,
  installed_on   TIMESTAMP NOT NULL DEFAULT now(),
  execution_time INTEGER NOT NULL,
  success        BOOLEAN NOT NULL
);

INSERT INTO public.flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
SELECT
  COALESCE((SELECT MAX(installed_rank) FROM public.flyway_schema_history), 0) + 1,
  '${version}',
  '${description}',
  'SQL',
  '${filename}',
  0,
  current_user,
  0,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.flyway_schema_history WHERE version = '${version}' AND success = true
);
FHSQL
    else
      error "V${version} FAILED. Stopping."
      exit 1
    fi
  done

  success "All migrations applied via psql."

elif [ "$RUN_BASELINE" = true ]; then
  # =====================================================
  # Flyway baseline + migrate (for existing databases)
  # =====================================================
  header "Flyway baseline + migrate (V1–V5)"

  # Write flyway.conf
  cat > "${FLYWAY_CONF_TMP}" << CFGEOF
flyway.url=jdbc:postgresql://host.docker.internal:${LOCAL_PORT}/${DB_NAME}${JDBC_SSL_PARAMS}
flyway.user=patientsync_flyway
flyway.password=${FLYWAY_PASS}
flyway.locations=filesystem:/flyway/sql
flyway.schemas=public
flyway.defaultSchema=public
flyway.table=flyway_schema_history
flyway.connectRetries=10
flyway.validateMigrationNaming=true
flyway.cleanDisabled=true
flyway.baselineOnMigrate=true
flyway.baselineVersion=5
flyway.baselineDescription=Baseline after manual setup
CFGEOF

  info "Running Flyway baseline..."
  FLYWAY_CONTAINER="patientsync-flyway-$$"
  docker create --name "${FLYWAY_CONTAINER}" --network host flyway/flyway:10 baseline
  docker cp "${DB_SQL_DIR}/." "${FLYWAY_CONTAINER}:/flyway/sql/"
  docker cp "${FLYWAY_CONF_TMP}" "${FLYWAY_CONTAINER}:/flyway/conf/flyway.conf"
  docker start -a "${FLYWAY_CONTAINER}"
  docker rm "${FLYWAY_CONTAINER}" 2>/dev/null

  info "Running Flyway migrate..."
  FLYWAY_CONTAINER="patientsync-flyway-migrate-$$"
  docker create --name "${FLYWAY_CONTAINER}" --network host flyway/flyway:10 migrate
  docker cp "${DB_SQL_DIR}/." "${FLYWAY_CONTAINER}:/flyway/sql/"
  docker cp "${FLYWAY_CONF_TMP}" "${FLYWAY_CONTAINER}:/flyway/conf/flyway.conf"
  docker start -a "${FLYWAY_CONTAINER}"
  docker rm "${FLYWAY_CONTAINER}" 2>/dev/null

  rm -f "${FLYWAY_CONF_TMP}"
  success "Flyway baseline + migrate complete."

else
  # =====================================================
  # Standard Flyway migrate (Docker)
  # =====================================================
  header "Flyway migrations (V1–V5)"

  # Write flyway.conf
  cat > "${FLYWAY_CONF_TMP}" << CFGEOF
flyway.url=jdbc:postgresql://host.docker.internal:${LOCAL_PORT}/${DB_NAME}${JDBC_SSL_PARAMS}
flyway.user=patientsync_flyway
flyway.password=${FLYWAY_PASS}
flyway.locations=filesystem:/flyway/sql
flyway.schemas=public
flyway.defaultSchema=public
flyway.table=flyway_schema_history
flyway.connectRetries=10
flyway.validateMigrationNaming=true
flyway.cleanDisabled=true
flyway.baselineOnMigrate=true
CFGEOF

  FLYWAY_CONTAINER="patientsync-flyway-$$"

  info "Creating Flyway container..."
  docker create --name "${FLYWAY_CONTAINER}" --network host flyway/flyway:10 migrate
  docker cp "${DB_SQL_DIR}/." "${FLYWAY_CONTAINER}:/flyway/sql/"
  docker cp "${FLYWAY_CONF_TMP}" "${FLYWAY_CONTAINER}:/flyway/conf/flyway.conf"

  info "Running Flyway migrate..."
  docker start -a "${FLYWAY_CONTAINER}"
  docker rm "${FLYWAY_CONTAINER}" 2>/dev/null

  rm -f "${FLYWAY_CONF_TMP}"
  success "Flyway migrations complete."
fi

# -------------------------------------------------------
# Seed (optional — idempotent, preserves existing users)
# -------------------------------------------------------
if [ "$RUN_SEED" = true ]; then
  header "Seed — Tenant 'dhpatientsync' + Admin User"
  echo ""

  # Check if admin user already exists to inform the operator
  EXISTING_USER=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
    "SELECT EXISTS (
       SELECT 1 FROM information_schema.schemata WHERE schema_name = 'dhpatientsync'
     )" 2>/dev/null || echo "f")

  if [ "$EXISTING_USER" = "t" ]; then
    ADMIN_EXISTS=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
      "SELECT EXISTS (
         SELECT 1 FROM dhpatientsync.users WHERE lower(email) LIKE '%admin%' AND deleted_at IS NULL
       )" 2>/dev/null || echo "f")
    if [ "$ADMIN_EXISTS" = "t" ]; then
      info "Admin user already exists in dhpatientsync schema. Seed is idempotent — existing users will NOT be overwritten."
    fi
  fi

  read -rp "Admin email:      " ADMIN_EMAIL
  read -rp "Admin first name: " ADMIN_FNAME
  read -rp "Admin last name:  " ADMIN_LNAME
  read -rsp "Admin password:   " ADMIN_PASS
  echo ""

  [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASS" ] && { error "Email and password are required."; exit 1; }

  # Escape single quotes in session variables
  ADMIN_EMAIL_ESC="${ADMIN_EMAIL//\'/\'\'}"
  ADMIN_FNAME_ESC="${ADMIN_FNAME//\'/\'\'}"
  ADMIN_LNAME_ESC="${ADMIN_LNAME//\'/\'\'}"
  ADMIN_PASS_ESC="${ADMIN_PASS//\'/\'\'}"

  psql "${DB_CONN_STRING}" \
    --no-psqlrc \
    -c "SET app.admin_email = '${ADMIN_EMAIL_ESC}';" \
    -c "SET app.admin_fname = '${ADMIN_FNAME_ESC}';" \
    -c "SET app.admin_lname = '${ADMIN_LNAME_ESC}';" \
    -c "SET app.admin_pass  = '${ADMIN_PASS_ESC}';" \
    -f "${DB_SEED_DIR}/seed-initial-data.sql"

  echo ""
  success "Seed complete."
  warn "IMPORTANT: Change the admin password after first login!"
fi

# -------------------------------------------------------
# Summary
# -------------------------------------------------------
echo ""
header "Summary"
info "Checking migration state..."

MIGRATION_COUNT=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
  "SELECT count(*) FROM flyway_schema_history WHERE success = true AND type != 'BASELINE'" 2>/dev/null || echo "?")
TENANT_COUNT=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
  "SELECT count(*) FROM tenant_registry WHERE deleted_at IS NULL" 2>/dev/null || echo "?")

info "Migrations applied: ${MIGRATION_COUNT}"
info "Active tenants:     ${TENANT_COUNT}"

# Check for existing admin user
if psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
  "SELECT email FROM dhpatientsync.users WHERE deleted_at IS NULL LIMIT 5" 2>/dev/null | grep -q '@'; then
  USERS=$(psql "${DB_CONN_STRING}" --no-psqlrc -tAc \
    "SELECT email FROM dhpatientsync.users WHERE deleted_at IS NULL" 2>/dev/null)
  info "Active users:       ${USERS}"
fi

echo ""
success "DB initialisation complete."
