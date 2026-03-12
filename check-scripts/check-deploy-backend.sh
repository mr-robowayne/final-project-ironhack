#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_TFVARS="${REPO_ROOT}/terraform/deploy-backend/variables.tfvars"

usage() {
  cat <<'EOF'
Usage:
  check-deploy-backend.sh [-f /path/to/variables.tfvars] [-r aws-region]

Description:
  Checks via AWS CLI which resources from terraform/deploy-backend exist:
  - Secrets Manager secret
  - SSM document
  - SSM parameters
  - CloudTrail trail
  - CloudTrail S3 log bucket
  - CloudTrail CloudWatch log group (if enabled)
  - CloudTrail IAM role for CloudWatch delivery (if enabled)

Notes:
  - Uses current AWS CLI credentials/profile.
  - Exits with code 1 if one or more checks fail.
EOF
}

TFVARS_PATH="${DEFAULT_TFVARS}"
OVERRIDE_REGION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--tfvars)
      TFVARS_PATH="${2:-}"
      shift 2
      ;;
    -r|--region)
      OVERRIDE_REGION="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ ! -f "${TFVARS_PATH}" ]]; then
  echo "TFVARS file not found: ${TFVARS_PATH}" >&2
  exit 2
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found in PATH." >&2
  exit 2
fi

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

read_tfvar() {
  local key="$1"
  local raw
  raw="$(sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)$/\1/p" "${TFVARS_PATH}" | head -n1 || true)"
  raw="${raw%%#*}"
  raw="$(trim "${raw}")"

  if [[ -z "${raw}" || "${raw}" == "null" ]]; then
    printf '%s' ""
    return
  fi

  if [[ "${raw}" =~ ^\"(.*)\"$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi

  printf '%s' "${raw}"
}

read_bool_tfvar() {
  local key="$1"
  local default="${2:-false}"
  local v
  local v_lower
  v="$(read_tfvar "${key}")"
  if [[ -z "${v}" ]]; then
    printf '%s' "${default}"
    return
  fi
  v_lower="$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${v_lower}" == "true" ]]; then
    printf '%s' "true"
  else
    printf '%s' "false"
  fi
}

check_cmd() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[OK]   ${label}"
    OK_COUNT=$((OK_COUNT + 1))
  else
    echo "[FAIL] ${label}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

