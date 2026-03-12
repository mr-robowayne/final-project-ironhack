#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Konfiguration
BUILD_SCRIPT="$PROJECT_ROOT/app/dhapp/admin/export_frontend_bundle.sh"
FRONTEND_DIR="${FRONTEND_DIR:-$PROJECT_ROOT/app/dhapp/frontend}"
AWS_REGION="${AWS_REGION:-eu-central-2}"
S3_BUCKET="${S3_BUCKET:-${1:-}}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-${2:-}}"

# Build Info File Location (vom Build-Skript generiert)
if [[ -z "${BUILD_INFO_FILE:-}" ]]; then
  if [[ -f "$FRONTEND_DIR/BUILD_INFO.txt" ]]; then
    BUILD_INFO_FILE="$FRONTEND_DIR/BUILD_INFO.txt"
  else
    BUILD_INFO_FILE="$PROJECT_ROOT/app/dhapp/admin/BUILD_INFO_FRONTEND.txt"
  fi
fi

# Security & Compliance Flags (können via ENV gesetzt werden)
CONFIRM_DPA_CH_EU="${CONFIRM_DPA_CH_EU:-false}"
CONFIRM_CLOUDFRONT_LOGGING="${CONFIRM_CLOUDFRONT_LOGGING:-false}"

if [[ -z "$S3_BUCKET" ]]; then
  cat >&2 <<USAGE
Usage:
  S3_BUCKET=<bucket> ./scripts/deploy-s3frontend.sh [cloudfront-dist-id]
  S3_BUCKET=<bucket> CLOUDFRONT_DISTRIBUTION_ID=<id> ./scripts/deploy-s3frontend.sh
USAGE
  exit 1
fi

for cmd in aws; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[NO-GO] Missing required command: $cmd" >&2
    exit 1
  fi
done

# Check for ripgrep (faster) or fallback to grep
if command -v rg >/dev/null 2>&1; then HAS_RG=true; else HAS_RG=false; fi

search_file() {
  if [[ "$HAS_RG" == "true" ]]; then rg -n -i "$1" "$2" || true; else grep -nEi "$1" "$2" || true; fi
}

search_dir_files() {
  if [[ "$HAS_RG" == "true" ]]; then rg -l -i "$1" "$2" || true; else grep -RIlEi "$1" "$2" || true; fi
}

