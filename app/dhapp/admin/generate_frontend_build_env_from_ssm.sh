#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_FILE="${1:-$ROOT_DIR/dhapp/admin/frontend.build.env}"
AWS_REGION="${AWS_REGION:-eu-central-2}"
SSM_PREFIX="${SSM_PREFIX:-/patientsync/prod/frontend}"
EMPTY_PLACEHOLDER="${EMPTY_PLACEHOLDER:-__EMPTY__}"

PARAM_KEYS=(
  REACT_APP_API_BASE
  REACT_APP_API_URL
  REACT_APP_DEFAULT_TENANT
  REACT_APP_LT_API_URL
  REACT_APP_CHAT_NOTIFICATION_PREVIEW
  REACT_APP_BACKEND_PORT
  REACT_APP_DEV_TENANT_ID
  REACT_APP_DEV_USER_ID
)

default_value() {
  case "$1" in
    REACT_APP_DEFAULT_TENANT) echo "dhpatientsync" ;;
    REACT_APP_CHAT_NOTIFICATION_PREVIEW) echo "false" ;;
    *) echo "" ;;
  esac
}

fetch_parameter() {
  local name="$1"
  local value
  value="$(aws ssm get-parameter \
    --region "$AWS_REGION" \
    --name "$name" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text 2>/dev/null || true)"

  if [[ "$value" == "None" || "$value" == "null" ]]; then
    value=""
  fi

  if [[ "$value" == "$EMPTY_PLACEHOLDER" ]]; then
    value=""
  fi

  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  printf "%s" "$value"
}

TMP_FILE="$(mktemp)"

{
  echo "# Generated from AWS SSM Parameter Store"
  echo "# UTC: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "# Region: $AWS_REGION"
  echo "# Prefix: $SSM_PREFIX"
  echo

  for key in "${PARAM_KEYS[@]}"; do
    name="${SSM_PREFIX}/${key}"
    value="$(fetch_parameter "$name")"
    if [[ -z "$value" ]]; then
      value="$(default_value "$key")"
    fi
    printf "%s=%s\n" "$key" "$value"
  done

  echo
  echo "# Security: keep source maps disabled in production"
  echo "GENERATE_SOURCEMAP=false"
} > "$TMP_FILE"

mv "$TMP_FILE" "$OUT_FILE"
echo "[ssm-env] wrote: $OUT_FILE"
