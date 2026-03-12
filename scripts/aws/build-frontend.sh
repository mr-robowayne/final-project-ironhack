#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# build-frontend.sh — Standalone Frontend Build (ohne Docker)
# Standalone frontend build script (without Docker)
#
# Baut das React-Frontend lokal, führt Sicherheitsprüfungen durch und
# generiert BUILD_INFO.txt.
# Builds the React frontend locally, runs security checks, and generates
# BUILD_INFO.txt.
#
# Usage:
#   ./scripts/aws/build-frontend.sh                  # Env from .env.example
#   ENV_SOURCE=ssm ./scripts/aws/build-frontend.sh   # Env from AWS SSM
#   ENV_SOURCE=file ENV_FILE=/path/to/.env ./scripts/aws/build-frontend.sh
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- Konfiguration / Configuration ---
FRONTEND_APP_DIR="$PROJECT_ROOT/app/dhapp/frontend/app"
FRONTEND_BUILD_DIR="$FRONTEND_APP_DIR/build"
# Ausgabeverzeichnis für deploy-s3frontend.sh (muss dort liegen, wo der Deploy es erwartet)
# Output directory for deploy-s3frontend.sh (must match what the deploy script expects)
FRONTEND_DEPLOY_DIR="${FRONTEND_DIR:-$PROJECT_ROOT/app/dhapp/frontend}"
AWS_REGION="${AWS_REGION:-eu-central-2}"
ENV_SOURCE="${ENV_SOURCE:-file}"       # "file" oder "ssm"
ENV_FILE="${ENV_FILE:-$FRONTEND_APP_DIR/.env.example}"
SSM_PREFIX="${SSM_PREFIX:-/patientsync/frontend}"

# --- Hilfsfunktionen / Helper functions ---
FAIL_COUNT=0
info()  { echo "[INFO]  $*"; }
ok()    { echo "[OK]    $*"; }
fail()  { echo "[FAIL]  $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# Check for ripgrep (schneller) or fallback to grep
if command -v rg >/dev/null 2>&1; then HAS_RG=true; else HAS_RG=false; fi

search_file() {
  if [[ "$HAS_RG" == "true" ]]; then rg -n -i "$1" "$2" || true; else grep -nEi "$1" "$2" || true; fi
}

search_dir_files() {
  if [[ "$HAS_RG" == "true" ]]; then rg -l -i "$1" "$2" || true; else grep -RIlEi "$1" "$2" || true; fi
}

# ---------------------------------------------------------
# 1. VORAUSSETZUNGEN PRÜFEN / Check prerequisites
# ---------------------------------------------------------
info "Prüfe Voraussetzungen... / Checking prerequisites..."

for cmd in node npm git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Benötigter Befehl fehlt / Missing required command: $cmd"
  fi
done

if (( FAIL_COUNT > 0 )); then
  echo "Abbruch: Voraussetzungen nicht erfüllt. / Aborting: prerequisites not met."
  exit 1
fi

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
info "Node $NODE_VERSION, npm $NPM_VERSION"

if [[ ! -f "$FRONTEND_APP_DIR/package.json" ]]; then
  fail "package.json nicht gefunden in $FRONTEND_APP_DIR"
  exit 1
fi

# ---------------------------------------------------------
# 2. UMGEBUNGSVARIABLEN LADEN / Load environment variables
# ---------------------------------------------------------
info "Lade Umgebungsvariablen (Quelle: $ENV_SOURCE)... / Loading env vars (source: $ENV_SOURCE)..."

load_env_from_file() {
  local envfile="$1"
  if [[ ! -f "$envfile" ]]; then
    fail "Env-Datei nicht gefunden / Env file not found: $envfile"
    exit 1
  fi
  info "Lade Variablen aus / Loading vars from: $envfile"
  set -a
  # Nur REACT_APP_* Zeilen laden, Kommentare und leere Zeilen ignorieren
  # Only load REACT_APP_* lines, ignore comments and blank lines
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" == REACT_APP_* ]]; then
      export "$line"
    fi
  done < "$envfile"
  set +a
}

load_env_from_ssm() {
  if ! command -v aws >/dev/null 2>&1; then
    fail "AWS CLI fehlt, wird aber für SSM benötigt / AWS CLI missing, required for SSM"
    exit 1
  fi
  info "Lade Variablen aus SSM ($SSM_PREFIX)... / Loading vars from SSM ($SSM_PREFIX)..."

  local params
  params="$(aws ssm get-parameters-by-path \
    --path "$SSM_PREFIX" \
    --with-decryption \
    --region "$AWS_REGION" \
    --query 'Parameters[*].[Name,Value]' \
    --output text 2>/dev/null || true)"

  if [[ -z "$params" ]]; then
    fail "Keine SSM Parameter gefunden unter $SSM_PREFIX / No SSM parameters found under $SSM_PREFIX"
    exit 1
  fi

  while IFS=$'\t' read -r name value; do
    # /patientsync/frontend/REACT_APP_API_BASE -> REACT_APP_API_BASE
    local var_name="${name##*/}"
    export "$var_name=$value"
    info "  SSM -> $var_name"
  done <<< "$params"
}

case "$ENV_SOURCE" in
  file) load_env_from_file "$ENV_FILE" ;;
  ssm)  load_env_from_ssm ;;
  *)    fail "Unbekannte ENV_SOURCE: $ENV_SOURCE (erlaubt: file, ssm)"; exit 1 ;;
