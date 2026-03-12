#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_TFVARS="${REPO_ROOT}/terraform/bootstrap/variables.tfvars"
DEPLOY_AWS_TFVARS="${REPO_ROOT}/terraform/deploy-aws-ressources/variables.tfvars"

ASSUME_YES="false"
DRY_RUN="false"
REGION_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage:
  reset-bootstrap-and-deploy-aws.sh [-y] [--dry-run] [-r eu-central-2]

Description:
  Deletes ONLY resources defined by:
  - terraform/bootstrap
  - terraform/deploy-aws-ressources

  Then removes corresponding state files and verifies that these resources no
  longer exist.

Safety:
  - Uses explicit names from tfvars (no wildcard deletion).
  - Verifies critical resource tags (Project/Environment/ManagedBy) before delete.
  - Aborts if state bucket contains unknown keys.

Requirements:
  - aws CLI configured with the correct account/profile permissions.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      ASSUME_YES="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -r|--region)
      REGION_OVERRIDE="${2:-}"
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

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found in PATH." >&2
  exit 2
fi

if [[ ! -f "${BOOTSTRAP_TFVARS}" ]]; then
  echo "Missing tfvars: ${BOOTSTRAP_TFVARS}" >&2
  exit 2
fi

if [[ ! -f "${DEPLOY_AWS_TFVARS}" ]]; then
  echo "Missing tfvars: ${DEPLOY_AWS_TFVARS}" >&2
  exit 2
fi

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

read_tfvar() {
  local file="$1"
  local key="$2"
  local raw
  raw="$(sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)$/\1/p" "$file" | head -n1 || true)"
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
  local file="$1"
  local key="$2"
  local default_value="$3"
  local v
  local v_lower
  v="$(read_tfvar "$file" "$key")"
  if [[ -z "${v}" ]]; then
    printf '%s' "${default_value}"
    return
  fi
  v_lower="$(printf '%s' "${v}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${v_lower}" == "true" ]]; then
    printf '%s' "true"
  else
    printf '%s' "false"
  fi
}

run_cmd() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf '[DRY-RUN]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

exists_cmd() {
  "$@" >/dev/null 2>&1
}

require_bucket_tags() {
  local bucket="$1"
  local region="$2"
  local expected_project="$3"
  local expected_environment="$4"
  local project
  local environment
  local managed_by

  project="$(aws s3api get-bucket-tagging --bucket "${bucket}" --region "${region}" --query "TagSet[?Key=='Project']|[0].Value" --output text 2>/dev/null || true)"
  environment="$(aws s3api get-bucket-tagging --bucket "${bucket}" --region "${region}" --query "TagSet[?Key=='Environment']|[0].Value" --output text 2>/dev/null || true)"
  managed_by="$(aws s3api get-bucket-tagging --bucket "${bucket}" --region "${region}" --query "TagSet[?Key=='ManagedBy']|[0].Value" --output text 2>/dev/null || true)"

  if [[ "${project}" != "${expected_project}" || "${environment}" != "${expected_environment}" || "${managed_by}" == "None" || -z "${managed_by}" ]]; then
    echo "Safety check failed for bucket ${bucket}: tags do not match expected Project/Environment/ManagedBy." >&2
    echo "Expected Project=${expected_project}, Environment=${expected_environment}, ManagedBy=<set>" >&2
    echo "Got Project=${project}, Environment=${environment}, ManagedBy=${managed_by}" >&2
    exit 1
  fi
}

require_role_tags() {
  local role_name="$1"
  local expected_project="$2"
  local expected_environment="$3"
  local project
  local environment
  local managed_by

  project="$(aws iam list-role-tags --role-name "${role_name}" --query "Tags[?Key=='Project']|[0].Value" --output text 2>/dev/null || true)"
  environment="$(aws iam list-role-tags --role-name "${role_name}" --query "Tags[?Key=='Environment']|[0].Value" --output text 2>/dev/null || true)"
  managed_by="$(aws iam list-role-tags --role-name "${role_name}" --query "Tags[?Key=='ManagedBy']|[0].Value" --output text 2>/dev/null || true)"

  if [[ "${project}" != "${expected_project}" || "${environment}" != "${expected_environment}" || "${managed_by}" == "None" || -z "${managed_by}" ]]; then
    echo "Safety check failed for role ${role_name}: tags do not match expected Project/Environment/ManagedBy." >&2
    echo "Expected Project=${expected_project}, Environment=${expected_environment}, ManagedBy=<set>" >&2
    echo "Got Project=${project}, Environment=${environment}, ManagedBy=${managed_by}" >&2
    exit 1
  fi
}

