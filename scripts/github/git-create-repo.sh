#!/bin/bash
set -e

# Navigiere zum Projekt-Root (damit git add .github und find terraform funktionieren)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

# --- KONFIGURATION ---
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
AWS_REGION="eu-central-2"
AWS_ROLE_ARN="arn:aws:iam::648786395667:role/patientsync-github-actions-role"
# ---------------------

echo "🚀 Starte Setup für GitHub Repo: $GITHUB_USER/$REPO_NAME (PRIVATE)"

# 1. Repo erstellen (falls nicht existiert)
if gh repo view "$GITHUB_USER/$REPO_NAME" >/dev/null 2>&1; then
    echo "✅ Repo existiert bereits."
else
    echo "📦 Initialisiere Git & lade NUR Pipeline-Code hoch..."
    
    # 1. Git initialisieren
    git init
    
    # 2. NUR Infrastruktur-Ordner hinzufügen (Kein App-Code!)
    git add .github terraform scripts .gitignore
    
    git commit -m "Initial Infrastructure Setup"
    gh repo create "$GITHUB_USER/$REPO_NAME" --private --source=. --remote=origin --push
fi

# 2. Secrets setzen (für OIDC Login)
echo "🔐 Setze Secrets..."
gh secret set AWS_ROLE_ARN --body "$AWS_ROLE_ARN" --repo "$GITHUB_USER/$REPO_NAME"

# Automatische Suche aller variables.tfvars Dateien
echo "🔍 Suche nach variables.tfvars Dateien..."
find terraform -name "variables.tfvars" | while read file; do
    dir=$(dirname "$file")
    folder_name=$(basename "$dir")
    # Erzeugt Secret-Namen wie TF_VARS_DEPLOY_AWS_RESSOURCES (Uppercase + Underscore)
    secret_name="TF_VARS_$(echo "$folder_name" | tr '[:lower:]-' '[:upper:]_')"
    echo "   👉 Lade hoch: $file -> Secret: $secret_name"
    gh secret set "$secret_name" < "$file" --repo "$GITHUB_USER/$REPO_NAME"
done

# 3. Variablen setzen (für Region)
echo "🌍 Setze Variablen..."
gh variable set AWS_REGION --body "$AWS_REGION" --repo "$GITHUB_USER/$REPO_NAME"

# 4. Environments erstellen (für Protection Rules, falls nötig)
# (Optional: GitHub erstellt Environments oft erst beim ersten Push automatisch, 
# aber wir können sie hier vorbereiten, wenn du die Pro-Version hast)

echo "✅ Fertig! Repo ist bereit: https://github.com/$GITHUB_USER/$REPO_NAME"
echo "👉 Du kannst jetzt 'git push' machen, um die Pipeline zu starten."