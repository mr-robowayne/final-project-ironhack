#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# setup-all.sh — Vollständiges GitHub Setup für patientsync
#
# Führt aus:
#   1. Environments einrichten (development + production mit Approval)
#   2. Terraform Secrets setzen (TF_VARS_*, AWS_ROLE_ARN repo-level)
#   3. Frontend Secrets setzen (AWS_FRONTEND_ROLE_ARN, FRONTEND_BUCKET_NAME)
#   4. Backend Secrets setzen (ANSIBLE_VAULT_PASS, AWS_ROLE_ARN production env)
#
# Verwendung:
#   ./scripts/github/setup-all.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  patientsync — GitHub Komplett-Setup                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Prüfungen
if ! command -v gh &>/dev/null; then
  echo "✗ GitHub CLI nicht gefunden. Installieren mit: brew install gh"
  exit 1
fi
if ! gh auth status &>/dev/null; then
  echo "✗ Nicht eingeloggt. Bitte zuerst: gh auth login"
  exit 1
fi

# ── Secrets sammeln ───────────────────────────────────────────────────────────
echo "── Secrets eingeben ──────────────────────────────────────────"
echo ""

read -rsp "  ANSIBLE_VAULT_PASS (Backend Deploy): " ANSIBLE_VAULT_PASS
echo ""

if [[ -z "$ANSIBLE_VAULT_PASS" ]]; then
  echo "✗ ANSIBLE_VAULT_PASS darf nicht leer sein."
  exit 1
fi

echo ""
echo "── Setup startet... ──────────────────────────────────────────"
echo ""

# ── Schritt 1: Environments ───────────────────────────────────────────────────
echo "▶ Schritt 1/4: Environments (development + production mit Approval)"
bash "${SCRIPT_DIR}/git-setup-enviroments.sh"
echo ""

# ── Schritt 2: Terraform Secrets ─────────────────────────────────────────────
echo "▶ Schritt 2/4: Terraform Secrets (TF_VARS_*, AWS_ROLE_ARN)"
bash "${SCRIPT_DIR}/update-secrets-terraform-tfvars.sh"
echo ""

# ── Schritt 3: Frontend Secrets ───────────────────────────────────────────────
echo "▶ Schritt 3/4: Frontend Secrets"
bash "${SCRIPT_DIR}/set-secrets-frontend.sh"
echo ""

# ── Schritt 4: Backend Secrets ────────────────────────────────────────────────
echo "▶ Schritt 4/4: Backend Secrets (ANSIBLE_VAULT_PASS, AWS_ROLE_ARN production)"
ANSIBLE_VAULT_PASS="$ANSIBLE_VAULT_PASS" bash "${SCRIPT_DIR}/set-secrets-backend.sh"
echo ""

echo "══════════════════════════════════════════════════════════════"
echo "✓ Komplett-Setup abgeschlossen."
echo ""
echo "  Nächste Schritte:"
echo "  1. ansible-vault encrypt ansible/group_vars/vault.yml"
echo "  2. git push origin development  → startet development Pipeline"
echo "  3. PR development → main öffnen → du bekommst Approval-Request"
echo "══════════════════════════════════════════════════════════════"
