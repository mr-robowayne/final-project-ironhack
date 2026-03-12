# Backend Environment and Secrets Matrix (AWS)
Date: 2026-03-11

## 1) Services

- `backend-api` (Port 5000)
- `billing-api` (Port 8090)
- `ai-service` (Port 8088)
- `login-gateway` (Port 8080)

## 2) AWS Secrets Manager (sensitiv)

### backend-api
- `JWT_SECRET`
- `DB_PASSWORD`
- `TENANT_PROVISIONING_PASSWORD` (falls gesetzt)
- `AI_GATEWAY_TOKEN`
- `BILLING_SERVICE_TOKEN`
- `SHARED_INTERNAL_SECRET`
- `AUDIT_SALT` (falls Audit-Hashing genutzt wird)
- `DUMMY_PASSWORD_HASH` (falls aktiv)
- `MEDIDATABOX_TOKEN` (falls Medidata aktiv)

### billing-api
- `JWT_SECRET`
- `DB_PASSWORD`
- `BILLING_SERVICE_TOKEN`
- `MEDIDATABOX_TOKEN` (falls aktiv)

### ai-service
- `OPENAI_API_KEY`
- `AI_GATEWAY_TOKEN`

### login-gateway
- `JWT_SECRET`
- `DB_PASSWORD`
- `DUMMY_PASSWORD_HASH` (falls aktiv)

## 3) Parameter Store (nicht sensitiv)

### Common
- `APP_ENV`, `NODE_ENV`, `BIND_PUBLIC`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`
- `DB_SSLMODE`, `DB_SSL_REJECT_UNAUTHORIZED`
- `REQUIRE_DB_TLS_IN_PROD`, `ALLOW_INSECURE_DB_SSL`

### backend-api
- `BACKEND_PORT`
- `REQUIRE_AUTH`, `FORCE_HTTPS`, `EXPOSE_INTERNAL_ERRORS`
- `DEFAULT_TENANT_ID`, `DEFAULT_TENANTS`
- `TENANT_CONFIG_PATH`, `TENANT_STORAGE_BASE_PATH`
- `TENANT_PROVISIONING_HOST`, `TENANT_PROVISIONING_PORT`, `TENANT_PROVISIONING_DATABASE`, `TENANT_PROVISIONING_USER`, `TENANT_PROVISIONING_SSLMODE`
- `CORS_ORIGIN`, `CORS_ALLOWLIST`
- `AI_SERVICE_URL`, `BILLING_SERVICE_URL`
- `DOCUMENTS_BUCKET_NAME` (= `patientsync-prod-documents-eu-central-2`)
- `AWS_REGION` (= `eu-central-2`)
- Note: No S3 access keys — EC2 instance role (IAM) provides credentials automatically.
- `ENABLE_XSD_VALIDATION`, `INVOICE_XSD_PATH`
- `AUDIT_RETENTION_DAYS`

### billing-api
- `PORT`
- `DEFAULT_TENANT_ID` (= `dhpatientsync`)
- `TENANT_CONFIG_PATH`

### ai-service
- `PORT`
- `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_REASONING_EFFORT`

### login-gateway
- `LOGIN_PORT`, `PORT`, `TRUST_PROXY_HOPS`
- `DEFAULT_TENANT_ID`, `REQUIRE_TENANT_REGISTRY`
- `DEFAULT_APP_REDIRECT_URL`, `TENANT_APP_REDIRECT_MAP`
- `SESSION_COOKIE_NAME`, `SESSION_COOKIE_DOMAIN`, `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_SAMESITE`
- `CORS_ORIGIN`

## 4) Shared Values that must match

- `JWT_SECRET` muss in `backend-api`, `billing-api`, `login-gateway` konsistent sein.
- `AI_GATEWAY_TOKEN` muss in `backend-api` und `ai-service` konsistent sein.
- `BILLING_SERVICE_TOKEN` muss in `backend-api` und `billing-api` konsistent sein.
- `DB_*` Werte müssen auf dieselbe RDS-Instanz zeigen.

## 5) Naming Convention (Beispiel)

- Parameter Store:
  - `/dhapp/prod/backend/common/DB_HOST`
  - `/dhapp/prod/backend/api/CORS_ALLOWLIST`
  - `/dhapp/prod/backend/ai/OPENAI_MODEL`
- Secrets Manager:
  - `/dhapp/prod/secrets/JWT_SECRET`
  - `/dhapp/prod/secrets/DB_PASSWORD`
  - `/dhapp/prod/secrets/OPENAI_API_KEY`

## 6) Security Rules

- Keine Secrets in `docker-compose.yml`, `.env.example`, Git oder Image-Layer.
- In AWS bevorzugt IAM Role statt statische `S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY`.
- `SESSION_COOKIE_SECURE=true` in Produktion hinter HTTPS.
- `FORCE_HTTPS=true`, `REQUIRE_DB_TLS_IN_PROD=true` in Produktion.
