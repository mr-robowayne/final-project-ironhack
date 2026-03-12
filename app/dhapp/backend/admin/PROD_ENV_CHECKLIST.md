# Backend Prod Environment Checklist
Date: 2026-03-11

## Before first deploy

1. `APP_ENV=production` und `NODE_ENV=production` gesetzt.
2. `FORCE_HTTPS=true` (backend-api).
3. `SESSION_COOKIE_NAME` ist in `backend-api`, `billing-service` und `login-gateway` identisch.
4. `SESSION_COOKIE_SECURE=true` und `SESSION_COOKIE_SAMESITE=lax|strict` gesetzt.
5. `JWT_EXPIRES_HOURS` ist gesetzt und `JWT_EXPIRES_HOURS_MAX` begrenzt das Maximum (empfohlen 24).
6. `DB_SSLMODE` + `REQUIRE_DB_TLS_IN_PROD=true` korrekt gesetzt.
7. `CORS_ORIGIN/CORS_ALLOWLIST` nur mit echten produktiven Domains.
8. Secrets in Secrets Manager angelegt und injiziert.
9. Keine `change_me` Placeholder mehr vorhanden.
10. `DEFAULT_APP_REDIRECT_URL` und `TENANT_APP_REDIRECT_MAP` auf echte Frontend-Domain gesetzt.

## S3 and Storage

1. `DOCUMENTS_BUCKET_NAME=patientsync-prod-documents-eu-central-2` gesetzt (backend-api).
2. `AWS_REGION=eu-central-2` gesetzt.
3. Bucket mit SSE-KMS (`alias/patientsync-prod-documents`), Block Public Access und Lifecycle-Regeln konfiguriert.
4. EC2 Instance Role hat S3-Berechtigungen — keine statischen AWS-Schlüssel erforderlich oder erlaubt.

## Inter-service auth

1. `AI_GATEWAY_TOKEN` identisch in backend-api und ai-service.
2. `BILLING_SERVICE_TOKEN` identisch in backend-api und billing-api.
3. `JWT_SECRET` identisch in backend-api, billing-api, login-gateway.

## Final check

1. `docker compose config` ohne Fehler.
2. Healthchecks aktiv (`/api/health`, `/health`).
3. Login, Kalender, Tasks, Chat, Billing Endpoints einmal smoke-testen.