require_dynamodb_tags() {
  local table_name="$1"
  local region="$2"
  local expected_project="$3"
  local expected_environment="$4"
  local table_arn
  local project
  local environment
  local managed_by

  table_arn="$(aws dynamodb describe-table --table-name "${table_name}" --region "${region}" --query "Table.TableArn" --output text 2>/dev/null || true)"
  if [[ -z "${table_arn}" || "${table_arn}" == "None" ]]; then
    return 0
  fi

  project="$(aws dynamodb list-tags-of-resource --resource-arn "${table_arn}" --region "${region}" --query "Tags[?Key=='Project']|[0].Value" --output text 2>/dev/null || true)"
  environment="$(aws dynamodb list-tags-of-resource --resource-arn "${table_arn}" --region "${region}" --query "Tags[?Key=='Environment']|[0].Value" --output text 2>/dev/null || true)"
  managed_by="$(aws dynamodb list-tags-of-resource --resource-arn "${table_arn}" --region "${region}" --query "Tags[?Key=='ManagedBy']|[0].Value" --output text 2>/dev/null || true)"

  if [[ "${project}" != "${expected_project}" || "${environment}" != "${expected_environment}" || "${managed_by}" == "None" || -z "${managed_by}" ]]; then
    echo "Safety check failed for DynamoDB table ${table_name}: tags do not match expected Project/Environment/ManagedBy." >&2
    echo "Expected Project=${expected_project}, Environment=${expected_environment}, ManagedBy=<set>" >&2
    echo "Got Project=${project}, Environment=${environment}, ManagedBy=${managed_by}" >&2
    exit 1
  fi
}

empty_bucket_all_versions() {
  local bucket="$1"
  local region="$2"
  local line
  local key
  local version_id
  local has_items="true"

  while [[ "${has_items}" == "true" ]]; do
    has_items="false"

    while IFS=$'\t' read -r key version_id; do
      if [[ -z "${key}" || "${key}" == "None" || -z "${version_id}" || "${version_id}" == "None" ]]; then
        continue
      fi
      has_items="true"
      run_cmd aws s3api delete-object --bucket "${bucket}" --key "${key}" --version-id "${version_id}" --region "${region}" >/dev/null
    done < <(aws s3api list-object-versions --bucket "${bucket}" --region "${region}" --query "Versions[].[Key,VersionId]" --output text 2>/dev/null || true)

    while IFS=$'\t' read -r key version_id; do
      if [[ -z "${key}" || "${key}" == "None" || -z "${version_id}" || "${version_id}" == "None" ]]; then
        continue
      fi
      has_items="true"
      run_cmd aws s3api delete-object --bucket "${bucket}" --key "${key}" --version-id "${version_id}" --region "${region}" >/dev/null
    done < <(aws s3api list-object-versions --bucket "${bucket}" --region "${region}" --query "DeleteMarkers[].[Key,VersionId]" --output text 2>/dev/null || true)
  done

  run_cmd aws s3 rm "s3://${bucket}" --recursive --region "${region}" >/dev/null 2>&1 || true
}

ensure_only_allowed_state_keys() {
  local bucket="$1"
  local region="$2"
  local allowed_key_1="$3"
  local allowed_key_2="$4"
  local key

  if ! exists_cmd aws s3api head-bucket --bucket "${bucket}" --region "${region}"; then
    return 0
  fi

  while IFS=$'\t' read -r key; do
    if [[ -z "${key}" || "${key}" == "None" ]]; then
      continue
    fi
    if [[ "${key}" == "${allowed_key_1}" || "${key}" == "${allowed_key_2}" ]]; then
      continue
    fi
    echo "Safety check failed: found unexpected object in state bucket: ${key}" >&2
    echo "Only these keys are allowed for deletion: ${allowed_key_1}, ${allowed_key_2}" >&2
    exit 1
  done < <(aws s3api list-objects-v2 --bucket "${bucket}" --region "${region}" --query "Contents[].Key" --output text 2>/dev/null || true)
}

