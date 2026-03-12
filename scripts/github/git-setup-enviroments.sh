#!/usr/bin/env bash
set -euo pipefail

# --- KONFIGURATION ---
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
# ---------------------

REPO="${GITHUB_USER}/${REPO_NAME}"
DEV_BRANCH="development"
PROD_BRANCH="main"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  patientsync — GitHub Environments Setup                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "  Repo: ${REPO}"
echo ""

# ── development Environment ───────────────────────────────────────────────────
echo "  [development] Konfiguriere Environment..."
gh api "repos/${REPO}/environments/development" \
  --method PUT \
  --input - << EOF
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF

gh api "repos/${REPO}/environments/development/deployment-branch-policies" \
  --method POST \
  --field name="${DEV_BRANCH}" 2>/dev/null || true

# ── production Environment ────────────────────────────────────────────────────
echo "  [production] Konfiguriere Environment..."
gh api "repos/${REPO}/environments/production" \
  --method PUT \
  --input - << EOF
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF

gh api "repos/${REPO}/environments/production/deployment-branch-policies" \
  --method POST \
  --field name="${PROD_BRANCH}" 2>/dev/null || true

# ── Branch Protection auf main (kostenloser Ersatz für Required Reviewers) ───
echo "  [main] Branch Protection — PR required before merge..."
gh api "repos/${REPO}/branches/${PROD_BRANCH}/protection" \
  --method PUT \
  --input - << EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Code-Qualität (Trivy)", "Build & Push (Production)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✓ Environments konfiguriert:"
echo "  development → branch: ${DEV_BRANCH}"
echo "  production  → branch: ${PROD_BRANCH}"
echo ""
echo "✓ Branch Protection auf 'main':"
echo "  - PR required (1 Approval)"
echo "  - Trivy + Build müssen grün sein bevor merge erlaubt"
echo "  → Deploy läuft nur nach PR merge von development → main"
echo "══════════════════════════════════════════════════════════════"
