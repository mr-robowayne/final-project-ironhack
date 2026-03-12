#!/bin/bash
# =============================================================
# create-user.sh — Benutzer in einem Tenant erstellen (V5 Schema)
#
# Verwendung:
#   ./create-user.sh                                                          — interaktiv
#   ./create-user.sh <tenant_key> <rolle> <email> <vorname> <nachname>       — direkt
#   ./create-user.sh --force <tenant_key> <rolle> <email> <vorname> <nachname>  — update falls vorhanden
#
# Beispiel:
#   ./create-user.sh dhpatientsync arzt dr.mueller@praxis.ch Hans Mueller
#   ./create-user.sh --force dhpatientsync admin filipe@admin Filipe Admin
#
# Erlaubte Rollen: admin | arzt | mpa | billing
#
# V5 Schema:
#   - users table: user_id (UUID PK), email, password_hash, display_name,
#     first_name, last_name, role_id (FK to roles), is_active, created_at, updated_at
#   - Roles live in tenant schema: <schema>.roles
#   - Password hashing: bcrypt via pgcrypto gen_salt('bf', 10)
#
# Idempotent:
#   - Ohne --force: ueberspringt wenn E-Mail existiert
#   - Mit --force: aktualisiert Passwort, Rolle, Name falls E-Mail existiert
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

header "Patientsync — Neuen Benutzer erstellen"

# --- Parse --force flag ---
FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
  shift
fi

# --- Argumente oder interaktiv ---
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

# --- Passwort mit Bestaetigung ---
echo ""
read -rsp "Passwort fuer ${USER_EMAIL}: " USER_PASS
echo ""
read -rsp "Passwort bestaetigen:        " USER_PASS_CONFIRM
echo ""

if [ "$USER_PASS" != "$USER_PASS_CONFIRM" ]; then
  error "Passwoerter stimmen nicht ueberein."
  exit 1
fi

# --- Validierung ---
[ -z "$TENANT_KEY" ] && { error "Tenant Key ist Pflicht."; exit 1; }
[ -z "$USER_EMAIL" ] && { error "E-Mail ist Pflicht."; exit 1; }
[ -z "$USER_PASS" ] && { error "Passwort ist Pflicht."; exit 1; }
[ -z "$USER_FNAME" ] && { error "Vorname ist Pflicht."; exit 1; }
[ -z "$USER_LNAME" ] && { error "Nachname ist Pflicht."; exit 1; }

case "$USER_ROLE" in
  admin|arzt|mpa|billing) ;;
  *) error "Ungueltige Rolle: '$USER_ROLE' (erlaubt: admin, arzt, mpa, billing)"; exit 1 ;;
esac

# Build display_name from first + last
DISPLAY_NAME="${USER_FNAME} ${USER_LNAME}"

echo ""
info "Erstelle Benutzer:"
echo "  Tenant:       $TENANT_KEY"
echo "  Rolle:        $USER_ROLE"
echo "  E-Mail:       $USER_EMAIL"
echo "  Name:         $DISPLAY_NAME"
echo "  Vorname:      $USER_FNAME"
echo "  Nachname:     $USER_LNAME"
if [ $FORCE -eq 1 ]; then
  echo "  Modus:        --force (update falls vorhanden)"
fi
echo ""
read -rp "Fortfahren? [j/N]: " C; [ "${C,,}" = "j" ] || { info "Abgebrochen."; exit 0; }

tunnel_open

# --- Escape single quotes for SQL session variables ---
esc() { echo "$1" | sed "s/'/''/g"; }

psql "${DB_CONN_STRING}" --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "SET app.tenant_key = '$(esc "$TENANT_KEY")';" \
  -c "SET app.user_role = '$(esc "$USER_ROLE")';" \
  -c "SET app.user_email = '$(esc "$USER_EMAIL")';" \
  -c "SET app.user_pass = '$(esc "$USER_PASS")';" \
  -c "SET app.user_fname = '$(esc "$USER_FNAME")';" \
  -c "SET app.user_lname = '$(esc "$USER_LNAME")';" \
  -c "SET app.display_name = '$(esc "$DISPLAY_NAME")';" \
  -c "SET app.force_update = '${FORCE}';" \
  -c "
