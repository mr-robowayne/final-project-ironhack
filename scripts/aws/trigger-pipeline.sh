#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# trigger-pipeline.sh — Trigger and monitor GitHub Actions pipelines
#
# Usage:
#   ./scripts/aws/trigger-pipeline.sh --workflow frontend [--wait]
#   ./scripts/aws/trigger-pipeline.sh --workflow backend  [--wait]
#   ./scripts/aws/trigger-pipeline.sh --workflow both     [--wait]
#   ./scripts/aws/trigger-pipeline.sh --workflow terraform [--wait]
#
# Options:
#   --workflow <name>  Pipeline to trigger: frontend, backend, terraform, or both
#   --wait             Block until the run completes
#   --branch <name>    Branch to trigger on (default: current branch)
#   --help, -h         Show help
# =============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
WORKFLOW=""
WAIT=false
BRANCH=""

# Workflow file mapping
declare -A WORKFLOW_FILES=(
  [frontend]="frontend.yml"
  [backend]="backend-build.yml"
  [terraform]="terraform.yml"
)

# ── Help ──────────────────────────────────────────────────────────────────────
show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Triggers GitHub Actions workflows and optionally monitors them.

Options:
  --workflow <name>   Workflow to trigger: frontend, backend, terraform, or both
                      'both' triggers frontend + backend
  --wait              Block until the run completes and show result
  --branch <name>     Branch to run on (default: current git branch)
  --help, -h          Show this help message

Examples:
  $(basename "$0") --workflow frontend --wait
  $(basename "$0") --workflow both --branch main
  $(basename "$0") --workflow backend

Requirements:
  - gh CLI installed and authenticated
  - Push access to the repository
EOF
}

# ── Parse Arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workflow)
      WORKFLOW="$2"
      shift 2
      ;;
    --wait)
      WAIT=true
      shift
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$WORKFLOW" ]]; then
  echo "Error: --workflow is required."
  echo ""
  show_help
  exit 1
fi

if [[ "$WORKFLOW" != "frontend" && "$WORKFLOW" != "backend" && "$WORKFLOW" != "terraform" && "$WORKFLOW" != "both" ]]; then
  echo "Error: --workflow must be one of: frontend, backend, terraform, both"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI not found. Install with: brew install gh"
  exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo "Error: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi

# Determine branch
if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD)"
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -z "$REPO" ]]; then
  echo "Error: Could not determine GitHub repository."
  exit 1
fi

echo "========================================================================"
echo "  Pipeline Trigger — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Repository: $REPO"
echo "  Branch:     $BRANCH"
echo "  Workflow:   $WORKFLOW"
echo "  Wait:       $WAIT"
echo "========================================================================"

# ── Build list of workflows to trigger ────────────────────────────────────────
WORKFLOWS_TO_RUN=()
if [[ "$WORKFLOW" == "both" ]]; then
  WORKFLOWS_TO_RUN=(frontend backend)
else
  WORKFLOWS_TO_RUN=("$WORKFLOW")
fi

# ── Trigger Function ─────────────────────────────────────────────────────────
trigger_and_monitor() {
  local wf_name="$1"
  local wf_file="${WORKFLOW_FILES[$wf_name]}"

  echo ""
  echo "-- Triggering: $wf_name ($wf_file) --"

  # Verify workflow file exists locally
  if [[ ! -f "$PROJECT_ROOT/.github/workflows/$wf_file" ]]; then
    echo "  [FAIL] Workflow file not found: .github/workflows/$wf_file"
    return 1
  fi

  # Trigger the workflow
  echo "  Dispatching workflow_dispatch event..."
  if ! gh workflow run "$wf_file" --ref "$BRANCH" 2>&1; then
    echo "  [FAIL] Could not trigger workflow. Check permissions and branch."
    return 1
  fi

  echo "  Triggered successfully."

  # Wait a few seconds for the run to appear
  sleep 3

  # Find the run ID
  local run_id=""
  for attempt in 1 2 3 4 5; do
    run_id=$(gh run list \
      --workflow "$wf_file" \
      --branch "$BRANCH" \
      --limit 1 \
      --json databaseId,status \
      --jq '.[0].databaseId' 2>/dev/null || true)

    if [[ -n "$run_id" ]]; then
      break
    fi
    sleep 2
  done

  if [[ -z "$run_id" ]]; then
    echo "  [WARN] Could not find run ID. Check GitHub Actions manually."
    echo "  URL: https://github.com/$REPO/actions/workflows/$wf_file"
    return 0
  fi

  local run_url="https://github.com/$REPO/actions/runs/$run_id"
  echo "  Run ID:  $run_id"
  echo "  URL:     $run_url"

  if [[ "$WAIT" == true ]]; then
    echo ""
    echo "  Waiting for completion..."
    echo "  (Press Ctrl+C to stop watching — the run will continue on GitHub)"
    echo ""

    # Watch the run
    if gh run watch "$run_id" --exit-status 2>&1; then
      echo ""
      echo "  [PASS] $wf_name — completed successfully"
    else
      echo ""
      echo "  [FAIL] $wf_name — failed"
      echo ""
      echo "  Fetching failed step logs..."
      echo "  ----------------------------------------------------------------"

      # Get failed jobs and their logs
      failed_jobs=$(gh run view "$run_id" --json jobs --jq '.jobs[] | select(.conclusion == "failure") | .name' 2>/dev/null || true)

      if [[ -n "$failed_jobs" ]]; then
        echo "  Failed jobs:"
        echo "$failed_jobs" | sed 's/^/    - /'
        echo ""
        # Show logs for the run (last 50 lines of failed)
        gh run view "$run_id" --log-failed 2>/dev/null | tail -50 | sed 's/^/  /' || true
      else
        echo "  (Could not retrieve failed job details)"
      fi

      echo "  ----------------------------------------------------------------"
      return 1
    fi
  else
    echo "  Run is in progress. Monitor at:"
    echo "    $run_url"
    echo ""
    echo "  Or watch from CLI:"
    echo "    gh run watch $run_id"
  fi
}

# ── Execute ───────────────────────────────────────────────────────────────────
TRIGGER_FAILURES=0

for wf in "${WORKFLOWS_TO_RUN[@]}"; do
  if ! trigger_and_monitor "$wf"; then
    TRIGGER_FAILURES=$((TRIGGER_FAILURES + 1))
  fi
done

# ── Final Status ──────────────────────────────────────────────────────────────
echo ""
echo "========================================================================"
if (( TRIGGER_FAILURES > 0 )); then
  echo "  RESULT: $TRIGGER_FAILURES workflow(s) failed"
  echo "========================================================================"
  exit 1
else
  echo "  RESULT: All workflow(s) triggered successfully"
  echo "========================================================================"
  exit 0
fi
