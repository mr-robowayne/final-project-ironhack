#!/bin/bash
set -e

# Navigiere zum Projekt-Root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

# --- KONFIGURATION ---
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
# ---------------------

echo "🔄 Starte Update ALLER Secrets für $GITHUB_USER/$REPO_NAME..."

# Loop über alle variables.tfvars in allen Unterordnern
find terraform -name "variables.tfvars" | while read file; do
    dir=$(dirname "$file")
    folder_name=$(basename "$dir")
    
    # Erzeugt Secret-Namen wie TF_VARS_DEPLOY_AWS_RESSOURCES oder TF_VARS_BOOTSTRAP
    secret_name="TF_VARS_$(echo "$folder_name" | tr '[:lower:]-' '[:upper:]_')"
    
    echo "uploade $file als Secret $secret_name..."
    gh secret set "$secret_name" < "$file" --repo "$GITHUB_USER/$REPO_NAME"
done

echo "✅ Fertig! Alle tfvars wurden synchronisiert."