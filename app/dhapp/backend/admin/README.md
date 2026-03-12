# DHAPP Backend Admin Kit

Date: 2026-03-11

Dieses Verzeichnis enthält die Betriebsdoku für Backend-Deployment mit Fokus auf `environments`, `secrets` und Go-Live-Checks.

## Dateien

- `ENVIRONMENT_AND_SECRETS_MATRIX.md`
- `SECRETS_MANAGER_REQUIRED.txt`
- `PARAMETER_STORE_REQUIRED.txt`
- `PROD_ENV_CHECKLIST.md`

## Ziel

- Keine Secrets im Git-Repo, `.env` oder Docker-Image.
- Saubere Trennung: AWS Secrets Manager (sensitiv) vs. Parameter Store (nicht sensitiv).
- Einheitliche Variablennamen über `backend-api`, `billing-api`, `ai-service`, `login-gateway`.

## Quick Start (AWS)

1. Secrets in Secrets Manager anlegen (siehe `SECRETS_MANAGER_REQUIRED.txt`).
2. Nicht-sensitive Werte in Parameter Store anlegen (siehe `PARAMETER_STORE_REQUIRED.txt`).
3. Werte zur Laufzeit per EC2 Role + Startskript in Container-Umgebung injizieren.
4. Images bauen mit `dhapp/backend/build-images.sh <tag>`.
5. Runtime-Compose/Service-Definition mit diesen Variablen deployen.
