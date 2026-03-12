#!/bin/bash
set -e

# Navigiere zum Projekt-Root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

# --- KONFIGURATION (HIER EINTRAGEN!) ---
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"

# Die Werte, die du für das Frontend brauchst:
# 1. Die Rolle aus dem create-s3frontend-role.sh Skript
AWS_FRONTEND_ROLE_ARN="arn:aws:iam::648786395667:role/patientsync-frontend-deploy-role"

# 2. Dein S3 Bucket Name
FRONTEND_BUCKET_NAME="patientsync-prod-frontend"

# 3. Deine CloudFront ID (Optional, leer lassen wenn nicht vorhanden)
CLOUDFRONT_DISTRIBUTION_ID="" 
# ---------------------------------------

echo "🚀 Konfiguriere Frontend-Secrets für $GITHUB_USER/$REPO_NAME..."

# 1. Setze die Variable für den Bucket-Namen (Vars sind nicht geheim)
echo "🌍 Setze Variable: FRONTEND_BUCKET_NAME -> $FRONTEND_BUCKET_NAME"
gh variable set FRONTEND_BUCKET_NAME --body "$FRONTEND_BUCKET_NAME" --repo "$GITHUB_USER/$REPO_NAME"

# 2. Setze das Secret für die Rolle
echo "🔐 Setze Secret: AWS_FRONTEND_ROLE_ARN"
gh secret set AWS_FRONTEND_ROLE_ARN --body "$AWS_FRONTEND_ROLE_ARN" --repo "$GITHUB_USER/$REPO_NAME"

# 3. Setze das Secret für CloudFront (falls vorhanden)
if [[ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
    echo "🔐 Setze Secret: CLOUDFRONT_DISTRIBUTION_ID"
    gh secret set CLOUDFRONT_DISTRIBUTION_ID --body "$CLOUDFRONT_DISTRIBUTION_ID" --repo "$GITHUB_USER/$REPO_NAME"
fi

echo "✅ Fertig! Die Frontend-Pipeline hat jetzt alle Infos."
echo "👉 Du kannst jetzt pushen!"