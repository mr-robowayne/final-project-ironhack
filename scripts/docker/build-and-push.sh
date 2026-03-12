#!/usr/bin/env bash
# =============================================================================
# build-and-push.sh — Alle patientsync Docker-Images bauen und in AWS ECR pushen.
#
# Verwendung:
#   ./scripts/docker/build-and-push.sh              # Tag = git short SHA
#   ./scripts/docker/build-and-push.sh 1.2.3        # Tag = 1.2.3
#   ./scripts/docker/build-and-push.sh 1.2.3 --no-latest  # ohne :latest Tag
#
# Voraussetzungen:
#   - Docker mit buildx Plugin (multi-platform)
#   - AWS CLI konfiguriert (aws configure oder IAM Role)
#   - Plattform linux/amd64 (EC2 Ubuntu x86_64)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/app/dhapp/backend"

AWS_REGION="eu-central-2"
AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
PROJECT="patientsync-prod"
PLATFORM="linux/amd64"

# ── Tag-Auflösung ────────────────────────────────────────────────────────────
TAG="${1:-}"
if [[ -z "${TAG}" ]]; then
  TAG="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'local')"
fi

NO_LATEST=false
for arg in "$@"; do
  [[ "${arg}" == "--no-latest" ]] && NO_LATEST=true
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  patientsync — Docker Build & Push (ECR)                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "  Registry : ${REGISTRY}"
echo "  Tag      : ${TAG}"
echo "  Latest   : $( [[ "${NO_LATEST}" == true ]] && echo 'nein' || echo 'ja' )"
echo "  Platform : ${PLATFORM}"
echo ""

# ── Services (name → build-context-verzeichnis) ──────────────────────────────
declare -A SERVICES=(
  [backend-api]="api"
  [billing-api]="billing-service"
  [ai-service]="ai-service"
  [login-gateway]="login-gateway"
)

# ── ECR Login ─────────────────────────────────────────────────────────────────
echo "[auth] ECR Login..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${REGISTRY}"

# ── Buildx Builder sicherstellen ─────────────────────────────────────────────
BUILDER_NAME="patientsync-builder"
if ! docker buildx inspect "${BUILDER_NAME}" &>/dev/null; then
  echo "[buildx] Erstelle Builder '${BUILDER_NAME}'..."
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --bootstrap
fi
docker buildx use "${BUILDER_NAME}"

# ── Jedes Image bauen und pushen ─────────────────────────────────────────────
FAILED=()
for svc in "${!SERVICES[@]}"; do
  ctx_dir="${BACKEND_DIR}/${SERVICES[$svc]}"
  image="${REGISTRY}/${PROJECT}-${svc}"
  dockerfile="${ctx_dir}/Dockerfile"

  if [[ ! -f "${dockerfile}" ]]; then
    echo "⚠  [${svc}] Dockerfile nicht gefunden: ${dockerfile} — übersprungen"
    FAILED+=("${svc}")
    continue
  fi

  echo "──────────────────────────────────────────────────────────────"
  echo "▶  [${svc}] ${image}:${TAG}"

  tag_args=("-t" "${image}:${TAG}")
  if [[ "${NO_LATEST}" == false ]]; then
    tag_args+=("-t" "${image}:latest")
  fi

  docker buildx build \
    --platform "${PLATFORM}" \
    "${tag_args[@]}" \
    --file "${dockerfile}" \
    --push \
    "${ctx_dir}"

  echo "✓  [${svc}] gepusht → ${image}:${TAG}"
done

echo ""
echo "══════════════════════════════════════════════════════════════"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "⚠  Fehlgeschlagen: ${FAILED[*]}"
  exit 1
else
  echo "✓  Alle Images erfolgreich gebaut und in ECR gepusht."
  echo ""
  echo "  Images:"
  for svc in "${!SERVICES[@]}"; do
    echo "    ${REGISTRY}/${PROJECT}-${svc}:${TAG}"
  done
  echo ""
  echo "  Ansible Deploy:"
  echo "    cd ansible && ansible-playbook playbooks/deploy.yml --ask-vault-pass -e image_tag=${TAG}"
fi
echo "══════════════════════════════════════════════════════════════"
