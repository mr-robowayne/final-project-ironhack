#!/usr/bin/env bash
# =============================================================================
# docker-build-frontend.sh — Frontend Docker-Image lokal bauen, scannen, testen.
#
# Verwendung:
#   ./scripts/aws/docker-build-frontend.sh                # Standard (scan + test)
#   ./scripts/aws/docker-build-frontend.sh --no-scan      # Trivy-Scan ueberspringen
#   ./scripts/aws/docker-build-frontend.sh --no-test      # Healthcheck-Test ueberspringen
#   ./scripts/aws/docker-build-frontend.sh --no-scan --no-test
#
# Env-Variablen (optional):
#   IMAGE_TAG          — Bild-Tag (default: git short SHA)
#   BUILD_ENV_FILE     — Pfad zur frontend.build.env (default: auto-detect)
#   LOAD_FROM_SSM      — "true" = REACT_APP_* aus SSM Parameter Store laden
#
# Voraussetzungen:
#   - Docker
#   - Optional: trivy (Security-Scan), curl (Healthcheck)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Konfiguration ────────────────────────────────────────────────────────────
AWS_REGION="eu-central-2"
REGISTRY="648786395667.dkr.ecr.${AWS_REGION}.amazonaws.com"
PROJECT="patientsync-prod"
IMAGE_NAME="${REGISTRY}/${PROJECT}-frontend"
FRONTEND_DIR="${PROJECT_ROOT}/app/dhapp/frontend"
PLATFORM="linux/amd64"

# ── Flags parsen ─────────────────────────────────────────────────────────────
NO_SCAN=false
NO_TEST=false
for arg in "$@"; do
  case "${arg}" in
    --no-scan) NO_SCAN=true ;;
    --no-test) NO_TEST=true ;;
  esac
done

# ── Tag-Aufloesung ──────────────────────────────────────────────────────────
TAG="${IMAGE_TAG:-$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'local')}"

echo ""
echo "========================================================================"
echo "  patientsync — Frontend Docker Build"
echo "========================================================================"
echo "  Image    : ${IMAGE_NAME}"
echo "  Tag      : ${TAG}"
echo "  Platform : ${PLATFORM}"
echo "  Scan     : $( [[ "${NO_SCAN}" == true ]] && echo 'nein' || echo 'ja' )"
echo "  Test     : $( [[ "${NO_TEST}" == true ]] && echo 'nein' || echo 'ja' )"
echo ""

# ── Dockerfile pruefen ──────────────────────────────────────────────────────
DOCKERFILE="${FRONTEND_DIR}/Dockerfile"
if [[ ! -f "${DOCKERFILE}" ]]; then
  echo "[FAIL] Dockerfile nicht gefunden: ${DOCKERFILE}" >&2
  exit 1
fi

# ── REACT_APP_* Build-Args laden ─────────────────────────────────────────────
# Quelle 1: frontend.build.env Datei
# Quelle 2: SSM Parameter Store (wenn LOAD_FROM_SSM=true)
declare -A BUILD_VARS=()

BUILD_ENV_FILE="${BUILD_ENV_FILE:-${PROJECT_ROOT}/app/dhapp/admin/frontend.build.env}"

