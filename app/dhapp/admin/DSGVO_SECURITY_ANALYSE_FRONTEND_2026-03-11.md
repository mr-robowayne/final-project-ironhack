# DSGVO / Security Analyse - Frontend
Date: 2026-03-11
Scope: `frontend/app/src` (static code review)

## Summary
Frontend is deployable to S3/CloudFront, but DSGVO compliance depends on strict production configuration and a few remaining hardening tasks.

Implemented now:
- JWT is no longer persisted in browser storage (`frontend/app/src/api.js`)
- Dev override headers are blocked in production builds (`frontend/app/src/api.js`)
- `dangerouslySetInnerHTML` removed in chat and notes preview
- Chat OS notifications use privacy-safe body by default (no message preview)

## Findings (prioritized)

### MEDIUM
1. External language service can transfer medical text
- `frontend/app/src/Briefe.js:357`
Risk:
- If `REACT_APP_LT_API_URL` points to third-party/non-compliant endpoint, data transfer risk.
Action:
- Use internal CH/EU-hosted endpoint only.
- Keep it empty in production if not contractually compliant.

### LOW
2. Session/user metadata in sessionStorage
- `frontend/app/src/api.js:21`
- `frontend/app/src/api.js:27`
Risk:
- Tenant/user IDs are less sensitive than tokens but still client-side metadata.
Action:
- Acceptable for UX, but clear on logout and document in TOM/records.

3. Optional notification preview toggle must remain disabled in production
- `REACT_APP_CHAT_NOTIFICATION_PREVIEW`
Risk:
- If set to `true`, message preview can appear in OS notifications.
Action:
- Keep `REACT_APP_CHAT_NOTIFICATION_PREVIEW=false` in prod.

## Technical controls required for production
1. CloudFront + ALB same-origin routing
- `/api/*` -> ALB
- static -> S3

2. Cookie/session hardening (backend)
- `HttpOnly`, `Secure`, `SameSite`
- short session TTL + server-side revocation

3. AWS security baseline
- S3 Block Public Access + OAC
- SSE-KMS for S3 and RDS
- WAF on ALB/CloudFront
- CloudTrail + CloudWatch retention and access controls

4. Frontend build hygiene
- No secrets in `REACT_APP_*`
- `REACT_APP_DEV_*` empty in prod

## Compliance note
This is a technical security review, not legal certification. Final DSGVO compliance requires legal/process controls (DPA, retention policy, RoPA, incident process, access governance).