delete_kms_by_alias() {
  local alias_name="$1"
  local region="$2"
  local key_id
  local key_state

  key_id="$(aws kms describe-key --key-id "${alias_name}" --region "${region}" --query "KeyMetadata.KeyId" --output text 2>/dev/null || true)"
  if [[ -z "${key_id}" || "${key_id}" == "None" ]]; then
    return 0
  fi

  key_state="$(aws kms describe-key --key-id "${key_id}" --region "${region}" --query "KeyMetadata.KeyState" --output text 2>/dev/null || true)"

  run_cmd aws kms delete-alias --alias-name "${alias_name}" --region "${region}" >/dev/null 2>&1 || true

  if [[ "${key_state}" != "PendingDeletion" ]]; then
    run_cmd aws kms schedule-key-deletion --key-id "${key_id}" --pending-window-in-days 7 --region "${region}" >/dev/null 2>&1 || true
  fi
}

PROJECT_NAME="$(read_tfvar "${BOOTSTRAP_TFVARS}" "project_name")"
ENVIRONMENT="$(read_tfvar "${BOOTSTRAP_TFVARS}" "environment")"
AWS_REGION="${REGION_OVERRIDE:-$(read_tfvar "${BOOTSTRAP_TFVARS}" "aws_region")}"

if [[ -z "${PROJECT_NAME}" || -z "${ENVIRONMENT}" || -z "${AWS_REGION}" ]]; then
  echo "Missing required bootstrap vars (project_name, environment, aws_region)." >&2
  exit 2
fi

STATE_BUCKET_NAME="$(read_tfvar "${BOOTSTRAP_TFVARS}" "state_bucket_name")"
if [[ -z "${STATE_BUCKET_NAME}" ]]; then
  STATE_BUCKET_NAME="${PROJECT_NAME}-${ENVIRONMENT}-tfstate"
fi

LOCK_TABLE_NAME="$(read_tfvar "${BOOTSTRAP_TFVARS}" "lock_table_name")"
if [[ -z "${LOCK_TABLE_NAME}" ]]; then
  LOCK_TABLE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-tf-locks"
fi

ROLE_NAME="$(read_tfvar "${BOOTSTRAP_TFVARS}" "role_name")"
if [[ -z "${ROLE_NAME}" ]]; then
  ROLE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-tf-backend-role"
fi

BOOTSTRAP_STATE_KEY="$(read_tfvar "${BOOTSTRAP_TFVARS}" "state_key")"
if [[ -z "${BOOTSTRAP_STATE_KEY}" ]]; then
  BOOTSTRAP_STATE_KEY="bootstrap/terraform.tfstate"
fi

DEPLOY_STATE_KEY="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "state_key")"
if [[ -z "${DEPLOY_STATE_KEY}" ]]; then
  DEPLOY_STATE_KEY="deploy-backend/terraform.tfstate"
fi

CREATE_SECRET_MANAGER="$(read_bool_tfvar "${DEPLOY_AWS_TFVARS}" "create_secret_manager" "true")"
CREATE_SSM="$(read_bool_tfvar "${DEPLOY_AWS_TFVARS}" "create_ssm" "true")"
CREATE_PARAMETER_STORE="$(read_bool_tfvar "${DEPLOY_AWS_TFVARS}" "create_parameter_store" "true")"
CREATE_CLOUDTRAIL="$(read_bool_tfvar "${DEPLOY_AWS_TFVARS}" "create_cloudtrail" "true")"
CREATE_BACKEND_KMS="$(read_bool_tfvar "${DEPLOY_AWS_TFVARS}" "create_kms_key" "true")"
CREATE_STATE_KMS="$(read_bool_tfvar "${BOOTSTRAP_TFVARS}" "create_state_kms_key" "true")"

SECRET_NAME="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "secret_name")"
if [[ -z "${SECRET_NAME}" ]]; then
  SECRET_NAME="${PROJECT_NAME}-${ENVIRONMENT}/terraform/backend"
fi

SSM_DOCUMENT_NAME="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "ssm_document_name")"
if [[ -z "${SSM_DOCUMENT_NAME}" ]]; then
  SSM_DOCUMENT_NAME="${PROJECT_NAME}-${ENVIRONMENT}-backend-ops"
fi

PARAMETER_PREFIX="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "parameter_prefix")"
if [[ -z "${PARAMETER_PREFIX}" ]]; then
  PARAMETER_PREFIX="/${PROJECT_NAME}/${ENVIRONMENT}/backend"
