'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function readSslConfig() {
  const explicit = first(process.env.DB_SSL, process.env.PG_SSL);
  const sslMode = first(process.env.DB_SSLMODE, process.env.PGSSLMODE).toLowerCase();
  const enabled = asBool(explicit, false) || ['require', 'verify-ca', 'verify-full'].includes(sslMode);
  if (!enabled) return undefined;
  return {
    rejectUnauthorized: asBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, false) || ['verify-ca', 'verify-full'].includes(sslMode),
  };
}

function readDatabaseConfig() {
  const connectionString = first(process.env.DATABASE_URL, process.env.DB_URL);
  const ssl = readSslConfig();
  if (connectionString) {
    return { connectionString, ssl };
  }
  return {
    host: first(process.env.DB_HOST, process.env.PGHOST, '127.0.0.1'),
    port: asNumber(first(process.env.DB_PORT, process.env.PGPORT, '5432'), 5432),
    user: first(process.env.DB_USER, process.env.PGUSER, 'postgres'),
    password: first(process.env.DB_PASSWORD, process.env.PGPASSWORD),
    database: first(process.env.DB_NAME, process.env.PGDATABASE, 'postgres'),
    ssl,
  };
}

const APP_ENV = first(process.env.APP_ENV, process.env.NODE_ENV, 'development').toLowerCase();
const LOGIN_PORT = asNumber(first(process.env.LOGIN_PORT, process.env.PORT, '8080'), 8080);
const BIND_PUBLIC = asBool(process.env.BIND_PUBLIC, true);
const HOST = BIND_PUBLIC ? '0.0.0.0' : '127.0.0.1';
const JWT_SECRET = first(process.env.JWT_SECRET, 'CHANGE_ME');
const JWT_EXPIRES_HOURS = asNumber(first(process.env.JWT_EXPIRES_HOURS, '24'), 24);
const JWT_EXPIRES_HOURS_MAX = asNumber(first(process.env.JWT_EXPIRES_HOURS_MAX, '24'), 24);
const JWT_EXPIRES_HOURS_EFFECTIVE = Math.max(
  1,
  Math.min(
    Number.isFinite(JWT_EXPIRES_HOURS) ? JWT_EXPIRES_HOURS : 24,
    Number.isFinite(JWT_EXPIRES_HOURS_MAX) && JWT_EXPIRES_HOURS_MAX > 0 ? JWT_EXPIRES_HOURS_MAX : 24
  )
);
const DEFAULT_TENANT_ID = first(process.env.DEFAULT_TENANT_ID, 'test');
const DEFAULT_APP_REDIRECT_URL = first(process.env.DEFAULT_APP_REDIRECT_URL, 'http://localhost:3000');
const REQUIRE_TENANT_REGISTRY = asBool(process.env.REQUIRE_TENANT_REGISTRY, false);
const SESSION_COOKIE_NAME = first(process.env.SESSION_COOKIE_NAME, 'session');
const SESSION_COOKIE_DOMAIN = first(process.env.SESSION_COOKIE_DOMAIN);
const SESSION_COOKIE_SECURE = asBool(process.env.SESSION_COOKIE_SECURE, APP_ENV === 'production');
const SESSION_COOKIE_SAMESITE_RAW = first(process.env.SESSION_COOKIE_SAMESITE, 'lax').toLowerCase();
const SESSION_COOKIE_SAMESITE = ['lax', 'strict', 'none'].includes(SESSION_COOKIE_SAMESITE_RAW) ? SESSION_COOKIE_SAMESITE_RAW : 'lax';
const CORS_ORIGIN = first(process.env.CORS_ORIGIN);
const TRUST_PROXY_HOPS = asNumber(first(process.env.TRUST_PROXY_HOPS, '1'), 1);
const DUMMY_PASSWORD_HASH = process.env.DUMMY_PASSWORD_HASH || bcrypt.hashSync('dummy-password', 10);

if (APP_ENV === 'production' && JWT_SECRET === 'CHANGE_ME') {
  console.error('FATAL: JWT_SECRET must be set for login gateway in production');
  process.exit(1);
}

if (SESSION_COOKIE_SAMESITE_RAW !== SESSION_COOKIE_SAMESITE) {
  console.warn(`WARN: Invalid SESSION_COOKIE_SAMESITE "${SESSION_COOKIE_SAMESITE_RAW}", fallback to "lax".`);
}

if (APP_ENV === 'production' && SESSION_COOKIE_SAMESITE === 'none' && !SESSION_COOKIE_SECURE) {
  console.error('FATAL: SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAMESITE=none in production');
  process.exit(1);
}

