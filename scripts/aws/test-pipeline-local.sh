#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# test-pipeline-local.sh — Run a local simulation of the CI/CD pipeline
#
# Builds frontend and backend locally, runs security scans, starts containers,
# and verifies health check endpoints.
#
# Usage:
#   ./scripts/aws/test-pipeline-local.sh [OPTIONS]
#
# Options:
#   --frontend-only   Only run frontend checks
#   --backend-only    Only run backend checks
#   --skip-docker     Skip Docker builds (only run npm builds)
#   --help, -h        Show help
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Configuration ─────────────────────────────────────────────────────────────
FRONTEND_DIR="$PROJECT_ROOT/app/dhapp/frontend"
BACKEND_DIR="$PROJECT_ROOT/app/dhapp/backend"
ADMIN_DIR="$PROJECT_ROOT/app/dhapp/admin"

BACKEND_SERVICES=(api billing-service ai-service login-gateway)
DOCKER_IMAGE_PREFIX="patientsync-local"

# Health check ports (local mapping)
declare -A SERVICE_PORTS=(
  [api]=3000
  [billing-service]=3001
  [ai-service]=3002
  [login-gateway]=3003
)

# ── Flags ─────────────────────────────────────────────────────────────────────
RUN_FRONTEND=true
RUN_BACKEND=true
SKIP_DOCKER=false
STARTED_CONTAINERS=()

# ── Counters & Timing ────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_START=$(date +%s)

