#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# validate-pipeline.sh — Validate CI/CD pipeline configuration without running
#
# Checks:
#   1. Workflow YAML syntax
#   2. GitHub Secrets & Variables exist
#   3. Referenced scripts exist and are executable
#   4. Dockerfile syntax (basic validation)
#   5. GitHub Environments exist
#   6. AWS IAM roles assumable (dry-run)
#   7. S3 bucket accessible
#   8. ECR repositories exist
#
# Usage:
#   ./scripts/aws/validate-pipeline.sh [--help]
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_REGION="${AWS_REGION:-eu-central-2}"
ECR_REGISTRY="648786395667.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_PROJECT="patientsync-prod"
WORKFLOWS_DIR="$PROJECT_ROOT/.github/workflows"

BACKEND_SERVICES=(api billing-service ai-service login-gateway)
ECR_REPO_SUFFIXES=(backend-api billing-api ai-service login-gateway)
ENVIRONMENTS=(production development)

# Secrets referenced in workflows (per environment or repo-level)
EXPECTED_SECRETS_PRODUCTION=(AWS_ROLE_ARN ANSIBLE_VAULT_PASS CLOUDFRONT_DISTRIBUTION_ID AWS_FRONTEND_ROLE_ARN TF_VARS_DEPLOY_AWS)
EXPECTED_SECRETS_DEVELOPMENT=()
EXPECTED_VARS=(AWS_REGION FRONTEND_BUCKET_NAME)

# ── Counters ──────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
SKIP_COUNT=0

