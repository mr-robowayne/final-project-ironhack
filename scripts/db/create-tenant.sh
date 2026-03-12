#!/bin/bash
# =============================================================
# create-tenant.sh — Neuen Tenant erstellen
#
# Verwendung:
#   ./create-tenant.sh                                        — interaktiv
#   ./create-tenant.sh <key> "<name>" [plan] [country]       — direkt
#
# Beispiel:
#   ./create-tenant.sh praxis-bern "Praxis Bern AG" pro CH
#
# Erlaubte Werte:
#   plan:    basic | pro | enterprise   (Standard: pro)
#   country: CH | DE | AT              (Standard: CH)
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

check_deps_no_docker

header "Patientsync — Neuen Tenant erstellen"

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

[ -z "$TENANT_KEY" ] || [ -z "$TENANT_NAME" ] && { error "Key und Name sind Pflicht."; exit 1; }

echo ""
info "Erstelle Tenant:"
echo "  Key:   $TENANT_KEY"
echo "  Name:  $TENANT_NAME"
echo "  Plan:  $PLAN | Land: $COUNTRY"
echo ""
read -rp "Fortfahren? [j/N]: " C; [ "${C,,}" = "j" ] || { info "Abgebrochen."; exit 0; }

tunnel_open

psql "${DB_CONN_STRING}" --no-psqlrc \
  -v "TENANT_KEY=${TENANT_KEY}" \
  -v "TENANT_NAME=${TENANT_NAME}" \
  -v "PLAN=${PLAN}" \
  -v "COUNTRY=${COUNTRY}" \
  << 'SQL'
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_existing UUID;
  v_tenant_id UUID;
  v_schema TEXT;
BEGIN
  SELECT tenant_id INTO v_existing FROM public.tenant_registry
   WHERE tenant_key = :'TENANT_KEY' AND deleted_at IS NULL;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant "%" existiert bereits (id=%).', :'TENANT_KEY', v_existing;
  END IF;

  v_tenant_id := public.create_tenant(:'TENANT_KEY', :'TENANT_NAME', :'PLAN', :'COUNTRY', 'eu-central-2', NULL);

  SELECT schema_name INTO v_schema FROM public.tenant_registry WHERE tenant_id = v_tenant_id;

  RAISE NOTICE '';
  RAISE NOTICE 'Tenant erstellt!';
  RAISE NOTICE '  tenant_id : %', v_tenant_id;
  RAISE NOTICE '  key       : %', :'TENANT_KEY';
  RAISE NOTICE '  schema    : %', v_schema;
END$$;
SQL

success "Tenant '${TENANT_KEY}' erstellt. Jetzt ./create-user.sh ausführen."
