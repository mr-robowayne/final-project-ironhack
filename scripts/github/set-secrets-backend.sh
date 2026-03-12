#!/usr/bin/env bash
# =============================================================================
# set-secrets-backend.sh — GitHub Secrets für Backend CI/CD Pipeline setzen
#
# Verwendung:
#   ./scripts/github/set-secrets-backend.sh
#
# Voraussetzungen:
#   - GitHub CLI installiert: brew install gh
#   - Eingeloggt: gh auth login
#   - ansible-vault encrypt bereits ausgeführt (vault.yml verschlüsselt)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
REPO="${GITHUB_USER}/${REPO_NAME}"

AWS_ROLE_ARN="arn:aws:iam::648786395667:role/patientsync-github-actions-role"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  patientsync — GitHub Secrets Backend CI/CD                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "  Repo: ${REPO}"
echo ""

# ── Prüfungen ─────────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "✗ GitHub CLI nicht gefunden. Installieren mit: brew install gh"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "✗ Nicht eingeloggt. Bitte zuerst: gh auth login"
  exit 1
fi

# ── Ansible Vault Passwort — von Env-Variable oder interaktiv ────────────────
if [[ -z "${ANSIBLE_VAULT_PASS:-}" ]]; then
  echo ""
  echo "── Ansible Vault ──────────────────────────────────────────────"
  echo "  Das Passwort das du beim 'ansible-vault encrypt group_vars/vault.yml' vergibst."
  echo ""
  read -rsp "  ANSIBLE_VAULT_PASS : " ANSIBLE_VAULT_PASS
  echo ""
fi

if [[ -z "$ANSIBLE_VAULT_PASS" ]]; then
  echo "✗ Ansible Vault Passwort darf nicht leer sein."
  exit 1
fi

# ── Secrets setzen ────────────────────────────────────────────────────────────
echo ""
echo "── Secrets werden gesetzt... ──────────────────────────────────"

# AWS_ROLE_ARN auf repo-Ebene → alle Pipelines (Terraform dev+prod, Backend prod) erben es
echo "  [repo] AWS_ROLE_ARN"
gh secret set AWS_ROLE_ARN \
  --body "$AWS_ROLE_ARN" \
  --repo "$REPO"

# ANSIBLE_VAULT_PASS nur in production Environment → nur Backend-Deploy hat Zugriff
echo "  [production] ANSIBLE_VAULT_PASS"
gh secret set ANSIBLE_VAULT_PASS \
  --body "$ANSIBLE_VAULT_PASS" \
  --env production \
  --repo "$REPO"

# AWS_REGION als Variable (kein Secret nötig)
echo "  [repo] AWS_REGION variable"
gh variable set AWS_REGION \
  --body "eu-central-2" \
  --repo "$REPO"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✓ Alle Secrets gesetzt."
echo ""
echo "  Nächster Schritt:"
echo "  1. ansible-vault encrypt ansible/group_vars/vault.yml"
echo "  2. git add . && git commit -m 'ci: backend pipeline' && git push"
echo "══════════════════════════════════════════════════════════════"
