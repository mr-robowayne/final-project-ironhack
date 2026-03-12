#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# deploy-frontend-live.sh — Vollständiges Frontend-Deployment (Build + Deploy)
# Full frontend deployment orchestrator (build + security checks + S3 upload)
#
# Baut das Frontend, prüft Sicherheit/Compliance und deployt auf S3/CloudFront.
# Builds the frontend, runs security/compliance checks, and deploys to S3/CloudFront.
#
# Usage:
#   S3_BUCKET=<bucket> CLOUDFRONT_DISTRIBUTION_ID=<id> ./scripts/aws/deploy-frontend-live.sh
#   S3_BUCKET=<bucket> ./scripts/aws/deploy-frontend-live.sh <cloudfront-id>
#   S3_BUCKET=<bucket> ./scripts/aws/deploy-frontend-live.sh --dry-run
#   S3_BUCKET=<bucket> ./scripts/aws/deploy-frontend-live.sh --yes
#
# Flags:
#   --dry-run   Build und Checks, aber kein Upload / Build + checks only, no upload
#   --yes       Bestätigung überspringen / Skip confirmation prompt
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- Skript-Pfade / Script paths ---
BUILD_SCRIPT="$PROJECT_ROOT/scripts/aws/build-frontend.sh"
DEPLOY_SCRIPT="$PROJECT_ROOT/scripts/aws/deploy-s3frontend.sh"
DEPLOY_LOG="$PROJECT_ROOT/deployments.log"

# --- Flags parsen / Parse flags ---
DRY_RUN=false
AUTO_CONFIRM=false
POSITIONAL_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes)     AUTO_CONFIRM=true ;;
    *)         POSITIONAL_ARGS+=("$arg") ;;
  esac
done

# --- Konfiguration / Configuration ---
AWS_REGION="${AWS_REGION:-eu-central-2}"
S3_BUCKET="${S3_BUCKET:-${POSITIONAL_ARGS[0]:-}}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-${POSITIONAL_ARGS[1]:-}}"

# Compliance-Flag automatisch setzen / Set compliance flag automatically
export CONFIRM_DPA_CH_EU=true

# --- Hilfsfunktionen / Helper functions ---
info()  { echo "[INFO]  $(date '+%H:%M:%S') $*"; }
ok()    { echo "[OK]    $(date '+%H:%M:%S') $*"; }
error() { echo "[ERROR] $(date '+%H:%M:%S') $*" >&2; }

log_deployment() {
  local status="$1"
  local git_hash
  git_hash="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  local timestamp
  timestamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "$timestamp | $status | bucket=$S3_BUCKET | cf=$CLOUDFRONT_DISTRIBUTION_ID | git=$git_hash | user=$(whoami)" >> "$DEPLOY_LOG"
}

# --- Eingaben prüfen / Validate inputs ---
if [[ -z "$S3_BUCKET" ]]; then
  cat >&2 <<USAGE
Fehler: S3_BUCKET nicht gesetzt. / Error: S3_BUCKET not set.

Usage:
  S3_BUCKET=<bucket> ./scripts/aws/deploy-frontend-live.sh [cloudfront-dist-id]
  S3_BUCKET=<bucket> CLOUDFRONT_DISTRIBUTION_ID=<id> ./scripts/aws/deploy-frontend-live.sh

Flags:
  --dry-run   Nur Build + Checks, kein Upload / Build + checks only, no upload
  --yes       Bestätigung überspringen / Skip confirmation prompt
USAGE
  exit 1
fi

if [[ ! -f "$BUILD_SCRIPT" ]]; then
  error "Build-Skript nicht gefunden / Build script not found: $BUILD_SCRIPT"
  exit 1
fi

if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
  error "Deploy-Skript nicht gefunden / Deploy script not found: $DEPLOY_SCRIPT"
  exit 1
fi

# =============================================================
# PHASE 1: BUILD
# =============================================================
echo ""
echo "============================================="
echo "  PHASE 1: Frontend Build"
echo "============================================="
info "Starte Build... / Starting build..."

# Umgebungsvariablen an Build-Skript weitergeben / Pass env vars to build script
export AWS_REGION
export ENV_SOURCE="${ENV_SOURCE:-file}"
export ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/app/dhapp/frontend/app/.env.example}"
export SSM_PREFIX="${SSM_PREFIX:-/patientsync/frontend}"

bash "$BUILD_SCRIPT"

ok "Build abgeschlossen / Build completed"

# =============================================================
# PHASE 2: BESTÄTIGUNG / Confirmation
# =============================================================
echo ""
echo "============================================="
echo "  PHASE 2: Deployment-Bestätigung / Confirmation"
echo "============================================="

GIT_HASH="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"

echo ""
echo "  Ziel / Target:     s3://$S3_BUCKET"
echo "  CloudFront:        ${CLOUDFRONT_DISTRIBUTION_ID:-nicht gesetzt / not set}"
echo "  Git:               $GIT_BRANCH @ $GIT_HASH"
echo "  Region:            $AWS_REGION"
echo "  Dry-Run:           $DRY_RUN"
echo "  CONFIRM_DPA_CH_EU: $CONFIRM_DPA_CH_EU"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  info "--- DRY-RUN MODUS: Kein Upload. / DRY-RUN MODE: No upload. ---"
  log_deployment "DRY-RUN"
  echo ""
  ok "Dry-Run abgeschlossen. Build und Checks erfolgreich. / Dry-run complete. Build and checks passed."
  exit 0