FAIL_COUNT=0
WARN_COUNT=0
pass() { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { echo "[FAIL] $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ---------------------------------------------------------
# 1. BUILD PHASE
# ---------------------------------------------------------
echo "🚀 Phase 1: Building Frontend..."
export LOAD_FRONTEND_ENV_FROM_SSM=true
bash "$BUILD_SCRIPT"

# ---------------------------------------------------------
# 2. SECURITY PREFLIGHT CHECKS
# ---------------------------------------------------------
echo ""
echo "🔍 Phase 2: Security & Compliance Checks..."

# 2a) Build Artefakte
[[ -f "$FRONTEND_DIR/index.html" ]] && pass "index.html present" || fail "index.html missing"
[[ -d "$FRONTEND_DIR/static" ]] && pass "static/ present" || fail "static/ missing"

# 2b) Secret Scanning in Build Info
if [[ -f "$BUILD_INFO_FILE" ]]; then
  dev_non_empty="$(search_file '^REACT_APP_DEV_[A-Z0-9_]+=.+$' "$BUILD_INFO_FILE")"
  if [[ -n "$dev_non_empty" ]]; then fail "REACT_APP_DEV_* must be empty in Production!"; else pass "REACT_APP_DEV_* clean"; fi
  
  secret_hits="$(search_file 'AKIA|SECRET|TOKEN|PASSWORD|PRIVATE KEY|OPENAI|JWT' "$BUILD_INFO_FILE")"
  if [[ -n "$secret_hits" ]]; then fail "Potential secret found in BUILD_INFO"; else pass "BUILD_INFO clean"; fi
else
  fail "BUILD_INFO file missing (Build script failed?)"
fi

# 2c) Secret Scanning in Bundle (ignoring React internals)
bundle_hits="$(search_dir_files 'AKIA|SECRET|TOKEN|PASSWORD|PRIVATE KEY|OPENAI|JWT' "$FRONTEND_DIR" | sort -u || true)"
if [[ -n "$bundle_hits" ]]; then
  real_hits=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if grep -q "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED" "$f" 2>/dev/null; then continue; fi
    real_hits+="$f"$'\n'
  done <<< "$bundle_hits"
  
  if [[ -n "$real_hits" ]]; then fail "Secrets found in frontend bundle!"; echo "$real_hits"; else pass "Bundle secret scan passed"; fi
else
  pass "Bundle secret scan passed"
fi

# 2d) S3 Security Posture
# Note: S3 website-hosting buckets may intentionally have public access.
# These checks warn rather than fail to avoid blocking deploys for infra-level settings.
bucket_bpa="$(aws s3api get-public-access-block --bucket "$S3_BUCKET" --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' --output text 2>/dev/null || true)"
if [[ "$bucket_bpa" == "True	True	True	True" || "$bucket_bpa" == "True True True True" ]]; then
  pass "S3 Block Public Access enabled"
else
  warn "S3 Block Public Access NOT fully enabled on $S3_BUCKET (expected for website-hosting buckets)"
fi

is_public="$(aws s3api get-bucket-policy-status --bucket "$S3_BUCKET" --query 'PolicyStatus.IsPublic' --output text 2>/dev/null || true)"
[[ "$is_public" == "False" ]] && pass "Bucket policy is private" || warn "Bucket policy is public (expected for S3 website-hosting)"

enc_alg="$(aws s3api get-bucket-encryption --bucket "$S3_BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null || true)"
if [[ "$enc_alg" == "aws:kms" ]]; then pass "S3 SSE-KMS Encryption enabled"; elif [[ "$enc_alg" == "AES256" ]]; then warn "S3 using SSE-S3 (AES256). KMS preferred."; else warn "S3 default encryption not configured — consider enabling SSE"; fi

# 2e) CloudFront Security
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
  default_vpp="$(aws cloudfront get-distribution-config --id "$CLOUDFRONT_DISTRIBUTION_ID" --query 'DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy' --output text)"
  if [[ "$default_vpp" == "redirect-to-https" || "$default_vpp" == "https-only" ]]; then
    pass "CloudFront enforces HTTPS"
  else
    fail "CloudFront allows HTTP!"
  fi
else
  warn "No CloudFront Distribution ID — HTTPS check skipped"
fi

# 2f) Compliance Confirmation
if [[ "$CONFIRM_DPA_CH_EU" == "true" ]]; then
  pass "Data Protection (DPA/CH/EU) confirmed"
else
  fail "Missing compliance confirmation (CONFIRM_DPA_CH_EU=true)"
fi

echo "Summary: ${FAIL_COUNT} FAIL, ${WARN_COUNT} WARN"
if (( FAIL_COUNT > 0 )); then
  echo "❌ ABORTING: Critical security checks failed."
  exit 1
fi

echo "✅ GO: All checks passed."

# ---------------------------------------------------------
# 3. UPLOAD (Smart Caching Strategy)
# ---------------------------------------------------------
echo ""
echo "☁️  Phase 3: Uploading to S3 ($S3_BUCKET)..."

# Strategie:
# 1. "static/" Ordner (JS/CSS mit Hash im Namen) -> Cache für immer (1 Jahr)
# 2. Rest (index.html, etc.) -> Kein Caching (damit Updates sofort sichtbar sind)

if [[ -d "$FRONTEND_DIR/static" ]]; then
  aws s3 sync "$FRONTEND_DIR/static" "s3://$S3_BUCKET/static" \
    --delete \
    --exclude "*.map" \
    --sse AES256 \
    --cache-control "public,max-age=31536000,immutable"
fi

aws s3 sync "$FRONTEND_DIR" "s3://$S3_BUCKET" \
  --delete \
  --exclude "static/*" \
  --exclude "*.map" \
  --exclude "BUILD_INFO.txt" \
  --sse AES256 \
  --cache-control "no-cache,no-store,must-revalidate"

# Expliziter Upload von Entry-Points (Sicherstellen, dass Cache-Control stimmt)
for f in index.html manifest.json asset-manifest.json; do
  if [[ -f "$FRONTEND_DIR/$f" ]]; then
    aws s3 cp "$FRONTEND_DIR/$f" "s3://$S3_BUCKET/$f" \
      --sse AES256 \
      --cache-control "no-cache,no-store,must-revalidate"
  fi
done

# Cleanup (Sicherheit)
aws s3 rm "s3://$S3_BUCKET/BUILD_INFO.txt" >/dev/null 2>&1 || true
aws s3 rm "s3://$S3_BUCKET/static" --recursive --exclude "*" --include "*.map" >/dev/null 2>&1 || true

# ---------------------------------------------------------
# 4. INVALIDATION
# ---------------------------------------------------------
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "🔄 Phase 4: Invalidating CloudFront..."
    aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*" >/dev/null
else
    echo "⚠️  No CloudFront Distribution ID provided. Skipping invalidation."
fi

echo "✅ SUCCESS: Frontend deployed & live!"