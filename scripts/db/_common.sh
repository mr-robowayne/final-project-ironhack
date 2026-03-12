#!/bin/bash
# =============================================================
# _common.sh — Gemeinsame Hilfsfunktionen für alle DB-Scripts
# Wird von anderen Scripts per: source "$(dirname "$0")/_common.sh"
# =============================================================

set -euo pipefail

# --- Konfiguration ---
AWS_REGION="${AWS_REGION:-eu-central-2}"
LOCAL_PORT="${LOCAL_PORT:-5433}"      # 5433 um Konflikt mit lokalem Postgres zu vermeiden
RDS_PORT="5432"
DB_NAME="patientsync"
DB_ADMIN_USER="patientsync_admin"
SSM_RDS_ENDPOINT_PARAM="/patientsync/prod/data/rds/endpoint"
SSM_RDS_SECRET_ARN_PARAM="/patientsync/prod/data/rds/secret_arn"
TUNNEL_PID_FILE="/tmp/patientsync-ssm-tunnel.pid"

# Pfade relativ zum scripts/db/ Verzeichnis
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DB_SQL_DIR="${PROJECT_ROOT}/db/sql"
DB_SEED_DIR="${PROJECT_ROOT}/db/seed"
FLYWAY_CONF_TMP="${PROJECT_ROOT}/db/flyway.conf"

# Farben
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BLUE}══════════════════════════════════════════${NC}"; echo -e "${BLUE} $*${NC}"; echo -e "${BLUE}══════════════════════════════════════════${NC}"; }

# -------------------------------------------------------
check_deps() {
  local missing=0
  for tool in aws psql docker nc; do
    if ! command -v "$tool" &>/dev/null; then
      error "Fehlendes Tool: $tool"
      missing=1
    fi
  done
  if ! session-manager-plugin --version &>/dev/null 2>&1; then
    error "session-manager-plugin fehlt."
    error "Mac: brew install --cask session-manager-plugin"
    missing=1
  fi
  [ $missing -eq 0 ] || exit 1
}

check_deps_no_docker() {
  local missing=0
  for tool in aws psql nc; do
    if ! command -v "$tool" &>/dev/null; then
      error "Fehlendes Tool: $tool"
      missing=1
    fi
  done
  if ! session-manager-plugin --version &>/dev/null 2>&1; then
    error "session-manager-plugin fehlt."
    error "Mac: brew install --cask session-manager-plugin"
    missing=1
  fi
  [ $missing -eq 0 ] || exit 1
}

# -------------------------------------------------------
get_ssm_param() {
  aws ssm get-parameter \
    --name "$1" \
    --region "$AWS_REGION" \
    --query "Parameter.Value" \
    --output text
}

find_ec2_instance() {
  local instance_id
  instance_id=$(aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters \
      "Name=tag:Project,Values=patientsync" \
      "Name=tag:Tier,Values=private" \
      "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text)

  if [ "$instance_id" = "None" ] || [ -z "$instance_id" ]; then
    error "Keine laufende patientsync EC2 Instance gefunden!"
    exit 1
  fi
  echo "$instance_id"
}

get_admin_password() {
  local secret_arn="$1"
  aws secretsmanager get-secret-value \
    --secret-id "$secret_arn" \
    --region "$AWS_REGION" \
    --query "SecretString" \
    --output text \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])"
}

# -------------------------------------------------------
# tunnel_open — SSM Tunnel öffnen
# Exportiert: RDS_ENDPOINT, ADMIN_PASSWORD, PGPASSWORD, DB_CONN_STRING
# -------------------------------------------------------
tunnel_open() {
  info "Lese RDS-Parameter aus SSM..."
  RDS_ENDPOINT=$(get_ssm_param "$SSM_RDS_ENDPOINT_PARAM")
  local secret_arn
  secret_arn=$(get_ssm_param "$SSM_RDS_SECRET_ARN_PARAM")
  success "RDS Endpoint: $RDS_ENDPOINT"

  info "Lese Admin-Passwort aus Secrets Manager..."
  ADMIN_PASSWORD=$(get_admin_password "$secret_arn")
  export PGPASSWORD="$ADMIN_PASSWORD"

  info "Suche laufende EC2 Instance..."
  local instance_id
  instance_id=$(find_ec2_instance)
  success "EC2 Instance: $instance_id"

  info "Öffne SSM Tunnel (localhost:${LOCAL_PORT} → EC2 → RDS:${RDS_PORT})..."
  aws ssm start-session \
    --target "$instance_id" \
    --region "$AWS_REGION" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"${RDS_ENDPOINT}\"],\"portNumber\":[\"${RDS_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}" \
    > /tmp/patientsync-ssm-tunnel.log 2>&1 &
  echo $! > "$TUNNEL_PID_FILE"

  local ready=0
  for i in $(seq 1 20); do
    if nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
      success "SSM Tunnel bereit nach ${i}s"
      ready=1
      break
    fi
    sleep 1
  done

  if [ $ready -eq 0 ]; then
    error "SSM Tunnel konnte nicht geöffnet werden. Log:"
    cat /tmp/patientsync-ssm-tunnel.log >&2
    exit 1
  fi

  DB_CONN_STRING="postgresql://${DB_ADMIN_USER}@127.0.0.1:${LOCAL_PORT}/${DB_NAME}?sslmode=require"
  export DB_CONN_STRING
}

tunnel_close() {
  if [ -f "$TUNNEL_PID_FILE" ]; then
    kill "$(cat "$TUNNEL_PID_FILE")" 2>/dev/null || true
    rm -f "$TUNNEL_PID_FILE"
    info "SSM Tunnel geschlossen."
  fi
  unset PGPASSWORD 2>/dev/null || true
}

trap tunnel_close EXIT