function parseTenantRedirectMap(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return {};

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out = {};
      for (const [tenant, url] of Object.entries(parsed)) {
        const tenantId = String(tenant).trim();
        const redirectUrl = String(url || '').trim();
        if (tenantId && redirectUrl) out[tenantId] = redirectUrl;
      }
      return out;
    } catch {
      return {};
    }
  }

  const out = {};
  for (const part of raw.split(',')) {
    const segment = String(part || '').trim();
    if (!segment) continue;
    const separator = segment.includes('=') ? '=' : (segment.includes(':') ? ':' : '');
    if (!separator) continue;
    const idx = segment.indexOf(separator);
    const tenantId = segment.slice(0, idx).trim();
    const redirectUrl = segment.slice(idx + 1).trim();
    if (tenantId && redirectUrl) out[tenantId] = redirectUrl;
  }

  return out;
}

const TENANT_APP_REDIRECT_MAP = parseTenantRedirectMap(process.env.TENANT_APP_REDIRECT_MAP);
const db = new Pool(readDatabaseConfig());
const SCHEMA_IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function resolveClientMeta(req) {
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwardedFor || req?.ip || req?.socket?.remoteAddress || null;
  const userAgent = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 400) : null;
  return { ip, userAgent };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function normalizeTenantId(input) {
  const tenant = String(input || '').trim();
  if (!tenant) return DEFAULT_TENANT_ID;
  return tenant;
}

function toPublicUser(userRow) {
  return {
    id: userRow.id,
    name: userRow.name || [userRow.vorname, userRow.nachname].filter(Boolean).join(' ').trim() || userRow.username || userRow.email,
    vorname: userRow.vorname || null,
    nachname: userRow.nachname || null,
    username: userRow.username || null,
    email: userRow.email || null,
    role: userRow.role || userRow.rolle || 'assistant',
  };
}

function resolveRedirectUrl(tenantId) {
  const mapped = TENANT_APP_REDIRECT_MAP[tenantId] || DEFAULT_APP_REDIRECT_URL;
  return String(mapped || DEFAULT_APP_REDIRECT_URL).replaceAll('{tenant}', tenantId);
}

function quoteSchemaIdent(schemaName, tenantIdForError = 'unknown') {
  const raw = String(schemaName || '').trim().toLowerCase();
  if (!SCHEMA_IDENT_RE.test(raw)) {
    throw new Error(`Invalid tenant schema name for ${tenantIdForError}`);
  }
  return `"${raw}"`;
}

function mapTenantRoleToLegacyRole(roleName) {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (normalized === 'arzt') return 'doctor';
  if (normalized === 'mpa') return 'assistant';
  if (normalized === 'billing') return 'billing';
  return normalized === 'admin' ? 'admin' : 'assistant';
}