esac

# DEV-Variablen in Produktion leeren / Clear DEV vars for production
export REACT_APP_DEV_TENANT_ID=""
export REACT_APP_DEV_USER_ID=""

# ---------------------------------------------------------
# 3. NPM INSTALL & BUILD
# ---------------------------------------------------------
info "Installiere Abhängigkeiten (npm ci)... / Installing dependencies (npm ci)..."
cd "$FRONTEND_APP_DIR"
npm ci --no-audit --no-fund

info "Baue Frontend (npm run build)... / Building frontend (npm run build)..."
GENERATE_SOURCEMAP=false npm run build

if [[ ! -d "$FRONTEND_BUILD_DIR" ]]; then
  fail "Build-Verzeichnis nicht erstellt / Build directory not created: $FRONTEND_BUILD_DIR"
  exit 1
fi

ok "Build erfolgreich / Build successful: $FRONTEND_BUILD_DIR"

# ---------------------------------------------------------
# 4. BUILD-ARTEFAKTE AN DEPLOY-VERZEICHNIS KOPIEREN
#    Copy build artifacts to deploy directory
# ---------------------------------------------------------
info "Kopiere Build-Artefakte nach $FRONTEND_DEPLOY_DIR ... / Copying build artifacts..."

# Alte Artefakte entfernen (idempotent) / Remove old artifacts (idempotent)
rm -rf "$FRONTEND_DEPLOY_DIR/static"
rm -f  "$FRONTEND_DEPLOY_DIR/index.html"
rm -f  "$FRONTEND_DEPLOY_DIR/manifest.json"
rm -f  "$FRONTEND_DEPLOY_DIR/asset-manifest.json"

# Neue Artefakte kopieren / Copy new artifacts
cp -R "$FRONTEND_BUILD_DIR/"* "$FRONTEND_DEPLOY_DIR/"

ok "Artefakte kopiert / Artifacts copied"

# ---------------------------------------------------------
# 5. DSGVO / SICHERHEITSPRÜFUNGEN / Security checks
# ---------------------------------------------------------
info "Führe Sicherheitsprüfungen durch... / Running security checks..."

