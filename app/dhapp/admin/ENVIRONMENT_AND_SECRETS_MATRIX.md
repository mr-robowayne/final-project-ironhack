# Environment and Secrets Matrix (AWS)
Date: 2026-03-11

## 1) Frontend (S3/CloudFront)
Frontend variables are public after build. Do NOT put secrets there.

### Public build vars (`REACT_APP_*`) - Parameter Store (String) or CI variables
- `REACT_APP_API_BASE`
- `REACT_APP_API_URL`
- `REACT_APP_DEFAULT_TENANT`
- `REACT_APP_LT_API_URL`
- `REACT_APP_CHAT_NOTIFICATION_PREVIEW`

Operational note:
- Source of truth is SSM prefix `/patientsync/prod/frontend`.
- Use `dhapp/admin/generate_frontend_build_env_from_ssm.sh` to generate `frontend.build.env`.
- Never use Secrets Manager values directly in frontend build variables.

### Dev-only (must be empty in prod)
- `REACT_APP_BACKEND_PORT`
- `REACT_APP_DEV_TENANT_ID`
- `REACT_APP_DEV_USER_ID`

Recommended production setup:
- `REACT_APP_API_BASE=` (empty)
- `REACT_APP_API_URL=` (empty)
- CloudFront behavior `/api/*` -> ALB (same origin)

## 2) Must go to AWS Secrets Manager

### backend-api
- `JWT_SECRET`
- `DB_PASSWORD`
- `TENANT_PROVISIONING_PASSWORD` (if used)
- `AI_GATEWAY_TOKEN`
- `BILLING_SERVICE_TOKEN`
- `SHARED_INTERNAL_SECRET`
- `AUDIT_SALT`
- `DUMMY_PASSWORD_HASH` (if used)

### login-gateway
- `JWT_SECRET`
- `DB_PASSWORD`
- `DUMMY_PASSWORD_HASH` (if used)

### billing-service
- `JWT_SECRET`
- `DB_PASSWORD`
- `BILLING_SERVICE_TOKEN`

### ai-service
- `OPENAI_API_KEY`
- `AI_GATEWAY_TOKEN`

## 3) Parameter Store (non-secret config)
- `APP_ENV`, `NODE_ENV`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SSLMODE`
- `REQUIRE_DB_TLS_IN_PROD`, `DB_SSL_REJECT_UNAUTHORIZED`
- `DEFAULT_TENANT_ID`, `TENANT_CONFIG_PATH`
- `CORS_ORIGIN`, `CORS_ALLOWLIST`
- `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_SAMESITE`
- `AI_SERVICE_URL`, `BILLING_SERVICE_URL`
- `S3_REGION`, `S3_PATIENT_FILES_BUCKET`, `S3_AI_SOURCE_BUCKET`
- `REDIS_URL`

## 4) Example naming convention
- `/dhapp/prod/frontend/REACT_APP_API_BASE`
- `/dhapp/prod/backend/DB_HOST`
- `/dhapp/prod/backend/DB_NAME`
- `/dhapp/prod/secrets/JWT_SECRET` (Secrets Manager)

## 5) Production checks
- No `REACT_APP_DEV_*` values in prod build
- No credentials in frontend bundle (`dhapp/frontend`)
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax/Strict`
- S3 bucket public access blocked; CloudFront OAC enabled
- KMS encryption enabled for S3, RDS, and secrets