fi

CLOUDTRAIL_NAME="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "cloudtrail_name")"
if [[ -z "${CLOUDTRAIL_NAME}" ]]; then
  CLOUDTRAIL_NAME="${PROJECT_NAME}-${ENVIRONMENT}-audit-trail"
fi

CLOUDTRAIL_LOG_BUCKET="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "cloudtrail_s3_bucket_name")"
if [[ -z "${CLOUDTRAIL_LOG_BUCKET}" ]]; then
  CLOUDTRAIL_LOG_BUCKET="${PROJECT_NAME}-${ENVIRONMENT}-cloudtrail-logs"
fi

CLOUDTRAIL_LOG_GROUP="$(read_tfvar "${DEPLOY_AWS_TFVARS}" "cloudtrail_cloudwatch_log_group_name")"
if [[ -z "${CLOUDTRAIL_LOG_GROUP}" ]]; then
  CLOUDTRAIL_LOG_GROUP="/aws/cloudtrail/${CLOUDTRAIL_NAME}"
fi

STATE_KMS_ALIAS="alias/${PROJECT_NAME}-${ENVIRONMENT}-tfstate"
BACKEND_KMS_ALIAS="alias/${PROJECT_NAME}-${ENVIRONMENT}-backend"
CLOUDTRAIL_CW_ROLE_NAME="${CLOUDTRAIL_NAME}-cloudwatch-role"
ROLE_POLICY_NAME="${ROLE_NAME}-state-access"

PARAMETERS=(
  "${PARAMETER_PREFIX}/bucket"
  "${PARAMETER_PREFIX}/dynamodb_table"
  "${PARAMETER_PREFIX}/key"
  "${PARAMETER_PREFIX}/region"
  "${PARAMETER_PREFIX}/role_arn"
)

echo "Scope"
echo "- AWS region: ${AWS_REGION}"
echo "- Project/environment: ${PROJECT_NAME}/${ENVIRONMENT}"
echo "- Bootstrap bucket/table/role: ${STATE_BUCKET_NAME} / ${LOCK_TABLE_NAME} / ${ROLE_NAME}"
echo "- Deploy state keys: ${BOOTSTRAP_STATE_KEY}, ${DEPLOY_STATE_KEY}"
echo "- Deploy resources: secret=${SECRET_NAME}, ssm_doc=${SSM_DOCUMENT_NAME}, cloudtrail=${CLOUDTRAIL_NAME}"
echo

if [[ "${ASSUME_YES}" != "true" ]]; then
  read -r -p "Type DELETE to continue: " CONFIRM
  if [[ "${CONFIRM}" != "DELETE" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Running safety checks..."
if exists_cmd aws s3api head-bucket --bucket "${STATE_BUCKET_NAME}" --region "${AWS_REGION}"; then
  require_bucket_tags "${STATE_BUCKET_NAME}" "${AWS_REGION}" "${PROJECT_NAME}" "${ENVIRONMENT}"
fi

if [[ "${CREATE_CLOUDTRAIL}" == "true" ]] && exists_cmd aws s3api head-bucket --bucket "${CLOUDTRAIL_LOG_BUCKET}" --region "${AWS_REGION}"; then
  require_bucket_tags "${CLOUDTRAIL_LOG_BUCKET}" "${AWS_REGION}" "${PROJECT_NAME}" "${ENVIRONMENT}"
fi

if exists_cmd aws iam get-role --role-name "${ROLE_NAME}"; then
  require_role_tags "${ROLE_NAME}" "${PROJECT_NAME}" "${ENVIRONMENT}"
fi

if exists_cmd aws dynamodb describe-table --table-name "${LOCK_TABLE_NAME}" --region "${AWS_REGION}"; then
  require_dynamodb_tags "${LOCK_TABLE_NAME}" "${AWS_REGION}" "${PROJECT_NAME}" "${ENVIRONMENT}"
fi

ensure_only_allowed_state_keys "${STATE_BUCKET_NAME}" "${AWS_REGION}" "${BOOTSTRAP_STATE_KEY}" "${DEPLOY_STATE_KEY}"
echo "Safety checks passed."
echo

echo "Deleting deploy-aws-ressources resources..."
if [[ "${CREATE_CLOUDTRAIL}" == "true" ]]; then
  if exists_cmd aws cloudtrail get-trail --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}"; then
    run_cmd aws cloudtrail stop-logging --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1 || true
    run_cmd aws cloudtrail delete-trail --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}" >/dev/null
  fi

  CLOUDTRAIL_LOG_GROUP_COUNT="$(aws logs describe-log-groups --log-group-name-prefix "${CLOUDTRAIL_LOG_GROUP}" --region "${AWS_REGION}" --query "length(logGroups[?logGroupName=='${CLOUDTRAIL_LOG_GROUP}'])" --output text 2>/dev/null || true)"
  if [[ "${CLOUDTRAIL_LOG_GROUP_COUNT}" == "1" ]]; then
    run_cmd aws logs delete-log-group --log-group-name "${CLOUDTRAIL_LOG_GROUP}" --region "${AWS_REGION}" >/dev/null 2>&1 || true
  fi

  if exists_cmd aws iam get-role --role-name "${CLOUDTRAIL_CW_ROLE_NAME}"; then
    run_cmd aws iam delete-role-policy --role-name "${CLOUDTRAIL_CW_ROLE_NAME}" --policy-name "${CLOUDTRAIL_CW_ROLE_NAME%-role}-policy" >/dev/null 2>&1 || true
    run_cmd aws iam delete-role --role-name "${CLOUDTRAIL_CW_ROLE_NAME}" >/dev/null 2>&1 || true
  fi

  if exists_cmd aws s3api head-bucket --bucket "${CLOUDTRAIL_LOG_BUCKET}" --region "${AWS_REGION}"; then
    empty_bucket_all_versions "${CLOUDTRAIL_LOG_BUCKET}" "${AWS_REGION}"
    run_cmd aws s3api delete-bucket --bucket "${CLOUDTRAIL_LOG_BUCKET}" --region "${AWS_REGION}" >/dev/null
  fi