# 5a) Keine Source Maps im Build / No source maps in build
map_files="$(find "$FRONTEND_DEPLOY_DIR" -name '*.map' -type f 2>/dev/null || true)"
if [[ -n "$map_files" ]]; then
  fail "Source Maps gefunden! Werden entfernt... / Source maps found! Removing..."
  find "$FRONTEND_DEPLOY_DIR" -name '*.map' -type f -delete
  ok "Source Maps entfernt / Source maps removed"
else
  ok "Keine Source Maps vorhanden / No source maps present"
fi

# 5b) Keine Secrets im Bundle / No secrets in bundle
bundle_hits="$(search_dir_files 'AKIA|SECRET|TOKEN|PASSWORD|PRIVATE.KEY|OPENAI|JWT' "$FRONTEND_DEPLOY_DIR/static" 2>/dev/null | sort -u || true)"
if [[ -n "$bundle_hits" ]]; then
  real_hits=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # React-interne Referenzen ignorieren / Ignore React internal references
    if grep -q "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED" "$f" 2>/dev/null; then continue; fi
    real_hits+="$f"$'\n'
  done <<< "$bundle_hits"

  if [[ -n "$real_hits" ]]; then
    fail "Mögliche Secrets im Bundle gefunden! / Potential secrets found in bundle!"
    echo "$real_hits"
  else
    ok "Bundle Secret-Scan bestanden / Bundle secret scan passed"
  fi
else
  ok "Bundle Secret-Scan bestanden / Bundle secret scan passed"
fi

# 5c) Keine DEV-Variablen mit Werten / No DEV vars with values
for f in "$FRONTEND_DEPLOY_DIR"/static/js/*.js; do
  [[ -f "$f" ]] || continue
  if grep -qE 'REACT_APP_DEV_[A-Z_]+=.+' "$f" 2>/dev/null; then
    fail "REACT_APP_DEV_* Werte im JS-Bundle! / DEV vars found in JS bundle!"
    break
  fi
done

# ---------------------------------------------------------
# 6. BUILD_INFO.txt GENERIEREN / Generate BUILD_INFO.txt
# ---------------------------------------------------------
GIT_HASH="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
GIT_BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BUILD_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
BUILD_ENV="${DEPLOY_ENV:-production}"

BUILD_INFO_FILE="$FRONTEND_DEPLOY_DIR/BUILD_INFO.txt"
cat > "$BUILD_INFO_FILE" <<EOF
BUILD_DATE=$BUILD_DATE
GIT_HASH=$GIT_HASH
GIT_BRANCH=$GIT_BRANCH
BUILD_ENV=$BUILD_ENV
NODE_VERSION=$NODE_VERSION
NPM_VERSION=$NPM_VERSION
REACT_APP_API_BASE=${REACT_APP_API_BASE:-}
REACT_APP_API_URL=${REACT_APP_API_URL:-}
REACT_APP_DEFAULT_TENANT=${REACT_APP_DEFAULT_TENANT:-}
REACT_APP_CHAT_NOTIFICATION_PREVIEW=${REACT_APP_CHAT_NOTIFICATION_PREVIEW:-}
REACT_APP_DEV_TENANT_ID=${REACT_APP_DEV_TENANT_ID:-}
REACT_APP_DEV_USER_ID=${REACT_APP_DEV_USER_ID:-}
EOF

ok "BUILD_INFO.txt generiert / BUILD_INFO.txt generated: $BUILD_INFO_FILE"

# ---------------------------------------------------------
# 7. ZUSAMMENFASSUNG / Summary
# ---------------------------------------------------------
echo ""
if (( FAIL_COUNT > 0 )); then
  echo "--- ERGEBNIS / RESULT: $FAIL_COUNT FEHLER / FAILURES ---"
  echo "Build abgeschlossen, aber mit Problemen. / Build completed with issues."
  exit 1
else
  echo "--- ERGEBNIS / RESULT: Build erfolgreich / Build successful ---"
  echo "Artefakte in / Artifacts in: $FRONTEND_DEPLOY_DIR"
  echo "BUILD_INFO: $BUILD_INFO_FILE"
fi