check_output_equals() {
  local label="$1"
  local expected="$2"
  shift 2

  local out
  if out="$("$@" 2>/dev/null)"; then
    out="$(trim "${out}")"
    if [[ "${out}" == "${expected}" ]]; then
      echo "[OK]   ${label}"
      OK_COUNT=$((OK_COUNT + 1))
    else
      echo "[FAIL] ${label} (expected: ${expected}, got: ${out})"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    echo "[FAIL] ${label}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

PROJECT_NAME="$(read_tfvar "project_name")"
ENVIRONMENT="$(read_tfvar "environment")"
AWS_REGION="${OVERRIDE_REGION:-$(read_tfvar "aws_region")}"

if [[ -z "${PROJECT_NAME}" || -z "${ENVIRONMENT}" || -z "${AWS_REGION}" ]]; then
  echo "Missing required values in tfvars (project_name, environment, aws_region)." >&2
  exit 2
fi

CREATE_SECRET_MANAGER="$(read_bool_tfvar "create_secret_manager" "true")"
CREATE_SSM="$(read_bool_tfvar "create_ssm" "true")"
CREATE_PARAMETER_STORE="$(read_bool_tfvar "create_parameter_store" "true")"
CREATE_CLOUDTRAIL="$(read_bool_tfvar "create_cloudtrail" "true")"
CLOUDTRAIL_ENABLE_CW_LOGS="$(read_bool_tfvar "cloudtrail_enable_cloudwatch_logs" "true")"

SECRET_NAME="$(read_tfvar "secret_name")"
if [[ -z "${SECRET_NAME}" ]]; then
  SECRET_NAME="${PROJECT_NAME}-${ENVIRONMENT}/terraform/backend"
fi

SSM_DOCUMENT_NAME="$(read_tfvar "ssm_document_name")"
if [[ -z "${SSM_DOCUMENT_NAME}" ]]; then
  SSM_DOCUMENT_NAME="${PROJECT_NAME}-${ENVIRONMENT}-backend-ops"
fi

PARAMETER_PREFIX="$(read_tfvar "parameter_prefix")"
if [[ -z "${PARAMETER_PREFIX}" ]]; then
  PARAMETER_PREFIX="/${PROJECT_NAME}/${ENVIRONMENT}/backend"
fi

CLOUDTRAIL_NAME="$(read_tfvar "cloudtrail_name")"
if [[ -z "${CLOUDTRAIL_NAME}" ]]; then
  CLOUDTRAIL_NAME="${PROJECT_NAME}-${ENVIRONMENT}-audit-trail"
fi

CLOUDTRAIL_BUCKET_NAME="$(read_tfvar "cloudtrail_s3_bucket_name")"
if [[ -z "${CLOUDTRAIL_BUCKET_NAME}" ]]; then
  CLOUDTRAIL_BUCKET_NAME="${PROJECT_NAME}-${ENVIRONMENT}-cloudtrail-logs"
fi

CLOUDTRAIL_LOG_GROUP="$(read_tfvar "cloudtrail_cloudwatch_log_group_name")"
if [[ -z "${CLOUDTRAIL_LOG_GROUP}" ]]; then
  CLOUDTRAIL_LOG_GROUP="/aws/cloudtrail/${CLOUDTRAIL_NAME}"
fi

PARAMETERS=(
  "${PARAMETER_PREFIX}/bucket"
  "${PARAMETER_PREFIX}/dynamodb_table"
  "${PARAMETER_PREFIX}/key"
  "${PARAMETER_PREFIX}/region"
  "${PARAMETER_PREFIX}/role_arn"
)

OK_COUNT=0
FAIL_COUNT=0

echo "Checking deploy-backend resources"
echo "Region: ${AWS_REGION}"
echo "TFVARS: ${TFVARS_PATH}"
echo

if [[ "${CREATE_SECRET_MANAGER}" == "true" ]]; then
  check_cmd "Secrets Manager secret: ${SECRET_NAME}" \
    aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --region "${AWS_REGION}"
else
  echo "[SKIP] Secrets Manager (create_secret_manager=false)"
fi

if [[ "${CREATE_SSM}" == "true" ]]; then
  check_cmd "SSM document: ${SSM_DOCUMENT_NAME}" \
    aws ssm get-document --name "${SSM_DOCUMENT_NAME}" --region "${AWS_REGION}"
else
  echo "[SKIP] SSM document (create_ssm=false)"
fi

if [[ "${CREATE_PARAMETER_STORE}" == "true" ]]; then
  for parameter_name in "${PARAMETERS[@]}"; do
    check_cmd "SSM parameter: ${parameter_name}" \
      aws ssm get-parameter --name "${parameter_name}" --region "${AWS_REGION}"
  done
else
  echo "[SKIP] Parameter Store (create_parameter_store=false)"
fi

if [[ "${CREATE_CLOUDTRAIL}" == "true" ]]; then
  check_cmd "CloudTrail trail: ${CLOUDTRAIL_NAME}" \
    aws cloudtrail get-trail --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}"

  check_output_equals "CloudTrail status (is logging): ${CLOUDTRAIL_NAME}" "True" \
    aws cloudtrail get-trail-status --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}" --query 'IsLogging' --output text

  check_cmd "CloudTrail S3 log bucket: ${CLOUDTRAIL_BUCKET_NAME}" \
    aws s3api head-bucket --bucket "${CLOUDTRAIL_BUCKET_NAME}" --region "${AWS_REGION}"

  if [[ "${CLOUDTRAIL_ENABLE_CW_LOGS}" == "true" ]]; then
    check_output_equals "CloudTrail CloudWatch log group: ${CLOUDTRAIL_LOG_GROUP}" "1" \
      aws logs describe-log-groups --log-group-name-prefix "${CLOUDTRAIL_LOG_GROUP}" --region "${AWS_REGION}" --query "length(logGroups[?logGroupName=='${CLOUDTRAIL_LOG_GROUP}'])" --output text

    check_cmd "CloudTrail IAM role: ${CLOUDTRAIL_NAME}-cloudwatch-role" \
      aws iam get-role --role-name "${CLOUDTRAIL_NAME}-cloudwatch-role"
  else
    echo "[SKIP] CloudTrail CloudWatch logs (cloudtrail_enable_cloudwatch_logs=false)"
  fi
else
  echo "[SKIP] CloudTrail (create_cloudtrail=false)"
fi

echo
echo "Summary: ${OK_COUNT} OK, ${FAIL_COUNT} FAIL"

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  exit 1
fi