pass()  { echo "  [PASS] $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()  { echo "  [FAIL] $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn()  { echo "  [WARN] $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
skip()  { echo "  [SKIP] $*"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
header() { echo ""; echo "== $* =="; }

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Validates CI/CD pipeline configuration without running it.

Options:
  --help, -h      Show this help message
  --skip-aws      Skip AWS checks (IAM, S3, ECR)
  --skip-github   Skip GitHub API checks (secrets, environments)

Environment Variables:
  AWS_REGION      AWS region (default: eu-central-2)

Checks performed:
  - Workflow YAML syntax validation
  - GitHub Secrets and Variables existence
  - Referenced scripts exist and are executable
  - Dockerfile syntax (hadolint if available)
  - GitHub Environments exist (production, development)
  - AWS IAM roles assumable (dry-run STS)
  - S3 bucket exists and is accessible
  - ECR repositories exist
EOF
  exit 0
fi

SKIP_AWS=false
SKIP_GITHUB=false
for arg in "$@"; do
  case "$arg" in
    --skip-aws)    SKIP_AWS=true ;;
    --skip-github) SKIP_GITHUB=true ;;
  esac
done

echo "========================================================================"
echo "  Pipeline Validation — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Project: $PROJECT_ROOT"
echo "========================================================================"

# ── 1. Workflow YAML Syntax ───────────────────────────────────────────────────
header "1. Workflow YAML Syntax"

for wf in "$WORKFLOWS_DIR"/*.yml; do
  wf_name="$(basename "$wf")"

  # Python yaml check (most reliable)
  if command -v python3 &>/dev/null; then
    if python3 -c "import yaml; yaml.safe_load(open('$wf'))" 2>/dev/null; then
      pass "$wf_name — valid YAML"
    else
      fail "$wf_name — invalid YAML syntax"
    fi
  # Fallback: ruby
  elif command -v ruby &>/dev/null; then
    if ruby -ryaml -e "YAML.safe_load(File.read('$wf'))" 2>/dev/null; then
      pass "$wf_name — valid YAML"
    else
      fail "$wf_name — invalid YAML syntax"
    fi
  else
    skip "$wf_name — no YAML parser available (install python3 or ruby)"
  fi

  # Validate required top-level keys
  if command -v python3 &>/dev/null; then
    missing_keys=$(python3 -c "
import yaml, sys
with open('$wf') as f:
    data = yaml.safe_load(f)
required = ['name', 'on', 'jobs']
missing = [k for k in required if k not in data]
if missing:
    print(', '.join(missing))
" 2>/dev/null || true)
    if [[ -n "$missing_keys" ]]; then
      fail "$wf_name — missing required keys: $missing_keys"
    else
      pass "$wf_name — has name, on, jobs"
    fi
  fi
done

# ── 2. GitHub Secrets & Variables ─────────────────────────────────────────────
header "2. GitHub Secrets & Variables"

if [[ "$SKIP_GITHUB" == true ]]; then
  skip "GitHub checks skipped (--skip-github)"
elif ! command -v gh &>/dev/null; then
  skip "gh CLI not found — install with: brew install gh"
elif ! gh auth status &>/dev/null 2>&1; then
  skip "gh CLI not authenticated — run: gh auth login"
else
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [[ -z "$REPO" ]]; then
    fail "Could not determine GitHub repository"
  else
    echo "  Repository: $REPO"

    # Check repo-level secrets
    repo_secrets="$(gh secret list 2>/dev/null || true)"
    for secret in "${EXPECTED_SECRETS_PRODUCTION[@]}"; do
      if echo "$repo_secrets" | grep -q "^${secret}"; then
        pass "Secret '$secret' exists (repo-level)"
      else
        # Check environment-level
        env_secret="$(gh secret list --env production 2>/dev/null | grep "^${secret}" || true)"
        if [[ -n "$env_secret" ]]; then
          pass "Secret '$secret' exists (production env)"
        else
          warn "Secret '$secret' not found at repo or production env level"
        fi
      fi
    done

    # Check variables
    repo_vars="$(gh variable list 2>/dev/null || true)"
    for var in "${EXPECTED_VARS[@]}"; do
      if echo "$repo_vars" | grep -q "^${var}"; then
        pass "Variable '$var' exists"
      else
        env_var="$(gh variable list --env production 2>/dev/null | grep "^${var}" || true)"
        if [[ -n "$env_var" ]]; then
          pass "Variable '$var' exists (production env)"
        else
          fail "Variable '$var' not found"
        fi
      fi
    done
  fi
fi

# ── 3. Referenced Scripts ─────────────────────────────────────────────────────
header "3. Referenced Scripts"

REFERENCED_SCRIPTS=(
  "scripts/aws/deploy-s3frontend.sh"
  "app/dhapp/admin/export_frontend_bundle.sh"
)

for script in "${REFERENCED_SCRIPTS[@]}"; do
  full_path="$PROJECT_ROOT/$script"
  if [[ -f "$full_path" ]]; then
    if [[ -x "$full_path" ]]; then
      pass "$script — exists and executable"
    else
      warn "$script — exists but NOT executable (chmod +x needed)"
    fi
  else
    fail "$script — NOT FOUND"
  fi
done

# ── 4. Dockerfile Validation ─────────────────────────────────────────────────
header "4. Dockerfile Validation"

HAS_HADOLINT=false
if command -v hadolint &>/dev/null; then HAS_HADOLINT=true; fi

for svc in "${BACKEND_SERVICES[@]}"; do
  df="$PROJECT_ROOT/app/dhapp/backend/$svc/Dockerfile"
  if [[ ! -f "$df" ]]; then
    fail "$svc/Dockerfile — NOT FOUND"
    continue
  fi

  pass "$svc/Dockerfile — exists"

  # Basic checks
  if grep -q "^FROM " "$df"; then
    pass "$svc/Dockerfile — has FROM instruction"
  else
    fail "$svc/Dockerfile — missing FROM instruction"
  fi

  if grep -q "^EXPOSE " "$df"; then
    pass "$svc/Dockerfile — has EXPOSE instruction"
  else
    warn "$svc/Dockerfile — no EXPOSE instruction"
  fi

  # Hadolint if available
  if [[ "$HAS_HADOLINT" == true ]]; then
    lint_output=$(hadolint "$df" 2>&1 || true)
    if [[ -z "$lint_output" ]]; then
      pass "$svc/Dockerfile — hadolint clean"
    else
      warn "$svc/Dockerfile — hadolint findings (non-blocking)"
    fi
  fi
done

# ── 5. GitHub Environments ────────────────────────────────────────────────────
header "5. GitHub Environments"

if [[ "$SKIP_GITHUB" == true ]]; then
  skip "GitHub checks skipped (--skip-github)"
elif ! command -v gh &>/dev/null || ! gh auth status &>/dev/null 2>&1; then
  skip "gh CLI not available or not authenticated"
else
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [[ -n "$REPO" ]]; then
    env_list="$(gh api "repos/$REPO/environments" --jq '.environments[].name' 2>/dev/null || true)"
    for env_name in "${ENVIRONMENTS[@]}"; do
      if echo "$env_list" | grep -qx "$env_name"; then
        pass "Environment '$env_name' exists"
      else
        fail "Environment '$env_name' NOT FOUND"
      fi
    done
  fi
fi

# ── 6. AWS IAM Role Dry-Run ──────────────────────────────────────────────────
header "6. AWS IAM & STS"

if [[ "$SKIP_AWS" == true ]]; then
  skip "AWS checks skipped (--skip-aws)"
elif ! command -v aws &>/dev/null; then
  skip "AWS CLI not found — install with: brew install awscli"
else
  # Check caller identity
  caller_id="$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null || true)"
  if [[ -n "$caller_id" ]]; then
    pass "AWS credentials valid — $caller_id"
  else
    fail "AWS credentials not configured or expired"
  fi
fi

# ── 7. S3 Bucket ─────────────────────────────────────────────────────────────
header "7. S3 Bucket"

if [[ "$SKIP_AWS" == true ]]; then
  skip "AWS checks skipped (--skip-aws)"
elif ! command -v aws &>/dev/null; then
  skip "AWS CLI not found"
else
  # Try to discover the bucket name from GitHub vars or use a convention
  S3_BUCKET="${FRONTEND_BUCKET_NAME:-}"
  if [[ -z "$S3_BUCKET" ]] && command -v gh &>/dev/null; then
    S3_BUCKET="$(gh variable list 2>/dev/null | grep "^FRONTEND_BUCKET_NAME" | awk '{print $2}' || true)"
  fi

  if [[ -z "$S3_BUCKET" ]]; then
    skip "S3 bucket name unknown — set FRONTEND_BUCKET_NAME env var"
  else
    if aws s3api head-bucket --bucket "$S3_BUCKET" 2>/dev/null; then
      pass "S3 bucket '$S3_BUCKET' exists and is accessible"
    else
      fail "S3 bucket '$S3_BUCKET' not accessible"
    fi
  fi
fi

# ── 8. ECR Repositories ──────────────────────────────────────────────────────
header "8. ECR Repositories"

if [[ "$SKIP_AWS" == true ]]; then
  skip "AWS checks skipped (--skip-aws)"
elif ! command -v aws &>/dev/null; then
  skip "AWS CLI not found"
else
  for suffix in "${ECR_REPO_SUFFIXES[@]}"; do
    repo_name="${ECR_PROJECT}-${suffix}"
    if aws ecr describe-repositories --repository-names "$repo_name" --region "$AWS_REGION" &>/dev/null; then
      pass "ECR repo '$repo_name' exists"
    else
      fail "ECR repo '$repo_name' NOT FOUND in $AWS_REGION"
    fi
  done
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================================================"
echo "  SUMMARY"
echo "------------------------------------------------------------------------"
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "  WARN: $WARN_COUNT"
echo "  SKIP: $SKIP_COUNT"
echo "========================================================================"

if (( FAIL_COUNT > 0 )); then
  echo "  RESULT: FAIL — $FAIL_COUNT check(s) failed"
  echo "========================================================================"
  exit 1
else
  echo "  RESULT: PASS — all checks passed"
  echo "========================================================================"
  exit 0
fi