async function queryTenantMeta(tenantId) {
  try {
    const { rows } = await db.query(
      `SELECT tenant_id, display_name, status, schema_name
         FROM tenant_registry
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );

    if (!rows.length) {
      if (REQUIRE_TENANT_REGISTRY) throw new Error(`Tenant ${tenantId} is not registered`);
      return { id: tenantId, displayName: tenantId, schemaName: `tenant_${tenantId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}` };
    }

    const row = rows[0];
    const status = String(row.status || 'active').toLowerCase();
    if (status !== 'active') {
      throw new Error(`Tenant ${tenantId} is not active`);
    }

    return {
      id: row.tenant_id,
      displayName: row.display_name || row.tenant_id,
      schemaName: row.schema_name || `tenant_${String(row.tenant_id || '').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    };
  } catch (err) {
    if (err && err.code === '42703') {
      const legacy = await db.query(
        `SELECT tenant_id, display_name, status
           FROM tenant_registry
          WHERE tenant_id = $1
          LIMIT 1`,
        [tenantId]
      );
      if (!legacy.rows.length) {
        if (REQUIRE_TENANT_REGISTRY) throw new Error(`Tenant ${tenantId} is not registered`);
        return { id: tenantId, displayName: tenantId, schemaName: `tenant_${tenantId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}` };
      }
      const row = legacy.rows[0];
      const status = String(row.status || 'active').toLowerCase();
      if (status !== 'active') {
        throw new Error(`Tenant ${tenantId} is not active`);
      }
      return {
        id: row.tenant_id,
        displayName: row.display_name || row.tenant_id,
        schemaName: `tenant_${String(row.tenant_id || '').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
      };
    }
    if (err && err.code === '42P01' && !REQUIRE_TENANT_REGISTRY) {
      return { id: tenantId, displayName: tenantId, schemaName: `tenant_${tenantId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}` };
    }
    throw err;
  }
}

async function resolveLegacyEmail(tenantId, identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await db.query(
    `SELECT email
       FROM users
      WHERE tenant_id = $1
        AND (lower(email) = $2 OR lower(username) = $2)
      LIMIT 1`,
    [tenantId, normalized]
  );
  return String(rows[0]?.email || '').trim().toLowerCase() || null;
}

async function findTenantAuthUserByEmail({ tenantId, schemaName, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const schema = quoteSchemaIdent(schemaName, tenantId);
  const { rows } = await db.query(
    `SELECT u.user_id,
            u.legacy_user_id,
            u.email,
            u.password_hash,
            u.display_name,
            u.is_active,
            u.deleted_at,
            r.name AS role_name
       FROM ${schema}.users u
       LEFT JOIN ${schema}.roles r ON r.role_id = u.role_id
      WHERE lower(u.email) = $1
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [normalizedEmail]
  );
  return rows[0] || null;
}

async function findTenantAuthUserByIdentifier(tenant, identifier) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  if (!normalizedIdentifier) return null;
  let user = await findTenantAuthUserByEmail({
    tenantId: tenant.id,
    schemaName: tenant.schemaName,
    email: normalizedIdentifier,
  });
  if (user) return user;
  const resolvedEmail = await resolveLegacyEmail(tenant.id, normalizedIdentifier);
  if (!resolvedEmail) return null;
  return findTenantAuthUserByEmail({
    tenantId: tenant.id,
    schemaName: tenant.schemaName,
    email: resolvedEmail,
  });
}

async function buildAppUserFromTenantAuth(tenantId, authUser) {
  if (!authUser) return null;
  const legacyUserId = Number(authUser.legacy_user_id);
  const legacyRole = mapTenantRoleToLegacyRole(authUser.role_name);
  const { rows } = await db.query(
    `SELECT id,
            tenant_id,
            name,
            vorname,
            nachname,
            username,
            role,
            rolle,
            email
       FROM users
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, legacyUserId]
  );
  if (rows.length > 0) {
    const user = rows[0];
    user.role = legacyRole;
    user.rolle = authUser.role_name || user.rolle || legacyRole;
    user.email = user.email || authUser.email || null;
    user.name = user.name || authUser.display_name || null;
    return user;
  }
  const email = String(authUser.email || '').trim().toLowerCase();
  const fallbackName = String(authUser.display_name || email.split('@')[0] || 'User').trim();
  return {
    id: legacyUserId,
    tenant_id: tenantId,
    name: fallbackName,
    vorname: null,
    nachname: null,
    username: email.split('@')[0] || null,
    role: legacyRole,
    rolle: authUser.role_name || legacyRole,
    email: email || null,
  };
}

async function createSessionToken({ tenantId, user, req }) {
  const sessionId = crypto.randomUUID();
  const ttlHours = JWT_EXPIRES_HOURS_EFFECTIVE;

  const payload = {
    id: user.id,
    tenant: tenantId,
    role: user.role || user.rolle || 'assistant',
    sid: sessionId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${ttlHours}h` });
  const tokenHash = hashToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlHours * 60 * 60 * 1000);
  const clientMeta = resolveClientMeta(req);

  await db.query(
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
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      sessionId,
      tenantId,
      Number(user.id),
      tokenHash,
      issuedAt,
      expiresAt,
      clientMeta.userAgent,
      clientMeta.ip,
      { role: user.role || user.rolle || null },
    ]
  );

  return { token, expiresAt, ttlHours, sessionId };
}

function writeSessionCookie(res, req, token, ttlHours) {
  const isHttps = SESSION_COOKIE_SECURE || req.secure || req.headers['x-forwarded-proto'] === 'https';
  const options = {
    httpOnly: true,
    secure: Boolean(isHttps),
    sameSite: SESSION_COOKIE_SAMESITE,
    signed: true,
    maxAge: ttlHours * 60 * 60 * 1000,
  };
  if (SESSION_COOKIE_DOMAIN) {
    options.domain = SESSION_COOKIE_DOMAIN;
  }
  res.cookie(SESSION_COOKIE_NAME, token, options);
}

async function authenticate({ tenantId, identifier, password, req }) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  if (!normalizedIdentifier || !password) {
    return { ok: false, status: 400, message: 'E-Mail/Benutzername und Passwort erforderlich' };
  }

  const tenant = await queryTenantMeta(tenantId);
  const authUser = await findTenantAuthUserByIdentifier(tenant, normalizedIdentifier);
  if (!authUser || !authUser.is_active) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return { ok: false, status: 401, message: 'Ungültige Zugangsdaten' };
  }
  if (!authUser.legacy_user_id) {
    return { ok: false, status: 500, message: 'Benutzer-Mapping ist unvollständig' };
  }
  const validPassword = await bcrypt.compare(password, authUser.password_hash || '');
  if (!validPassword) {
    return { ok: false, status: 401, message: 'Ungültige Zugangsdaten' };
  }
  const user = await buildAppUserFromTenantAuth(tenant.id, authUser);

  const session = await createSessionToken({ tenantId: tenant.id, user, req });

  return {
    ok: true,
    tenant,
    user,
    session,
    redirectUrl: resolveRedirectUrl(tenant.id),
  };
}

