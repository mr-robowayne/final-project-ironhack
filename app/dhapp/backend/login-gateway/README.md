# Login Gateway Service

Dedizierter Auth-Einstiegspunkt als eigener Container.

## Zweck

- übernimmt Login (nicht die Fach-API)
- erzeugt JWT + persistiert Session in `user_sessions`
- setzt signiertes Session-Cookie
- leitet tenant-basiert an die passende App-URL weiter

## Wichtige ENV

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`
- `JWT_SECRET`, `JWT_EXPIRES_HOURS`
- `DEFAULT_TENANT_ID`
- `DEFAULT_APP_REDIRECT_URL`
- `TENANT_APP_REDIRECT_MAP` (z. B. `test=http://localhost:3000,doktorhaus=http://localhost:3001`)
- `SESSION_COOKIE_DOMAIN` (optional für Cross-Subdomain-Cookie)

## Endpunkte

- `GET /login`: HTML Login-Seite
- `POST /login`: Form-Login, Redirect bei Erfolg
- `POST /auth/login`: JSON-Login, JSON-Antwort mit `redirectUrl`
- `POST /auth/logout`: Session revoke + Cookie löschen
- `GET /health`: Healthcheck
