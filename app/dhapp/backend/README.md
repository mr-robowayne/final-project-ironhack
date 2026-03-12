# dhapp/backend

Dieses Paket ist zum Bauen der Backend-Images vorbereitet.

## Enthaltene Services

- `api` (Haupt-Backend)
- `billing-service`
- `ai-service`
- `login-gateway`
- `env/*.env.example` (Beispielvariablen)

## Images lokal bauen

```bash
cd dhapp/backend
./build-images.sh local
```

Oder direkt per Compose:

```bash
cd dhapp/backend
IMAGE_TAG=local docker compose -f docker-compose.images.yml build
```

## Erwartete Images

- `dhapp/backend-api:<tag>`
- `dhapp/billing-api:<tag>`
- `dhapp/ai-service:<tag>`
- `dhapp/login-gateway:<tag>`

## Für AWS/ECR

1. Lokal bauen mit Tag (z. B. `v1`).
2. Pro Image ein ECR-Repository verwenden.
3. Images nach ECR taggen und pushen.
4. Auf EC2 mit deinem Runtime-Compose diese Image-Tags deployen.

## Admin Doku (Env + Secrets)

- `admin/README.md`
- `admin/ENVIRONMENT_AND_SECRETS_MATRIX.md`
- `admin/SECRETS_MANAGER_REQUIRED.txt`
- `admin/PARAMETER_STORE_REQUIRED.txt`
- `admin/PROD_ENV_CHECKLIST.md`

## Hinweise

- Die `.env.example` Dateien sind nur Vorlagen.
- Secrets (`JWT_SECRET`, `DB_PASSWORD`, `OPENAI_API_KEY`, Tokens) nicht im Repo speichern, sondern via AWS Secrets Manager/SSM injizieren.