fi

if [[ "${CREATE_SECRET_MANAGER}" == "true" ]] && exists_cmd aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --region "${AWS_REGION}"; then
  run_cmd aws secretsmanager delete-secret --secret-id "${SECRET_NAME}" --force-delete-without-recovery --region "${AWS_REGION}" >/dev/null
fi

if [[ "${CREATE_SSM}" == "true" ]] && exists_cmd aws ssm get-document --name "${SSM_DOCUMENT_NAME}" --region "${AWS_REGION}"; then
  run_cmd aws ssm delete-document --name "${SSM_DOCUMENT_NAME}" --region "${AWS_REGION}" >/dev/null
fi

if [[ "${CREATE_PARAMETER_STORE}" == "true" ]]; then
  for p in "${PARAMETERS[@]}"; do
    if exists_cmd aws ssm get-parameter --name "${p}" --region "${AWS_REGION}"; then
      run_cmd aws ssm delete-parameter --name "${p}" --region "${AWS_REGION}" >/dev/null
    fi
  done
fi

if [[ "${CREATE_BACKEND_KMS}" == "true" ]]; then
  delete_kms_by_alias "${BACKEND_KMS_ALIAS}" "${AWS_REGION}"
fi

echo "Deleting bootstrap resources..."
if exists_cmd aws iam get-role --role-name "${ROLE_NAME}"; then
  run_cmd aws iam delete-role-policy --role-name "${ROLE_NAME}" --policy-name "${ROLE_POLICY_NAME}" >/dev/null 2>&1 || true
  run_cmd aws iam delete-role --role-name "${ROLE_NAME}" >/dev/null 2>&1 || true
fi

if exists_cmd aws dynamodb describe-table --table-name "${LOCK_TABLE_NAME}" --region "${AWS_REGION}"; then
  run_cmd aws dynamodb update-table --table-name "${LOCK_TABLE_NAME}" --deletion-protection-enabled false --region "${AWS_REGION}" >/dev/null
  run_cmd aws dynamodb delete-table --table-name "${LOCK_TABLE_NAME}" --region "${AWS_REGION}" >/dev/null
fi

if exists_cmd aws s3api head-bucket --bucket "${STATE_BUCKET_NAME}" --region "${AWS_REGION}"; then
  empty_bucket_all_versions "${STATE_BUCKET_NAME}" "${AWS_REGION}"
  run_cmd aws s3api delete-bucket --bucket "${STATE_BUCKET_NAME}" --region "${AWS_REGION}" >/dev/null
fi

