#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/dhapp/frontend"
# Korrigierter Pfad: Relativ zum Projekt-Root statt Hardcoded auf altes Projekt
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/../deploy/compose/local.yml}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-frontend}"
IMAGE_NAME="${IMAGE_NAME:-compose-frontend}"
ENV_FILE="$ROOT_DIR/dhapp/admin/frontend.build.env"
BUILD_INFO_FILE="$ROOT_DIR/dhapp/admin/BUILD_INFO_FRONTEND.txt"
SSM_ENV_SCRIPT="$ROOT_DIR/dhapp/admin/generate_frontend_build_env_from_ssm.sh"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[export] Compose file not found: $COMPOSE_FILE" >&2
  echo "[export] Set COMPOSE_FILE=/absolute/path/to/local.yml and retry." >&2
  exit 1
fi

if [[ "${LOAD_FRONTEND_ENV_FROM_SSM:-false}" == "true" ]]; then
  bash "$SSM_ENV_SCRIPT" "$ENV_FILE"
fi

if [[ -f "$ENV_FILE" ]]; then
  if grep -Eq '^REACT_APP_[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*=' "$ENV_FILE"; then
    echo "[export] Refusing build: secret-like REACT_APP variable found in $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if ! docker info >/dev/null 2>&1; then
  echo "[export] Docker daemon is not running or not accessible." >&2
  exit 1
fi

echo "[export] building frontend image..."
docker compose -f "$COMPOSE_FILE" build "$FRONTEND_SERVICE" \
  --build-arg "GENERATE_SOURCEMAP=${GENERATE_SOURCEMAP:-false}" \
  --build-arg "REACT_APP_API_BASE=${REACT_APP_API_BASE:-}" \
  --build-arg "REACT_APP_API_URL=${REACT_APP_API_URL:-}" \
  --build-arg "REACT_APP_DEFAULT_TENANT=${REACT_APP_DEFAULT_TENANT:-test}" \
  --build-arg "REACT_APP_LT_API_URL=${REACT_APP_LT_API_URL:-}" \
  --build-arg "REACT_APP_CHAT_NOTIFICATION_PREVIEW=${REACT_APP_CHAT_NOTIFICATION_PREVIEW:-false}" \
  --build-arg "REACT_APP_BACKEND_PORT=${REACT_APP_BACKEND_PORT:-}" \
  --build-arg "REACT_APP_DEV_TENANT_ID=${REACT_APP_DEV_TENANT_ID:-}" \
  --build-arg "REACT_APP_DEV_USER_ID=${REACT_APP_DEV_USER_ID:-}"

echo "[export] exporting bundle from image: $IMAGE_NAME"
CID="$(docker create "$IMAGE_NAME")"
cleanup() {
  docker rm -f "$CID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
docker cp "$CID:/usr/share/nginx/html/." "$OUT_DIR/"

MAP_COUNT="$(find "$OUT_DIR" -type f -name "*.map" | wc -l | tr -d ' ')"
if [[ "$MAP_COUNT" != "0" ]]; then
  find "$OUT_DIR" -type f -name "*.map" -delete
  echo "[export] removed $MAP_COUNT source map file(s) from bundle"
fi

cat > "$BUILD_INFO_FILE" <<INFO
Bundle exported (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Source image: $IMAGE_NAME
Output dir: $OUT_DIR
REACT_APP_API_BASE=${REACT_APP_API_BASE:-}
REACT_APP_API_URL=${REACT_APP_API_URL:-}
REACT_APP_DEFAULT_TENANT=${REACT_APP_DEFAULT_TENANT:-test}
REACT_APP_LT_API_URL=${REACT_APP_LT_API_URL:-}
REACT_APP_CHAT_NOTIFICATION_PREVIEW=${REACT_APP_CHAT_NOTIFICATION_PREVIEW:-false}
REACT_APP_BACKEND_PORT=${REACT_APP_BACKEND_PORT:-}
REACT_APP_DEV_TENANT_ID=${REACT_APP_DEV_TENANT_ID:-}
REACT_APP_DEV_USER_ID=${REACT_APP_DEV_USER_ID:-}
GENERATE_SOURCEMAP=${GENERATE_SOURCEMAP:-false}
INFO

echo "[export] done: $OUT_DIR"
echo "[export] build metadata: $BUILD_INFO_FILE"
