#!/bin/bash
set -e

# --- KONFIGURATION ---
# Muss mit create-repo.sh übereinstimmen
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
# ---------------------

DEV_BRANCH="development"
PROD_BRANCH="main"

# -------------------------------------------------------
# Create GitHub Environments
# -------------------------------------------------------
echo "🌍 Creating GitHub Environments..."

gh api repos/$GITHUB_USER/$REPO_NAME/environments/development --method PUT
gh api repos/$GITHUB_USER/$REPO_NAME/environments/production --method PUT

echo "✅ Environments created"

# -------------------------------------------------------
# Bind GitHub Environments to branch
# -------------------------------------------------------

## Developtment branch
gh api repos/$GITHUB_USER/$REPO_NAME/environments/development \
  --method PUT \
  --input - << EOF
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF

gh api repos/$GITHUB_USER/$REPO_NAME/environments/development/deployment-branch-policies \
  --method POST \
  --field name="$DEV_BRANCH"

#  Main branch
gh api repos/$GITHUB_USER/$REPO_NAME/environments/production \
  --method PUT \
  --input - << EOF
{
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF

gh api repos/$GITHUB_USER/$REPO_NAME/environments/production/deployment-branch-policies \
  --method POST \
  --field name="$PROD_BRANCH"

echo ""
echo "✅ All done! Environments and secrets configured:"
echo "   https://github.com/$GITHUB_USER/$REPO_NAME/settings/environments"