const app = express();
app.set('trust proxy', TRUST_PROXY_HOPS);
app.use(cookieParser(JWT_SECRET));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

if (CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'login-gateway' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (_req, res) => {
  res.redirect(302, '/login');
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/tenants', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT tenant_id, display_name
         FROM tenant_registry
        WHERE status = 'active'
        ORDER BY tenant_id ASC`
    );
    res.json({
      items: rows.map((row) => ({
        id: row.tenant_id,
        displayName: row.display_name || row.tenant_id,
      })),
    });
  } catch (err) {
    if (err && err.code === '42P01') {
      return res.json({ items: [{ id: DEFAULT_TENANT_ID, displayName: DEFAULT_TENANT_ID }] });
    }
    return res.status(500).json({ message: 'Tenants konnten nicht gelesen werden' });
  }
});

app.get('/api/public/tenants/:tenantId', async (req, res) => {
  try {
    const tenant = await queryTenantMeta(normalizeTenantId(req.params.tenantId));
    return res.json({
      id: tenant.id,
      displayName: tenant.displayName,
      meta: {},
    });
  } catch (_err) {
    return res.status(404).json({ message: 'Mandant nicht gefunden oder deaktiviert.' });
  }
});

function serializeLoginResult(result) {
  return {
    tenant: result.tenant.id,
    tenantName: result.tenant.displayName,
    user: toPublicUser(result.user),
    redirectUrl: result.redirectUrl,
    sessionExpiresAt: result.session.expiresAt.toISOString(),
    sessionTtlHours: result.session.ttlHours,
  };
}

async function handleJsonLogin(req, res) {
  try {
    const tenantId = normalizeTenantId(req.body?.tenant || req.headers['x-tenant-id'] || req.query?.tenant);
    const result = await authenticate({
      tenantId,
      identifier: req.body?.email || req.body?.username || req.body?.identifier,
      password: req.body?.password,
      req,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    writeSessionCookie(res, req, result.session.token, result.session.ttlHours);
    return res.json(serializeLoginResult(result));
  } catch (err) {
    return res.status(500).json({ message: 'Serverfehler', error: err.message });
  }
}

app.post('/auth/login', handleJsonLogin);
app.post('/api/login', handleJsonLogin);

app.post('/login', async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.body?.tenant || req.headers['x-tenant-id'] || req.query?.tenant);
    const result = await authenticate({
      tenantId,
      identifier: req.body?.email || req.body?.username || req.body?.identifier,
      password: req.body?.password,
      req,
    });

    if (!result.ok) {
      return res.status(result.status).send(result.message);
    }

    writeSessionCookie(res, req, result.session.token, result.session.ttlHours);
    return res.redirect(302, result.redirectUrl);
  } catch (err) {
    return res.status(500).send(`Serverfehler: ${err.message}`);
  }
});

app.post('/auth/logout', async (req, res) => {
  try {
    const rawToken = req.signedCookies?.[SESSION_COOKIE_NAME] || null;
    if (rawToken) {
      try {
        const payload = jwt.verify(rawToken, JWT_SECRET);
        if (payload?.sid && payload?.tenant) {
          await db.query(
            `UPDATE user_sessions
                SET revoked_at = COALESCE(revoked_at, now())
              WHERE session_id = $1
                AND tenant_id = $2`,
            [String(payload.sid), String(payload.tenant)]
          );
        }
      } catch (_err) {
        // ignore invalid token on logout cleanup
      }
    }

    const isHttps = SESSION_COOKIE_SECURE || req.secure || req.headers['x-forwarded-proto'] === 'https';
    const clearOptions = {
      httpOnly: true,
      secure: Boolean(isHttps),
      sameSite: SESSION_COOKIE_SAMESITE,
      signed: true,
    };
    if (SESSION_COOKIE_DOMAIN) {
      clearOptions.domain = SESSION_COOKIE_DOMAIN;
    }
    res.clearCookie(SESSION_COOKIE_NAME, clearOptions);

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ message: 'Logout fehlgeschlagen', error: err.message });
  }
});

app.listen(LOGIN_PORT, HOST, () => {
  console.log(`login-gateway listening on http://${HOST}:${LOGIN_PORT}`);
});