if [[ -f "${BUILD_ENV_FILE}" ]]; then
  echo "[env] Lade Build-Variablen aus ${BUILD_ENV_FILE}"
  while IFS='=' read -r key value; do
    # Leerzeilen und Kommentare ueberspringen
    [[ -z "${key}" || "${key}" =~ ^# ]] && continue
    # Nur REACT_APP_* Variablen verwenden
    if [[ "${key}" =~ ^REACT_APP_ ]]; then
      # Anfuehrungszeichen entfernen
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      BUILD_VARS["${key}"]="${value}"
    fi
  done < "${BUILD_ENV_FILE}"
elif [[ "${LOAD_FROM_SSM:-false}" == "true" ]]; then
  echo "[env] Lade Build-Variablen aus SSM Parameter Store..."
  SSM_PREFIX="/${PROJECT}/frontend/"
  ssm_params="$(aws ssm get-parameters-by-path \
    --path "${SSM_PREFIX}" \
    --with-decryption \
    --region "${AWS_REGION}" \
    --query 'Parameters[].{Name:Name,Value:Value}' \
    --output text 2>/dev/null || true)"

  if [[ -n "${ssm_params}" ]]; then
    while IFS=$'\t' read -r name value; do
      key="${name##*/}"
      if [[ "${key}" =~ ^REACT_APP_ ]]; then
        BUILD_VARS["${key}"]="${value}"
      fi
    done <<< "${ssm_params}"
  else
    echo "[WARN] Keine SSM-Parameter unter ${SSM_PREFIX} gefunden"
  fi
else
  echo "[WARN] Keine Build-Env-Datei gefunden: ${BUILD_ENV_FILE}"
  echo "       Verwende Dockerfile-Defaults oder setze LOAD_FROM_SSM=true"
fi

# Build-Args zusammenbauen
BUILD_ARGS=()
for key in "${!BUILD_VARS[@]}"; do
  echo "  ${key}=${BUILD_VARS[${key}]}"
  BUILD_ARGS+=("--build-arg" "${key}=${BUILD_VARS[${key}]}")
done
echo ""

# ── Docker Build ─────────────────────────────────────────────────────────────
echo "----------------------------------------------------------------------"
echo "[build] Baue ${IMAGE_NAME}:${TAG} ..."

docker build \
  --platform "${PLATFORM}" \
  -t "${IMAGE_NAME}:${TAG}" \
  -t "${IMAGE_NAME}:latest" \
  "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}" \
  -f "${DOCKERFILE}" \
  "${FRONTEND_DIR}"

echo "[build] Image erfolgreich gebaut."

# ── Trivy Security Scan ──────────────────────────────────────────────────────
if [[ "${NO_SCAN}" == false ]]; then
  if command -v trivy &>/dev/null; then
    echo ""
    echo "----------------------------------------------------------------------"
    echo "[scan] Trivy Security Scan..."
    trivy image \
      --severity HIGH,CRITICAL \
      --exit-code 0 \
      --no-progress \
      "${IMAGE_NAME}:${TAG}"
    echo "[scan] Scan abgeschlossen."
  else
    echo "[scan] trivy nicht installiert — Scan uebersprungen."
  fi
fi

# ── Healthcheck Test ─────────────────────────────────────────────────────────
if [[ "${NO_TEST}" == false ]]; then
  echo ""
  echo "----------------------------------------------------------------------"
  echo "[test] Starte Container fuer Healthcheck..."

  CONTAINER_NAME="patientsync-frontend-test-$$"
  TEST_PORT=18080

  docker run --rm -d \
    --name "${CONTAINER_NAME}" \
    -p "${TEST_PORT}:80" \
    "${IMAGE_NAME}:${TAG}" >/dev/null

  # Warte bis nginx bereit ist
  HEALTHY=false
  for i in $(seq 1 15); do
    if curl -sf -o /dev/null "http://localhost:${TEST_PORT}/"; then
      HEALTHY=true
      break
    fi
    sleep 1
  done

  # Container stoppen
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  if [[ "${HEALTHY}" == true ]]; then
    echo "[test] Healthcheck bestanden (HTTP 200 auf /)"
  else
    echo "[FAIL] Healthcheck fehlgeschlagen nach 15s" >&2
    exit 1
  fi
fi

# ── Image-Informationen ─────────────────────────────────────────────────────
echo ""
echo "----------------------------------------------------------------------"
echo "[info] Image-Details:"
echo ""
docker images "${IMAGE_NAME}:${TAG}" --format "  Size: {{.Size}}"
echo ""
echo "  Layer-Uebersicht:"
docker history "${IMAGE_NAME}:${TAG}" --no-trunc=false --format "  {{.Size}}\t{{.CreatedBy}}" | head -15
echo ""

echo "========================================================================"
echo "  Image gebaut: ${IMAGE_NAME}:${TAG}"
echo "                ${IMAGE_NAME}:latest"
echo ""
echo "  Naechster Schritt:"
echo "    ./scripts/aws/push-frontend-ecr.sh"
echo "========================================================================"