pass()   { echo "  [PASS] $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()   { echo "  [FAIL] $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn()   { echo "  [WARN] $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
header() { echo ""; echo "== $* =="; }

timer_start() { STEP_START=$(date +%s); }
timer_end()   {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo "  (${elapsed}s)"
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if (( ${#STARTED_CONTAINERS[@]} > 0 )); then
    echo ""
    echo "-- Cleaning up containers --"
    for cid in "${STARTED_CONTAINERS[@]}"; do
      docker rm -f "$cid" &>/dev/null || true
    done
  fi
}
trap cleanup EXIT

# ── Help ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Runs a local simulation of the CI/CD pipeline.

Options:
  --frontend-only   Only run frontend build and checks
  --backend-only    Only run backend build and checks
  --skip-docker     Skip Docker image builds (npm/node only)
  --help, -h        Show this help message

What it does:
  Frontend:
    - npm ci + npm run build
    - DSGVO compliance checks (secret scanning, no deploy)

  Backend:
    - Docker build for all 4 services
    - Trivy filesystem scan (if installed)
    - Trivy image scan (if installed)
    - Start containers and verify /health endpoints

  Both:
    - Print timing and resource usage
    - Exit with clear pass/fail status
EOF
  exit 0
fi

for arg in "$@"; do
  case "$arg" in
    --frontend-only) RUN_BACKEND=false ;;
    --backend-only)  RUN_FRONTEND=false ;;
    --skip-docker)   SKIP_DOCKER=true ;;
  esac
done

echo "========================================================================"
echo "  Local Pipeline Test — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Project: $PROJECT_ROOT"
echo "  Frontend: $RUN_FRONTEND | Backend: $RUN_BACKEND | Skip Docker: $SKIP_DOCKER"
echo "========================================================================"

# ── Pre-flight ────────────────────────────────────────────────────────────────
header "0. Pre-flight Checks"

if [[ "$RUN_FRONTEND" == true ]]; then
  if command -v node &>/dev/null; then
    pass "node $(node --version)"
  else
    fail "node not found"
  fi
  if command -v npm &>/dev/null; then
    pass "npm $(npm --version)"
  else
    fail "npm not found"
  fi
fi

if [[ "$RUN_BACKEND" == true && "$SKIP_DOCKER" == false ]]; then
  if command -v docker &>/dev/null; then
    if docker info &>/dev/null; then
      pass "Docker is running"
    else
      fail "Docker daemon not running"
    fi
  else
    fail "docker not found"
  fi
fi

HAS_TRIVY=false
if command -v trivy &>/dev/null; then
  HAS_TRIVY=true
  pass "trivy available"
else
  warn "trivy not installed — security scans will be skipped"
fi

if (( FAIL_COUNT > 0 )); then
  echo ""
  echo "Pre-flight checks failed. Aborting."
  exit 1
fi

# =============================================================================
# FRONTEND
# =============================================================================
if [[ "$RUN_FRONTEND" == true ]]; then

  # ── Frontend: npm ci + build ──────────────────────────────────────────────
  header "1. Frontend — npm ci + build"
  timer_start

  # Check if the build script exists
  BUILD_SCRIPT="$ADMIN_DIR/export_frontend_bundle.sh"
  if [[ -f "$BUILD_SCRIPT" ]]; then
    echo "  Using build script: $BUILD_SCRIPT"
    # Run without SSM (local mode)
    if LOAD_FRONTEND_ENV_FROM_SSM=false bash "$BUILD_SCRIPT" 2>&1; then
      pass "Frontend build succeeded"
    else
      # Fallback: direct npm build
      echo "  Build script failed, trying direct npm build..."
      if [[ -f "$FRONTEND_DIR/package.json" ]]; then
        (cd "$FRONTEND_DIR" && npm ci --prefer-offline 2>&1 | tail -3)
        if (cd "$FRONTEND_DIR" && npm run build 2>&1 | tail -5); then
          pass "Frontend build succeeded (direct npm)"
        else
          fail "Frontend build FAILED"
        fi
      else
        fail "No package.json in frontend dir"
      fi
    fi
  elif [[ -f "$FRONTEND_DIR/package.json" ]]; then
    echo "  Direct npm build..."
    (cd "$FRONTEND_DIR" && npm ci --prefer-offline 2>&1 | tail -3)
    if (cd "$FRONTEND_DIR" && npm run build 2>&1 | tail -5); then
      pass "Frontend build succeeded"
    else
      fail "Frontend build FAILED"
    fi
  else
    fail "No frontend build mechanism found"
  fi
  timer_end

  # ── Frontend: DSGVO Compliance Checks ───────────────────────────────────
  header "2. Frontend — DSGVO / Compliance Checks (dry-run)"
  timer_start

  # Secret scanning in build output
  BUILD_DIR="$FRONTEND_DIR"
  if [[ -d "$FRONTEND_DIR/build" ]]; then
    BUILD_DIR="$FRONTEND_DIR/build"
  fi

  if [[ -d "$BUILD_DIR" ]]; then
    # Check for leaked secrets in bundle
    secret_pattern='AKIA|SECRET_KEY|TOKEN=|PASSWORD=|PRIVATE.KEY|OPENAI_API|JWT_SECRET'
    hits=$(grep -rIlEi "$secret_pattern" "$BUILD_DIR" 2>/dev/null || true)

    if [[ -n "$hits" ]]; then
      # Filter out React internals false positives
      real_hits=""
      while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        if grep -q "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED" "$f" 2>/dev/null; then continue; fi
        real_hits+="$f"$'\n'
      done <<< "$hits"

      if [[ -n "$real_hits" ]]; then
        fail "Potential secrets found in frontend bundle!"
        echo "$real_hits" | head -10
      else
        pass "Bundle secret scan — clean (React internals filtered)"
      fi
    else
      pass "Bundle secret scan — clean"
    fi

    # Check for source maps (should not ship to production)
    map_count=$(find "$BUILD_DIR" -name "*.map" 2>/dev/null | wc -l | tr -d ' ')
    if (( map_count > 0 )); then
      warn "$map_count source map file(s) found — should be excluded from deploy"
    else
      pass "No source maps in build output"
    fi
  else
    warn "No build output directory found — compliance checks skipped"
  fi
  timer_end
fi

# =============================================================================
# BACKEND
# =============================================================================
if [[ "$RUN_BACKEND" == true ]]; then

  # ── Backend: npm install (for Trivy fs scan) ────────────────────────────
  header "3. Backend — npm install (dependency resolution)"
  timer_start

  npm_services=(api ai-service billing-service)
  for svc in "${npm_services[@]}"; do
    app_dir="$BACKEND_DIR/$svc/app"
    if [[ -f "$app_dir/package.json" ]]; then
      if (cd "$app_dir" && npm install --prefer-offline 2>&1 | tail -1); then
        pass "$svc — npm install OK"
      else
        fail "$svc — npm install FAILED"
      fi
    else
      warn "$svc — no package.json in app/"
    fi
  done
  timer_end

  # ── Backend: Trivy Filesystem Scan ──────────────────────────────────────
  header "4. Backend — Trivy Filesystem Scan"
  timer_start

  if [[ "$HAS_TRIVY" == true ]]; then
    trivyignore=""
    if [[ -f "$BACKEND_DIR/.trivyignore" ]]; then
      trivyignore="--ignorefile $BACKEND_DIR/.trivyignore"
    fi

    if trivy fs "$BACKEND_DIR" \
        --severity CRITICAL,HIGH \
        --exit-code 0 \
        --ignore-unfixed \
        $trivyignore \
        --format table 2>&1 | tail -20; then
      pass "Trivy filesystem scan completed"
    else
      warn "Trivy filesystem scan had findings"
    fi
  else
    skip "Trivy not installed — skipping filesystem scan"
  fi
  timer_end

  # ── Backend: Docker Builds ──────────────────────────────────────────────
  if [[ "$SKIP_DOCKER" == false ]]; then

    header "5. Backend — Docker Image Builds"
    timer_start

    for svc in "${BACKEND_SERVICES[@]}"; do
      svc_dir="$BACKEND_DIR/$svc"
      image_name="${DOCKER_IMAGE_PREFIX}-${svc}:test"

      echo "  Building $svc..."
      if docker build -t "$image_name" -f "$svc_dir/Dockerfile" "$svc_dir" 2>&1 | tail -3; then
        pass "$svc — Docker build OK"

        # Image size
        size=$(docker image inspect "$image_name" --format '{{.Size}}' 2>/dev/null || echo "0")
        size_mb=$(( size / 1024 / 1024 ))
        echo "    Image size: ${size_mb}MB"
      else
        fail "$svc — Docker build FAILED"
      fi
    done
    timer_end

    # ── Backend: Trivy Image Scans ────────────────────────────────────────
    header "6. Backend — Trivy Image Scans"
    timer_start

    if [[ "$HAS_TRIVY" == true ]]; then
      trivyignore=""
      if [[ -f "$BACKEND_DIR/.trivyignore" ]]; then
        trivyignore="--ignorefile $BACKEND_DIR/.trivyignore"
      fi

      for svc in "${BACKEND_SERVICES[@]}"; do
        image_name="${DOCKER_IMAGE_PREFIX}-${svc}:test"
        echo "  Scanning $svc image..."
        if trivy image "$image_name" \
            --severity CRITICAL,HIGH \
            --exit-code 0 \
            --ignore-unfixed \
            $trivyignore \
            --format table 2>&1 | tail -10; then
          pass "$svc — Trivy image scan completed"
        else
          warn "$svc — Trivy image scan had findings"
        fi
      done
    else
      skip "Trivy not installed — skipping image scans"
    fi
    timer_end

    # ── Backend: Health Check Integration Test ────────────────────────────
    header "7. Backend — Health Check Integration Test"
    timer_start

    HEALTH_PASS=0
    HEALTH_FAIL=0

    for svc in "${BACKEND_SERVICES[@]}"; do
      image_name="${DOCKER_IMAGE_PREFIX}-${svc}:test"
      port="${SERVICE_PORTS[$svc]}"

      # Check if image exists
      if ! docker image inspect "$image_name" &>/dev/null; then
        warn "$svc — image not available, skipping health check"
        continue
      fi

      echo "  Starting $svc on port $port..."
      cid=$(docker run -d \
        --name "patientsync-test-${svc}" \
        -p "${port}:${port}" \
        -e "PORT=${port}" \
        -e "NODE_ENV=test" \
        "$image_name" 2>/dev/null || true)

      if [[ -z "$cid" ]]; then
        # Try without port env
        cid=$(docker run -d \
          --name "patientsync-test-${svc}-alt" \
          -p "${port}:3000" \
          -e "NODE_ENV=test" \
          "$image_name" 2>/dev/null || true)
        if [[ -n "$cid" ]]; then
          STARTED_CONTAINERS+=("$cid")
          # Remap port for health check
          port="${port}"
        else
          fail "$svc — could not start container"
          continue
        fi
      else
        STARTED_CONTAINERS+=("$cid")
      fi

      # Wait for container to be ready (max 15 seconds)
      healthy=false
      for i in $(seq 1 15); do
        if curl -sf "http://localhost:${port}/health" &>/dev/null; then
          healthy=true
          break
        fi
        sleep 1
      done

      if [[ "$healthy" == true ]]; then
        pass "$svc — /health responded OK on port $port"
        HEALTH_PASS=$((HEALTH_PASS + 1))
      else
        # Check container logs for diagnostics
        echo "  Container logs (last 5 lines):"
        docker logs "$cid" 2>&1 | tail -5 | sed 's/^/    /'
        fail "$svc — /health did not respond within 15s on port $port"
        HEALTH_FAIL=$((HEALTH_FAIL + 1))
      fi
    done

    echo ""
    echo "  Health checks: $HEALTH_PASS passed, $HEALTH_FAIL failed"
    timer_end

  else
    echo ""
    echo "  (Docker steps skipped — --skip-docker flag set)"
  fi
fi

# =============================================================================
# SUMMARY
# =============================================================================
TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
TOTAL_MIN=$(( TOTAL_ELAPSED / 60 ))
TOTAL_SEC=$(( TOTAL_ELAPSED % 60 ))

echo ""
echo "========================================================================"
echo "  LOCAL PIPELINE TEST — SUMMARY"
echo "------------------------------------------------------------------------"
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "  WARN: $WARN_COUNT"
echo "  Time: ${TOTAL_MIN}m ${TOTAL_SEC}s"
echo "------------------------------------------------------------------------"

# Resource usage
if command -v docker &>/dev/null && [[ "$SKIP_DOCKER" == false && "$RUN_BACKEND" == true ]]; then
  total_image_size=0
  for svc in "${BACKEND_SERVICES[@]}"; do
    size=$(docker image inspect "${DOCKER_IMAGE_PREFIX}-${svc}:test" --format '{{.Size}}' 2>/dev/null || echo "0")
    total_image_size=$(( total_image_size + size ))
  done
  total_mb=$(( total_image_size / 1024 / 1024 ))
  echo "  Docker images total: ${total_mb}MB"
fi

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
