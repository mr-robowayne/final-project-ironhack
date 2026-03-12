#!/bin/bash
# =============================================================
# create-tenant.sh — Neuen Tenant erstellen (V5 Schema)
#
# Verwendung:
#   ./create-tenant.sh                                        — interaktiv
#   ./create-tenant.sh <key> "<name>" [plan] [country]       — direkt
#
# Beispiel:
#   ./create-tenant.sh praxis-bern "Praxis Bern AG" pro CH
#
# Erlaubte Werte:
#   tenant_key: nur a-z 0-9 - _ (2-63 Zeichen, startet mit a-z/0-9)
#   plan:       basic | pro | enterprise   (Standard: pro)
#   country:    CH | DE | AT              (Standard: CH)
#
# Idempotent: ueberspringt wenn Tenant bereits existiert.
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

header "Patientsync — Neuen Tenant erstellen"

# --- Argumente oder interaktiv ---
if [ $# -ge 2 ]; then
  TENANT_KEY="$1"; TENANT_NAME="$2"; PLAN="${3:-pro}"; COUNTRY="${4:-CH}"
else
  echo ""
  read -rp "Tenant Key    (z.B. praxis-bern, nur a-z 0-9 - _): " TENANT_KEY
  read -rp "Tenant Name   (z.B. Praxis Bern AG):                " TENANT_NAME
  read -rp "Plan          [basic/pro/enterprise] (Standard: pro): " PLAN_IN
  read -rp "Land          [CH/DE/AT] (Standard: CH):              " COUNTRY_IN
  PLAN="${PLAN_IN:-pro}"; COUNTRY="${COUNTRY_IN:-CH}"
fi

# --- Validierung ---
[ -z "$TENANT_KEY" ] && { error "Tenant Key ist Pflicht."; exit 1; }
[ -z "$TENANT_NAME" ] && { error "Tenant Name ist Pflicht."; exit 1; }

# Key format: a-z 0-9 start, then a-z 0-9 - _ (2-63 chars total)
if ! echo "$TENANT_KEY" | grep -qE '^[a-z0-9][a-z0-9_-]{1,62}$'; then
  error "Ungueltiger Tenant Key: '$TENANT_KEY'"
  error "Erlaubt: nur Kleinbuchstaben, Ziffern, Bindestrich, Unterstrich (2-63 Zeichen, startet mit a-z/0-9)"
  exit 1
fi

PLAN=$(echo "$PLAN" | tr '[:upper:]' '[:lower:]')
case "$PLAN" in
  basic|pro|enterprise) ;;
  *) error "Ungueltiger Plan: '$PLAN' (erlaubt: basic, pro, enterprise)"; exit 1 ;;
esac

COUNTRY=$(echo "$COUNTRY" | tr '[:lower:]' '[:upper:]')
case "$COUNTRY" in
  CH|DE|AT) ;;
  *) error "Ungueltiges Land: '$COUNTRY' (erlaubt: CH, DE, AT)"; exit 1 ;;
esac

echo ""
info "Erstelle Tenant:"
echo "  Key:   $TENANT_KEY"
echo "  Name:  $TENANT_NAME"
echo "  Plan:  $PLAN | Land: $COUNTRY"
echo ""
read -rp "Fortfahren? [j/N]: " C; [ "${C,,}" = "j" ] || { info "Abgebrochen."; exit 0; }

tunnel_open

# --- SQL via session variables (safe for DO blocks) ---
# psql -v variables do NOT work inside DO $$ blocks, so we use SET app.* session vars
psql "${DB_CONN_STRING}" --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "SET app.tenant_key = '$(echo "$TENANT_KEY" | sed "s/'/''/g")';" \
  -c "SET app.tenant_name = '$(echo "$TENANT_NAME" | sed "s/'/''/g")';" \
  -c "SET app.plan = '${PLAN}';" \
  -c "SET app.country = '${COUNTRY}';" \
  -c "
DO \$\$
DECLARE
  v_existing  TEXT;
  v_schema    TEXT;
  v_tenant_id TEXT;
  v_key       TEXT := current_setting('app.tenant_key');
  v_name      TEXT := current_setting('app.tenant_name');
  v_plan      TEXT := current_setting('app.plan');
  v_country   TEXT := current_setting('app.country');
BEGIN
  -- Idempotent: skip if tenant already exists
  SELECT tenant_id, schema_name INTO v_existing, v_schema
    FROM public.tenant_registry
   WHERE tenant_key = v_key AND deleted_at IS NULL;

  IF v_existing IS NOT NULL THEN
    RAISE NOTICE '';
    RAISE NOTICE 'Tenant existiert bereits — uebersprungen.';
    RAISE NOTICE '  tenant_id : %', v_existing;
    RAISE NOTICE '  key       : %', v_key;
    RAISE NOTICE '  schema    : %', v_schema;
    RETURN;
  END IF;

  -- Create tenant via PL/pgSQL function
  v_tenant_id := public.create_tenant(v_key, v_name, v_plan, v_country, 'eu-central-2', NULL);

  SELECT schema_name INTO v_schema
    FROM public.tenant_registry
   WHERE tenant_id = v_tenant_id;

  RAISE NOTICE '';
  RAISE NOTICE 'Tenant erstellt!';
  RAISE NOTICE '  tenant_id : %', v_tenant_id;
  RAISE NOTICE '  key       : %', v_key;
  RAISE NOTICE '  name      : %', v_name;
  RAISE NOTICE '  schema    : %', v_schema;
  RAISE NOTICE '  plan      : %', v_plan;
  RAISE NOTICE '  country   : %', v_country;
END\$\$;
"

success "Tenant-Erstellung abgeschlossen. Jetzt ./create-user.sh ausfuehren."