if [[ "${CREATE_STATE_KMS}" == "true" ]]; then
  delete_kms_by_alias "${STATE_KMS_ALIAS}" "${AWS_REGION}"
fi

echo "Removing local Terraform state files..."
run_cmd rm -f "${REPO_ROOT}/terraform/bootstrap/terraform.tfstate" "${REPO_ROOT}/terraform/bootstrap/terraform.tfstate.backup"
run_cmd rm -f "${REPO_ROOT}/terraform/deploy-aws-ressources/terraform.tfstate" "${REPO_ROOT}/terraform/deploy-aws-ressources/terraform.tfstate.backup"
run_cmd rm -rf "${REPO_ROOT}/terraform/bootstrap/.terraform" "${REPO_ROOT}/terraform/deploy-aws-ressources/.terraform"

echo
echo "Verification..."
FAIL_COUNT=0

check_absent() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[FAIL] ${label} still exists"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo "[OK]   ${label} removed"
  fi
}

check_absent "State bucket ${STATE_BUCKET_NAME}" aws s3api head-bucket --bucket "${STATE_BUCKET_NAME}" --region "${AWS_REGION}"
check_absent "Lock table ${LOCK_TABLE_NAME}" aws dynamodb describe-table --table-name "${LOCK_TABLE_NAME}" --region "${AWS_REGION}"
check_absent "Backend role ${ROLE_NAME}" aws iam get-role --role-name "${ROLE_NAME}"

if [[ "${CREATE_SECRET_MANAGER}" == "true" ]]; then
  check_absent "Secret ${SECRET_NAME}" aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --region "${AWS_REGION}"
fi

if [[ "${CREATE_SSM}" == "true" ]]; then
  check_absent "SSM document ${SSM_DOCUMENT_NAME}" aws ssm get-document --name "${SSM_DOCUMENT_NAME}" --region "${AWS_REGION}"
fi

if [[ "${CREATE_PARAMETER_STORE}" == "true" ]]; then
  for p in "${PARAMETERS[@]}"; do
    check_absent "SSM parameter ${p}" aws ssm get-parameter --name "${p}" --region "${AWS_REGION}"
  done
fi

if [[ "${CREATE_CLOUDTRAIL}" == "true" ]]; then
  check_absent "CloudTrail ${CLOUDTRAIL_NAME}" aws cloudtrail get-trail --name "${CLOUDTRAIL_NAME}" --region "${AWS_REGION}"
  check_absent "CloudTrail log bucket ${CLOUDTRAIL_LOG_BUCKET}" aws s3api head-bucket --bucket "${CLOUDTRAIL_LOG_BUCKET}" --region "${AWS_REGION}"
  CLOUDTRAIL_LOG_GROUP_COUNT="$(aws logs describe-log-groups --log-group-name-prefix "${CLOUDTRAIL_LOG_GROUP}" --region "${AWS_REGION}" --query "length(logGroups[?logGroupName=='${CLOUDTRAIL_LOG_GROUP}'])" --output text 2>/dev/null || true)"
  if [[ "${CLOUDTRAIL_LOG_GROUP_COUNT}" == "0" || -z "${CLOUDTRAIL_LOG_GROUP_COUNT}" || "${CLOUDTRAIL_LOG_GROUP_COUNT}" == "None" ]]; then
    echo "[OK]   CloudWatch log group ${CLOUDTRAIL_LOG_GROUP} removed"
  else
    echo "[FAIL] CloudWatch log group ${CLOUDTRAIL_LOG_GROUP} still exists"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  check_absent "CloudTrail CW role ${CLOUDTRAIL_CW_ROLE_NAME}" aws iam get-role --role-name "${CLOUDTRAIL_CW_ROLE_NAME}"
fi

if [[ "${CREATE_BACKEND_KMS}" == "true" ]]; then
  check_absent "KMS alias ${BACKEND_KMS_ALIAS}" aws kms describe-key --key-id "${BACKEND_KMS_ALIAS}" --region "${AWS_REGION}"
fi

if [[ "${CREATE_STATE_KMS}" == "true" ]]; then
  check_absent "KMS alias ${STATE_KMS_ALIAS}" aws kms describe-key --key-id "${STATE_KMS_ALIAS}" --region "${AWS_REGION}"
fi

echo
if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "Done with ${FAIL_COUNT} verification failure(s)." >&2
  exit 1
fi

echo "Done. Target resources and related state files were removed."
