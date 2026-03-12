#!/bin/bash
# =============================================================
# create-user.sh — Benutzer in einem Tenant erstellen
#
# Verwendung:
#   ./create-user.sh                                               — interaktiv
#   ./create-user.sh <tenant_key> <rolle> <email> <fname> <lname> — direkt
#
# Beispiel:
#   ./create-user.sh dhpatientsync arzt dr.mueller@praxis.ch Hans Mueller
#
# Erlaubte Rollen: admin | arzt | mpa | billing
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

header "Patientsync — Neuen Benutzer erstellen"

if [ $# -ge 5 ]; then
  TENANT_KEY="$1"; USER_ROLE="$2"; USER_EMAIL="$3"; USER_FNAME="$4"; USER_LNAME="$5"
else
  echo ""
  read -rp "Tenant Key   (z.B. dhpatientsync):     " TENANT_KEY
  read -rp "Rolle        [admin/arzt/mpa/billing]:  " USER_ROLE
  read -rp "E-Mail:                                 " USER_EMAIL
  read -rp "Vorname:                                " USER_FNAME
  read -rp "Nachname:                               " USER_LNAME
fi

read -rsp "Passwort für ${USER_EMAIL}: " USER_PASS
echo ""

[ -z "$TENANT_KEY" ] || [ -z "$USER_EMAIL" ] || [ -z "$USER_PASS" ] && {
  error "tenant_key, email und passwort sind Pflicht."; exit 1
}

case "$USER_ROLE" in
  admin|arzt|mpa|billing) ;;
  *) error "Ungültige Rolle: $USER_ROLE (erlaubt: admin, arzt, mpa, billing)"; exit 1 ;;
esac

echo ""
info "Erstelle Benutzer:"
echo "  Tenant:  $TENANT_KEY"
echo "  Rolle:   $USER_ROLE"
echo "  E-Mail:  $USER_EMAIL"
echo "  Name:    $USER_FNAME $USER_LNAME"
echo ""
read -rp "Fortfahren? [j/N]: " C; [ "${C,,}" = "j" ] || { info "Abgebrochen."; exit 0; }

tunnel_open

python3 - << PYEOF
import os, subprocess, pathlib, sys

def e(s): return s.replace("'", "''")

sql = f"""
\\set ON_ERROR_STOP on
DO \$body\$
DECLARE
  v_schema   TEXT;
  v_tid      UUID;
  v_role_id  UUID;
  v_user_id  UUID;
BEGIN
  SELECT tenant_id, schema_name INTO v_tid, v_schema
    FROM public.tenant_registry
   WHERE tenant_key = '{e("${TENANT_KEY}")}' AND deleted_at IS NULL;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Tenant "${TENANT_KEY}" nicht gefunden.';
  END IF;

  EXECUTE format('SELECT role_id FROM %I.roles WHERE name = $1', v_schema)
    INTO v_role_id USING '{e("${USER_ROLE}")}';

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rolle "${USER_ROLE}" existiert nicht in Schema "%".', v_schema;
  END IF;

  EXECUTE format('SELECT user_id FROM %I.users WHERE lower(email)=lower($1) AND deleted_at IS NULL', v_schema)
    INTO v_user_id USING '{e("${USER_EMAIL}")}';

  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'E-Mail "${USER_EMAIL}" existiert bereits (id=%).', v_user_id;
  END IF;

  EXECUTE format(\$\$
    INSERT INTO %I.users (email, password_hash, role_id, first_name, last_name, is_active)
    VALUES (\$1, crypt(\$2, gen_salt('bf',10)), \$3, \$4, \$5, true)
    RETURNING user_id
  \$\$, v_schema)
  INTO v_user_id
  USING '{e("${USER_EMAIL}")}', '{e("${USER_PASS}")}', v_role_id, '{e("${USER_FNAME}")}', '{e("${USER_LNAME}")}';

  RAISE NOTICE 'Benutzer erstellt!';
  RAISE NOTICE '  user_id : %', v_user_id;
  RAISE NOTICE '  email   : ${USER_EMAIL}';
  RAISE NOTICE '  rolle   : ${USER_ROLE}';
  RAISE NOTICE '  tenant  : ${TENANT_KEY} (schema: %)', v_schema;
END\$body\$;
"""
f = pathlib.Path('/tmp/ps_create_user.sql')
f.write_text(sql)
r = subprocess.run(['psql', '${DB_CONN_STRING}', '--no-psqlrc', '-f', str(f)], capture_output=True, text=True)
f.unlink(missing_ok=True)
print(r.stdout)
if r.returncode != 0:
    print(r.stderr, file=sys.stderr); sys.exit(r.returncode)
PYEOF

success "Benutzer '${USER_EMAIL}' (${USER_ROLE}) in Tenant '${TENANT_KEY}' erstellt."