DO \$body\$
DECLARE
  v_schema       TEXT;
  v_tid          TEXT;
  v_role_id      UUID;
  v_user_id      UUID;
  v_force        BOOLEAN;

  v_tenant_key   TEXT := current_setting('app.tenant_key');
  v_role_name    TEXT := current_setting('app.user_role');
  v_email        TEXT := current_setting('app.user_email');
  v_password     TEXT := current_setting('app.user_pass');
  v_fname        TEXT := current_setting('app.user_fname');
  v_lname        TEXT := current_setting('app.user_lname');
  v_display      TEXT := current_setting('app.display_name');
BEGIN
  v_force := current_setting('app.force_update') = '1';

  -- Lookup tenant
  SELECT tenant_id, schema_name INTO v_tid, v_schema
    FROM public.tenant_registry
   WHERE tenant_key = v_tenant_key AND deleted_at IS NULL;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION 'Tenant \"%\" nicht gefunden.', v_tenant_key;
  END IF;

  -- Lookup role in tenant schema
  EXECUTE format('SELECT role_id FROM %I.roles WHERE name = \$1', v_schema)
    INTO v_role_id USING v_role_name;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rolle \"%\" existiert nicht in Schema \"%\".', v_role_name, v_schema;
  END IF;

  -- Check if user already exists
  EXECUTE format(
    'SELECT user_id FROM %I.users WHERE lower(email) = lower(\$1) AND deleted_at IS NULL',
    v_schema
  )
  INTO v_user_id USING v_email;

  IF v_user_id IS NOT NULL THEN
    IF v_force THEN
      -- Update existing user: password, role, name
      EXECUTE format(\$sql\$
        UPDATE %I.users
           SET password_hash = crypt(\$1, gen_salt('bf', 10)),
               role_id       = \$2,
               first_name    = \$3,
               last_name     = \$4,
               display_name  = \$5,
               updated_at    = now()
         WHERE user_id = \$6
         RETURNING user_id
      \$sql\$, v_schema)
      INTO v_user_id
      USING v_password, v_role_id, v_fname, v_lname, v_display, v_user_id;

      RAISE NOTICE '';
      RAISE NOTICE 'Benutzer aktualisiert (--force)!';
      RAISE NOTICE '  user_id      : %', v_user_id;
      RAISE NOTICE '  email        : %', v_email;
      RAISE NOTICE '  rolle        : %', v_role_name;
      RAISE NOTICE '  display_name : %', v_display;
      RAISE NOTICE '  tenant       : % (schema: %)', v_tenant_key, v_schema;
    ELSE
      RAISE NOTICE '';
      RAISE NOTICE 'Benutzer existiert bereits — uebersprungen.';
      RAISE NOTICE '  user_id : %', v_user_id;
      RAISE NOTICE '  email   : %', v_email;
      RAISE NOTICE '  tenant  : % (schema: %)', v_tenant_key, v_schema;
    END IF;
    RETURN;
  END IF;

  -- Insert new user with bcrypt-hashed password
  EXECUTE format(\$sql\$
    INSERT INTO %I.users (
      email, password_hash, role_id,
      first_name, last_name, display_name,
      is_active
    )
    VALUES (
      \$1,
      crypt(\$2, gen_salt('bf', 10)),
      \$3,
      \$4, \$5, \$6,
      true
    )
    RETURNING user_id
  \$sql\$, v_schema)
  INTO v_user_id
  USING v_email, v_password, v_role_id, v_fname, v_lname, v_display;

  RAISE NOTICE '';
  RAISE NOTICE 'Benutzer erstellt!';
  RAISE NOTICE '  user_id      : %', v_user_id;
  RAISE NOTICE '  email        : %', v_email;
  RAISE NOTICE '  rolle        : %', v_role_name;
  RAISE NOTICE '  display_name : %', v_display;
  RAISE NOTICE '  first_name   : %', v_fname;
  RAISE NOTICE '  last_name    : %', v_lname;
  RAISE NOTICE '  tenant       : % (schema: %)', v_tenant_key, v_schema;
END\$body\$;
"

success "Benutzer-Erstellung fuer '${USER_EMAIL}' (${USER_ROLE}) in Tenant '${TENANT_KEY}' abgeschlossen."
