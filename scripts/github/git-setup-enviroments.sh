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

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✓ Environments konfiguriert:"
echo "  development → nur branch: ${DEV_BRANCH}"
echo "  production  → nur branch: ${PROD_BRANCH}"
echo ""
echo "  Sicherheitsmodell (GitHub Free):"
echo "  - development pipeline läuft nur auf branch 'development'"
echo "  - production pipeline (build + deploy) läuft nur auf branch 'main'"
echo "  - Du kontrollierst selbst wann development → main gemergt wird"
echo "══════════════════════════════════════════════════════════════"