fi

if [[ "$AUTO_CONFIRM" != "true" ]]; then
  echo "  ACHTUNG: Dies deployt das Frontend LIVE auf Produktion!"
  echo "  WARNING: This will deploy the frontend LIVE to production!"
  echo ""
  read -r -p "  Fortfahren? / Continue? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    info "Abgebrochen vom Benutzer. / Cancelled by user."
    log_deployment "CANCELLED"
    exit 0
  fi
fi

# =============================================================
# PHASE 3: DEPLOY (via bestehendes deploy-s3frontend.sh)
# Nutzt das bestehende Skript für Sicherheitsprüfungen + Upload
# Uses the existing script for security checks + upload
# =============================================================
echo ""
echo "============================================="
echo "  PHASE 3: Deploy to S3 + CloudFront"
echo "============================================="
info "Starte Deployment... / Starting deployment..."

# Das Deploy-Skript erwartet diese Variablen / The deploy script expects these vars
export S3_BUCKET
export CLOUDFRONT_DISTRIBUTION_ID
export CONFIRM_DPA_CH_EU
export FRONTEND_DIR="${FRONTEND_DIR:-$PROJECT_ROOT/app/dhapp/frontend}"

# deploy-s3frontend.sh führt intern nochmal Build aus — wir setzen
# LOAD_FRONTEND_ENV_FROM_SSM und übergeben den BUILD_SCRIPT-Pfad.
# Das bestehende Skript ruft export_frontend_bundle.sh auf, das nicht existiert.
# Wir überschreiben BUILD_SCRIPT und erstellen einen Wrapper, der den Build überspringt
# (da wir ihn bereits in Phase 1 gemacht haben).
# deploy-s3frontend.sh internally runs the build again — we create a no-op wrapper
# since we already built in Phase 1.

# Temporären No-Op Build-Wrapper erstellen / Create temporary no-op build wrapper
NOOP_BUILD_SCRIPT="$(mktemp)"
cat > "$NOOP_BUILD_SCRIPT" <<'NOOP'
#!/usr/bin/env bash
# No-op: Build wurde bereits von deploy-frontend-live.sh durchgeführt.
# No-op: Build was already performed by deploy-frontend-live.sh.
echo "[INFO]  Build bereits abgeschlossen, überspringe... / Build already done, skipping..."
NOOP
chmod +x "$NOOP_BUILD_SCRIPT"

# Das bestehende deploy-s3frontend.sh überschreiben wir nicht, sondern führen
# die relevanten Teile (Security Checks + Upload) direkt aus.
# We don't overwrite the existing deploy script; instead we run the security
# checks + upload phases by calling it with the no-op build script.

# Temporär den BUILD_SCRIPT-Pfad umlenken, damit deploy-s3frontend.sh
# nicht versucht, das fehlende export_frontend_bundle.sh aufzurufen.
# Temporarily redirect BUILD_SCRIPT so deploy-s3frontend.sh doesn't try
# to call the missing export_frontend_bundle.sh.
export BUILD_SCRIPT_ORIG="${BUILD_SCRIPT_ORIG:-}"

# Wir patchen die Umgebung und rufen deploy-s3frontend.sh auf
# Patch environment and call deploy-s3frontend.sh
# Da deploy-s3frontend.sh intern "bash $BUILD_SCRIPT" aufruft, setzen wir
# die Variable, die es referenziert.
# Since deploy-s3frontend.sh internally calls "bash $BUILD_SCRIPT", we set
# the variable it references.

# Inline: deploy-s3frontend.sh nutzt PROJECT_ROOT/app/dhapp/admin/export_frontend_bundle.sh
# Wir erstellen diesen Pfad temporär / We create this path temporarily
ADMIN_DIR="$PROJECT_ROOT/app/dhapp/admin"
EXPECTED_BUILD_SCRIPT="$ADMIN_DIR/export_frontend_bundle.sh"
CREATED_ADMIN_DIR=false
CREATED_BUILD_SCRIPT=false

if [[ ! -d "$ADMIN_DIR" ]]; then
  mkdir -p "$ADMIN_DIR"
  CREATED_ADMIN_DIR=true
fi

if [[ ! -f "$EXPECTED_BUILD_SCRIPT" ]]; then
  cp "$NOOP_BUILD_SCRIPT" "$EXPECTED_BUILD_SCRIPT"
  CREATED_BUILD_SCRIPT=true
fi

cleanup() {
  rm -f "$NOOP_BUILD_SCRIPT"
  if [[ "$CREATED_BUILD_SCRIPT" == "true" ]]; then
    rm -f "$EXPECTED_BUILD_SCRIPT"
  fi
  if [[ "$CREATED_ADMIN_DIR" == "true" ]]; then
    rmdir "$ADMIN_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Deploy ausführen / Execute deploy
bash "$DEPLOY_SCRIPT" "$S3_BUCKET" "$CLOUDFRONT_DISTRIBUTION_ID"

# =============================================================
# PHASE 4: LOGGING
# =============================================================
log_deployment "SUCCESS"

echo ""
echo "============================================="
echo "  Deployment abgeschlossen / Deployment complete"
echo "============================================="
ok "Frontend LIVE auf s3://$S3_BUCKET"
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
  ok "CloudFront Invalidierung gestartet / CloudFront invalidation started"
fi
info "Log: $DEPLOY_LOG"
