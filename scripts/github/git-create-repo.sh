#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# git-create-repo.sh — Neues GitHub Repo erstellen (sauberer Start)
#
# Was passiert:
#   1. Altes .git entfernen (falls vorhanden)
#   2. Neues Git-Repo initialisieren
#   3. ALLES commiten (ein sauberer Initial Commit)
#   4. Privates Repo auf GitHub erstellen + pushen
#   5. Environments + Secrets konfigurieren (setup-all.sh)
#
# Verwendung:
#   ./scripts/github/git-create-repo.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_ROOT"

# --- KONFIGURATION ---
GITHUB_USER="mr-robowayne"
REPO_NAME="patientsync"
REPO="${GITHUB_USER}/${REPO_NAME}"
# ---------------------

echo ""
echo "======================================================================"
echo "  patientsync — Neues GitHub Repo erstellen"
echo "======================================================================"
echo "  Repo: ${REPO} (private)"
echo "  Root: ${PROJECT_ROOT}"
echo ""

# ── Pruefungen ──────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "[FEHLER] GitHub CLI nicht gefunden. Installieren mit: brew install gh"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "[FEHLER] Nicht eingeloggt. Bitte zuerst: gh auth login"
  exit 1
fi

# ── Warnung falls Repo schon existiert ──────────────────────────────────────
if gh repo view "$REPO" &>/dev/null; then
  echo "[WARN] Repo ${REPO} existiert bereits auf GitHub!"
  echo "       Das Script wird es loeschen und neu erstellen."
  echo ""
  read -rp "  Repo loeschen und neu erstellen? [ja/N]: " CONFIRM
  if [ "$CONFIRM" != "ja" ]; then
    echo "[ABBRUCH] Nichts geaendert."
    exit 0
  fi
  echo "  Loesche ${REPO}..."
  gh repo delete "$REPO" --yes
  echo "[OK] Altes Repo geloescht."
  echo ""
fi

# ── Altes .git entfernen ───────────────────────────────────────────────────
if [ -d ".git" ]; then
  echo "[INFO] Entferne altes .git Verzeichnis..."
  rm -rf .git
  echo "[OK] .git entfernt."
fi

# ── Neues Git-Repo initialisieren ──────────────────────────────────────────
echo "[INFO] Initialisiere neues Git-Repo..."
git init -b main
echo "[OK] Git initialisiert (branch: main)"

# ── Alles commiten ─────────────────────────────────────────────────────────
echo "[INFO] Stage alle Dateien..."
git add .

echo "[INFO] Pruefe was NICHT getrackt wird (.gitignore):"
echo "       - *.tfvars (Terraform Secrets)"
echo "       - **/vault.yml (Ansible Vault)"
echo "       - *.env (Docker/App Secrets)"
echo "       - db/flyway.conf (lokale DB Config)"
echo ""

git commit -m "initial commit"
echo "[OK] Initial Commit erstellt."

# ── Repo auf GitHub erstellen + pushen ─────────────────────────────────────
echo "[INFO] Erstelle privates Repo auf GitHub..."
gh repo create "$REPO" --private --source=. --remote=origin --push
echo "[OK] Repo erstellt und gepusht: https://github.com/${REPO}"
echo ""

# ── Environments + Secrets konfigurieren ───────────────────────────────────
echo "======================================================================"
echo "  Secrets + Environments konfigurieren"
echo "======================================================================"
echo ""

bash "${SCRIPT_DIR}/setup-all.sh"

echo ""
echo "======================================================================"
echo "[OK] Alles fertig!"
echo ""
echo "  Repo:     https://github.com/${REPO}"
echo "  Branch:   main"
echo ""
echo "  Naechste Schritte:"
echo "  1. Pipeline triggern: git push / workflow_dispatch"
echo "  2. Oder manuell: gh workflow run backend-build.yml"
echo "======================================================================"
