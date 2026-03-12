'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEFAULT_JWT_EXPIRES_HOURS = 24;
const DEFAULT_JWT_EXPIRES_HOURS_MAX = 24;

function resolveJwtExpiresHours() {
  const configured = Number(process.env.JWT_EXPIRES_HOURS || DEFAULT_JWT_EXPIRES_HOURS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_JWT_EXPIRES_HOURS;
  const maxConfigured = Number(process.env.JWT_EXPIRES_HOURS_MAX || DEFAULT_JWT_EXPIRES_HOURS_MAX);
  const maxAllowed = Number.isFinite(maxConfigured) && maxConfigured > 0 ? maxConfigured : DEFAULT_JWT_EXPIRES_HOURS_MAX;
  return Math.max(1, Math.min(configured, maxAllowed));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function resolveClientMeta(req) {
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwardedFor || req?.ip || req?.socket?.remoteAddress || null;
  const userAgent = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 400) : null;
  return { ip, userAgent };
}

async function createSessionToken({ tenantCtx, user, jwtSecret, req, expiresHours }) {
  if (!tenantCtx?.db) throw new Error('Tenant context mit Datenbankverbindung fehlt.');
  if (!user?.id) throw new Error('Benutzer-ID fehlt für Session-Erzeugung.');
  if (!jwtSecret) throw new Error('JWT_SECRET fehlt.');

  const ttlHours = Number.isFinite(Number(expiresHours)) ? Number(expiresHours) : resolveJwtExpiresHours();
  const sessionId = crypto.randomUUID();
  const tokenPayload = {
    id: user.id,
    tenant: tenantCtx.id,
    role: user.role || user.rolle,
    sid: sessionId,
  };
  const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: `${ttlHours}h` });
  const tokenHash = hashToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlHours * 60 * 60 * 1000);
  const { ip, userAgent } = resolveClientMeta(req);

  await tenantCtx.db.query(
    `INSERT INTO user_sessions (
       session_id,
       tenant_id,
       user_id,
       token_hash,
       issued_at,
       expires_at,
       user_agent,
       ip_address,
       metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      sessionId,
      tenantCtx.id,
      Number(user.id),
      tokenHash,
      issuedAt,
      expiresAt,
      userAgent,
      ip,
      { role: user.role || user.rolle || null },
    ]
  );

  return {
    token,
    sessionId,
    expiresAt,
    ttlHours,
  };
}

async function validateSessionToken({ tenantCtx, payload, token }) {
  if (!tenantCtx?.db) return { ok: false, reason: 'TENANT_DB_MISSING' };
  if (!payload?.sid) return { ok: false, reason: 'SESSION_ID_MISSING' };
  const sessionId = String(payload.sid);
  const tokenHash = hashToken(token);

  const { rows } = await tenantCtx.db.query(
    `SELECT session_id,
            tenant_id,
            user_id,
            token_hash,
            expires_at,
            revoked_at
       FROM user_sessions
      WHERE session_id = $1
        AND tenant_id = $2
        AND user_id = $3
      LIMIT 1`,
    [sessionId, tenantCtx.id, Number(payload.id)]
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'SESSION_NOT_FOUND' };
  if (row.revoked_at) return { ok: false, reason: 'SESSION_REVOKED' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'SESSION_EXPIRED' };
  if (row.token_hash !== tokenHash) return { ok: false, reason: 'TOKEN_HASH_MISMATCH' };

  await tenantCtx.db.query(
    'UPDATE user_sessions SET last_seen_at = now() WHERE session_id = $1',
    [sessionId]
  );

  return { ok: true, session: row };
}

async function revokeSessionById({ tenantCtx, sessionId }) {
  if (!tenantCtx?.db || !sessionId) return;
  await tenantCtx.db.query(
    `UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, now())
      WHERE tenant_id = $1
        AND session_id = $2`,
    [tenantCtx.id, String(sessionId)]
  );
}

module.exports = {
  resolveJwtExpiresHours,
  createSessionToken,
  validateSessionToken,
  revokeSessionById,
};
