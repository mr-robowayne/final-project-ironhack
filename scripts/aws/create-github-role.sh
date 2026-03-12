#!/bin/bash
set -e

# --- KONFIGURATION ---
# BITTE ANPASSEN: Dein GitHub Benutzername oder Organisationsname
GITHUB_ORG="mr-robowayne" 
REPO_NAME="patientsync"
AWS_REGION="eu-central-2"
AWS_ACCOUNT_ID="648786395667"
ROLE_NAME="patientsync-github-actions-role"
BACKEND_ROLE_NAME="patientsync-prod-tf-backend-role"
# ---------------------

echo "Erstelle GitHub Actions Rolle für Repo: $GITHUB_ORG/$REPO_NAME"

# 1. OIDC Provider prüfen/erstellen (GitHub Actions Thumbprint ist Standard)
OIDC_PROVIDER_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1; then
  echo "OIDC Provider existiert bereits."
else
  echo "Erstelle OIDC Provider..."
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
fi

# 2. Trust Policy erstellen (Nur DIESES Repo darf die Rolle annehmen)
cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$OIDC_PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG}/${REPO_NAME}:*"
        },
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

# 3. Rolle erstellen
echo "Erstelle/Aktualisiere Rolle $ROLE_NAME..."
aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document file://trust-policy.json || aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document file://trust-policy.json

# 4. Berechtigung geben, die Terraform-Backend-Rolle zu "assumen"
echo "Hänge Permission Policy an..."
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "AllowAssumeBackendRole" --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Resource\":\"arn:aws:iam::${AWS_ACCOUNT_ID}:role/${BACKEND_ROLE_NAME}\"}]}"

rm trust-policy.json
echo "FERTIG! Rolle erstellt: arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"
echo "-> Führe jetzt 'terraform apply' im Bootstrap-Ordner aus, damit die Backend-Rolle dieser neuen Rolle vertraut."