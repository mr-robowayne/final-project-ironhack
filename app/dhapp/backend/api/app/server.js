// server.js – HTTPS hinter Nginx, JWT, sichere Uploads, Patientenordner pro ID
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { exec, execFile } = require('child_process');
const tenantManager = require('./lib/tenant');
const s3docs = require('./lib/storage/s3-documents');
const { auditLog } = require('./lib/logging');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const {
  resolveJwtExpiresHours,
  createSessionToken,
  validateSessionToken,
  revokeSessionById,
} = require('./lib/auth/sessionTokens');
const {
  normalizeRoleName,
  resolvePermissionSetForRole,
  hasPermission,
  toSortedPermissionArray,
} = require('./lib/rbac');
const FormData = require('form-data');
const { launchBrowser } = require('./lib/pdf/browser');
const { describeTenantStorage } = require('./lib/storage');
const { saveInvoiceRecord, listInvoices, getInvoiceRecord } = require('./lib/invoices/service');
const { renderInvoicePdf } = require('./lib/invoices/pdf');
const { buildGeneralInvoice50RequestXML } = require('./lib/invoices/generalInvoice50');
const { getTenantBillingConfig } = require('./lib/invoices/tenantConfig');
const { loadTenantSettingsJson, saveTenantSettingsJson } = require('./lib/tenantSettings');
const { initTariffCatalog } = require('./lib/tariffs');
const { buildTarmedHelp } = require('./lib/tariffs/help');
const fsp = fs.promises;
// ganz oben bei den anderen require-Zeilen
const { createProxyMiddleware } = require("http-proxy-middleware");
// NOTE: do not cache fetch before the policy wrapper; use global.fetch directly.

// Enforce offline policy for any backend-initiated HTTP calls (DSGVO/ISO)
// Only allow requests to LocalAI (llm-local) or relative URLs (same-origin) when ALLOW_EXTERNAL_CALLS=false
try {
  const ALLOW_EXT = String(process.env.ALLOW_EXTERNAL_CALLS || 'false').toLowerCase() === 'true';
  if (!ALLOW_EXT && typeof global.fetch === 'function') {
    const realFetch = global.fetch.bind(global);
    global.fetch = (url, opts) => {
      try {
        const s = typeof url === 'string' ? url : (url?.toString?.() || '');
        // Permit relative (same-origin) URLs
        if (s && !/^https?:/i.test(s)) return realFetch(url, opts);
        const u = new URL(s);
        const host = (u.hostname || '').toLowerCase();
        if (
          host === 'llm-local' ||
          host === 'llm-gateway' ||
          host === 'ai-service' ||
          host === 'egress-proxy' ||
          host === 'localhost' ||
          host === '127.0.0.1'
        ) {
          return realFetch(url, opts);
        }
      } catch (_) {
        // On URL parse error, block to be safe
      }
      throw new Error('External HTTP blocked by policy');
    };
  }
} catch (_) { /* ignore */ }

const app = express();

// Audit log cleanup — only runs for tenants already bootstrapped via a request.
// No startup bootstrap: tenant setup happens lazily on first authenticated request.
setInterval(async () => {
  try {
    const retentionDays = Number(process.env.AUDIT_RETENTION_DAYS || 90);
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    for (const tenantId of tenantManager.getBootstrappedTenantIds()) {
      let ctx;
      try {
        ctx = await tenantManager.getTenantContext(tenantId);
      } catch {
        continue;
      }
      try {
        await ctx.db.query(`DELETE FROM calendar_audit_logs WHERE tenant_id = $1 AND created_at < $2`, [ctx.id, cutoff]);
      } catch {}
      try {
        await ctx.db.query(`DELETE FROM tenant_logs WHERE tenant_id = $1 AND created_at < $2`, [ctx.id, cutoff]);
      } catch {}
      try {
        await ctx.db.query(`DELETE FROM tenant_logs WHERE tenant_id = $1 AND ts < $2`, [ctx.id, cutoff]);
      } catch {}
    }
  } catch {}
}, 12 * 60 * 60 * 1000).unref();

const tenantMetaOf = (tenantCtx) => (tenantCtx?.meta || tenantCtx?.config?.meta || {});
const clinicMetaOf = (tenantCtx) => tenantMetaOf(tenantCtx).clinic || {};
const brandingMetaOf = (tenantCtx) => tenantMetaOf(tenantCtx).branding || {};
const invoiceMetaOf = (tenantCtx) => tenantMetaOf(tenantCtx).invoice || {};
const recipeMetaOf = (tenantCtx) => tenantMetaOf(tenantCtx).recipe || {};
const publicTenantMeta = (tenantCtx) => {
  const clinic = { ...clinicMetaOf(tenantCtx) };
  const branding = { ...brandingMetaOf(tenantCtx) };
  const invoice = { ...invoiceMetaOf(tenantCtx) };
  const recipe = { ...recipeMetaOf(tenantCtx) };
  return { clinic, branding, invoice, recipe };
};

// ── Config / ENV
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const host = (process.env.BIND_PUBLIC === 'true') ? '0.0.0.0' : '127.0.0.1';
const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 5000);
const EXPOSE_INTERNAL_ERRORS = String(process.env.EXPOSE_INTERNAL_ERRORS || (isProd ? 'false' : 'true')).toLowerCase() === 'true';
// Enforce Auth für produktionsähnliche Nutzung
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || 'true').toLowerCase() === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME';
const JWT_EXPIRES_HOURS = resolveJwtExpiresHours();
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || 'session').trim() || 'session';
const SESSION_COOKIE_DOMAIN = String(process.env.SESSION_COOKIE_DOMAIN || '').trim() || undefined;
const SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || (isProd ? 'true' : 'false')).toLowerCase() === 'true';
const SESSION_COOKIE_SAMESITE_RAW = String(process.env.SESSION_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
const SESSION_COOKIE_SAMESITE = ['lax', 'strict', 'none'].includes(SESSION_COOKIE_SAMESITE_RAW) ? SESSION_COOKIE_SAMESITE_RAW : 'lax';
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || '';
const CORS_ALLOWLIST = (process.env.CORS_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || process.env.AI_GATEWAY_URL || 'http://llm-gateway:8088').replace(/\/+$/g, '');
const BILLING_SERVICE_URL = String(process.env.BILLING_SERVICE_URL || '').replace(/\/+$/g, '');
const BILLING_SERVICE_TOKEN = String(process.env.BILLING_SERVICE_TOKEN || '');
const DEFAULT_INVOICE_XSD = path.join(__dirname, 'Tardoc', 'generalInvoiceRequest_500.xsd');
const INVOICE_XSD_PATH = (process.env.INVOICE_XSD_PATH && process.env.INVOICE_XSD_PATH.trim())
  ? process.env.INVOICE_XSD_PATH.trim()
  : (fs.existsSync(DEFAULT_INVOICE_XSD) ? DEFAULT_INVOICE_XSD : '');
const XMLLINT_AVAILABLE = (() => {
  try { execFile('xmllint', ['--version']); return true; } catch { return false; }
})();
const ENABLE_XSD_VALIDATION = XMLLINT_AVAILABLE && Boolean(INVOICE_XSD_PATH);

// SECURITY: Enforce JWT secret in production
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME')) {
  console.error('FATAL: JWT_SECRET must be set in production.');
  process.exit(1);
}

// SECURITY: Do not allow auth-free mode in production
if (isProd && !REQUIRE_AUTH) {
  console.error('FATAL: REQUIRE_AUTH must be true in production.');
  process.exit(1);
}

if (isProd && EXPOSE_INTERNAL_ERRORS) {
  console.error('FATAL: EXPOSE_INTERNAL_ERRORS must be false in production.');
  process.exit(1);
}

if (SESSION_COOKIE_SAMESITE_RAW !== SESSION_COOKIE_SAMESITE) {
  console.warn(`WARN: Ungültiger SESSION_COOKIE_SAMESITE-Wert "${SESSION_COOKIE_SAMESITE_RAW}", fallback auf "lax".`);
}

if (isProd && SESSION_COOKIE_SAMESITE === 'none' && !SESSION_COOKIE_SECURE) {
  console.error('FATAL: SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAMESITE=none in production.');
  process.exit(1);
}

// App-Pfade & Mandanten
const APP_DIR = __dirname;
const FRONTEND_BUILD_DIR = path.join(APP_DIR, 'frontend', 'build');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_BUILD_DIR, 'index.html'));
const TENANT_HEADER = 'x-tenant-id';

// ── Security
app.disable('x-powered-by');
app.set('trust proxy', 1);
const ENABLE_APP_CSP = String(process.env.ENABLE_APP_CSP || (isProd ? 'true' : 'false')).toLowerCase() === 'true';
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: ENABLE_APP_CSP ? {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'self'", "blob:"],
    }
  } : false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(hpp());
app.use(compression());
app.use(cookieParser(JWT_SECRET));
app.use((_, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// CORS (nur wenn nötig – Same-Origin empfohlen)
const corsOrigins = (origin, cb) => {
  if (!origin) return cb(null, true);
  if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return cb(null, true);
  if (CORS_ALLOWLIST.includes(origin)) return cb(null, true);
  if (!isProd) return cb(null, true);
  return cb(new Error('CORS blocked'), false);
};
app.use(cors({
  origin: corsOrigins,
  credentials: true, // allow cookies for SPA on different port
  maxAge: 86400,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant-ID', 'X-User-ID']
}));

// FIX: Add Vary: Origin for CORS caching correctness
app.use((req, res, next) => { res.vary('Origin'); next(); });
// Never cache API responses with sensitive data
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Allgemeines API-Rate-Limit (ergänzt zum spezifischen Login-Limit)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

// HTTPS erzwingen (hinter Nginx) – abschaltbar über FORCE_HTTPS=false
const FORCE_HTTPS = String(process.env.FORCE_HTTPS || 'true').toLowerCase() === 'true';
if (isProd && FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    return res.redirect(308, 'https://' + req.headers.host + req.originalUrl);
  });
  app.use((_, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
    next();
  });
}

// Body limits
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));

// Statische Assets (ungefährlich)
app.use('/assets',  express.static(path.join(APP_DIR, 'assets'), { fallthrough: false, index: false, immutable: true, maxAge: '1d' }));
// Serve offline leaflets if present
const LEAFLETS_DIR = process.env.MED_LEAFLETS_DIR || path.join(APP_DIR, 'data', 'leaflets');
if (fs.existsSync(LEAFLETS_DIR)) {
  app.use('/leaflets', express.static(LEAFLETS_DIR, { fallthrough: true, index: false, immutable: false, maxAge: '1h' }));
}

if (hasFrontendBuild) {
  const frontendStaticOpts = {
    index: 'index.html',
    immutable: isProd,
    maxAge: isProd ? '1h' : 0,
  };
  app.use(express.static(FRONTEND_BUILD_DIR, frontendStaticOpts));
} else {
  console.warn('Frontend-Build nicht gefunden - fuehre "npm run build" im Ordner frontend/ aus, um die UI auszuliefern.');
}

// ── Utils
const safeJoin = (base, target) => {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(path.normalize(base + path.sep))) throw new Error('Path traversal');
  return p;
};
const resolveTenantIdFromRequest = (req) => {
  if (!req || typeof req !== 'object') return null;
  const header = (req.headers?.[TENANT_HEADER] || '').toString().trim();
  if (header) return header;
  if (req.query?.tenant) return String(req.query.tenant).trim();
  if (req.body && typeof req.body === 'object' && req.body.tenant) {
    return String(req.body.tenant).trim();
  }
  return null;
};
// FIX: Define nowIso utility used later
const nowIso = () => new Date().toISOString();
const attachTenantContext = async (req, tenantId) => {
  const resolved = tenantManager.resolveTenantId(tenantId || resolveTenantIdFromRequest(req));
  const ctx = await tenantManager.getTenantContext(resolved);
  req.tenant = ctx;
  return ctx;
};
const ensureRequestTenant = async (req, tenantId) => {
  if (req.tenant) return req.tenant;
  return attachTenantContext(req, tenantId || resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId());
};
const tenantStatic = (pathResolver, staticOptions = {}) => async (req, res, next) => {
  try {
    if (!req.tenant) {
      await attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId());
    }
    const root = await pathResolver(req);
    return express.static(root, { index: false, fallthrough: false, ...staticOptions })(req, res, next);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return res.status(404).json({ message: 'Datei nicht gefunden' });
    }
    next(err);
  }
};
const writeAuditFallback = (tenantId, event, details) => {
  const fallbackSalt = process.env.AUDIT_SALT || process.env.JWT_SECRET || 'audit-salt';
  const sensitiveKey = (k) => {
    const key = String(k || '').toLowerCase();
    return (
      key.includes('password') ||
      key.includes('token') ||
      key.includes('authorization') ||
      key.includes('cookie') ||
      key.includes('secret') ||
      key.includes('email') ||
      key.includes('phone')
    );
  };
  const hmacValue = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    return crypto.createHmac('sha256', String(fallbackSalt)).update(String(v)).digest('hex');
  };
  const sanitizeFallbackValue = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (depth > 2) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeFallbackValue(v, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      const entries = Object.entries(value).slice(0, 40);
      for (const [k, v] of entries) {
        if (sensitiveKey(k)) continue;
        const key = String(k || '').toLowerCase();
        if (key === 'ip' || key === 'ip_address' || key === 'ipaddress') {
          const ipHash = hmacValue(v);
          if (ipHash) out.ip_hash = ipHash;
          continue;
        }
        if (key === 'username' || key === 'user_name' || key === 'userid' || key === 'user') {
          const userHash = hmacValue(v);
          if (userHash) out.username_hash = userHash;
          continue;
        }
        out[k] = sanitizeFallbackValue(v, depth + 1);
      }
      return out;
    }
    if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) : value;
    if (typeof value === 'bigint') return value.toString();
    return value;
  };

  let targetPath = null;
  if (tenantId) {
    try {
      const tenantPaths = tenantManager.ensureTenantPaths(tenantId);
      targetPath = tenantPaths.auditLogPath;
    } catch (err) {
      console.error('Audit fallback path error:', err.message || err);
    }
  }
  if (!targetPath) {
    const fallbackDir = path.join(APP_DIR, 'logs');
    fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o750 });
    targetPath = path.join(fallbackDir, 'audit-unknown.log');
  }
  const sanitizedDetails = sanitizeFallbackValue(details || {}, 0) || {};
  const entry = { ts: new Date().toISOString(), tenant: tenantId || 'unknown', event, ...sanitizedDetails };
  fs.appendFile(targetPath, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('Audit fallback write failed:', err.message || err);
  });
};

const safeClientError = (fallback, err) => {
  if (EXPOSE_INTERNAL_ERRORS && err) return String(err?.message || err);
  return fallback;
};
const audit = (context, event, details = {}) => {
  if (!event) return Promise.resolve();
  return auditLog(context, event, details).catch((err) => {
    console.error('Audit log failed:', err.message || err);
    let tenantId = null;
    if (typeof context === 'string') {
      tenantId = context;
    } else if (context?.tenant?.id) {
      tenantId = context.tenant.id;
    } else if (context?.id) {
      tenantId = context.id;
    } else if (details?.tenantId) {
      tenantId = details.tenantId;
    }
    writeAuditFallback(tenantId, event, details);
  });
};
const clientMeta = (req) => ({
  ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip,
  ua: req.headers['user-agent'] || ''
});
const invoiceToDto = (row) => {
  if (!row) return null;
  const pdfUrl = row.storage_path ? `/api/invoices/${encodeURIComponent(row.id)}/pdf` : null;
  const pdfViewUrl = row.storage_path ? `/api/invoices/${encodeURIComponent(row.id)}/pdf/view` : null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    patient_id: row.patient_id,
    status: row.status,
    total_amount: row.total ?? row.total_amount,
    currency: row.currency,
    filesize: row.filesize,
    pdf_checksum: row.pdf_checksum,
    created_by: row.created_by,
    created_by_user_id: row.created_by_user_id,
    doctor_id: row.doctor_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pdf_generated_at: row.pdf_generated_at,
    has_pdf: Boolean(row.storage_path),
    pdf_url: pdfUrl,
    pdf_view_url: pdfViewUrl,
    payload: row.payload
  };
};
const parseAddress = (row, column = 'address', fallbackKeys = null) => {
  const value = row?.[column];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { /* fall through */ }
  }
  const fallbacks = fallbackKeys || {
    street: 'adresse',
    houseNo: 'hausnummer',
    zip: 'plz',
    city: 'ort',
    countrySource: null
  };
  const streetKey = fallbacks.street || 'adresse';
  const houseKey = fallbacks.houseNo || 'hausnummer';
  const zipKey = fallbacks.zip || 'plz';
  const cityKey = fallbacks.city || 'ort';
  const countryValue =
    (fallbacks.countrySource && row?.[fallbacks.countrySource]) ||
    row?.address?.country ||
    'CH';
  return {
    street: streetKey ? (row?.[streetKey] || null) : null,
    houseNo: houseKey ? (row?.[houseKey] || null) : null,
    zip: zipKey ? (row?.[zipKey] || null) : null,
    city: cityKey ? (row?.[cityKey] || null) : null,
    country: countryValue || 'CH'
  };
};
const deriveName = (row) => {
  if (row?.name) return row.name;
  const parts = [row?.vorname, row?.nachname].filter(Boolean);
  return parts.join(' ').trim() || null;
};
const cleanString = (val) => {
  if (val == null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length ? trimmed : null;
  }
  return String(val || '').trim() || null;
};
const boolFromInput = (val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    return ['1','true','ja','yes','on'].includes(normalized);
  }
  return false;
};
const guardianFallbackKeys = {
  street: 'guardian_adresse',
  houseNo: 'guardian_hausnummer',
  zip: 'guardian_plz',
  city: 'guardian_ort',
  countrySource: 'guardian_country'
};
const parseGuardianFromRow = (row) => {
  const addr = parseAddress(row, 'guardian_address', guardianFallbackKeys);
  const hasAddr = Boolean(addr.street || addr.houseNo || addr.zip || addr.city);
  return {
    first_name: row.guardian_first_name || null,
    last_name: row.guardian_last_name || null,
    relationship: row.guardian_relationship || null,
    phone: row.guardian_phone || null,
    email: row.guardian_email || null,
    same_address: Boolean(row.guardian_same_address),
    address: hasAddr ? addr : null
  };
};
const guardianFieldKeys = new Set([
  'guardian',
  'guardian_first_name','guardianFirstName','guardianVorname',
  'guardian_last_name','guardianLastName','guardianNachname',
  'guardian_relationship','guardianRelationship','guardian_beziehung',
  'guardian_phone','guardianPhone','guardian_telefon',
  'guardian_email','guardianEmail',
  'guardian_same_address','guardianSameAddress','guardian_adresse_wie_patient',
  'guardian_address','guardianAddress','guardian_adresse',
  'guardian_street','guardianStreet','guardian_strasse',
  'guardian_houseNo','guardianHouseNo','guardian_hausnummer',
  'guardian_zip','guardianZip','guardian_plz',
  'guardian_city','guardianCity','guardian_ort'
]);
const hasGuardianPatch = (body = {}) => {
  if (!body || typeof body !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(body, 'guardian')) return true;
  return Array.from(guardianFieldKeys).some((key) => Object.prototype.hasOwnProperty.call(body, key));
};
const isMinorPatient = (birthdate) => {
  if (!birthdate) return false;
  const age = calcAgeAt(birthdate, new Date());
  return Number.isFinite(age) && age < 18;
};
const normalizeGuardianInput = (body = {}, patientAddress = {}) => {
  const raw = (body.guardian && typeof body.guardian === 'object') ? body.guardian : {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (key in raw && raw[key] != null) return raw[key];
      if (key in body && body[key] != null) return body[key];
      const prefixed = `guardian_${key}`;
      if (prefixed in body && body[prefixed] != null) return body[prefixed];
    }
    return null;
  };
  const firstName = cleanString(pick('first_name','firstName','vorname'));
  const lastName = cleanString(pick('last_name','lastName','nachname'));
  const relationship = cleanString(pick('relationship','beziehung'));
  const phone = cleanString(pick('phone','telefon','telefonnummer'));
  const email = cleanString(pick('email'));
  const sameAddress = boolFromInput(
    raw.same_address ?? raw.sameAddress ?? body.guardian_same_address ?? body.guardianAdresseWiePatient ?? body.guardian_address_same_as_patient
  );
  const directAddress = (body.guardian_address && typeof body.guardian_address === 'object')
    ? body.guardian_address
    : ((body.guardianAddress && typeof body.guardianAddress === 'object') ? body.guardianAddress : {});
  const addrSource = (raw.address && typeof raw.address === 'object') ? raw.address : directAddress;
  const street = cleanString(
    addrSource.street ?? addrSource.strasse ?? raw.street ?? raw.strasse ?? body.guardian_adresse ?? body.guardian_street ?? body.guardian_strasse
  );
  const houseNo = cleanString(
    addrSource.houseNo ?? addrSource.hausnummer ?? raw.houseNo ?? raw.hausnummer ?? body.guardian_hausnummer ?? body.guardian_houseNo
  );
  const zip = cleanString(
    addrSource.zip ?? addrSource.plz ?? raw.zip ?? raw.plz ?? body.guardian_plz ?? body.guardian_zip
  );
  const city = cleanString(
    addrSource.city ?? addrSource.ort ?? raw.city ?? raw.ort ?? body.guardian_ort ?? body.guardian_city
  );
  const country = cleanString(
    addrSource.country ?? raw.country ?? body.guardian_country
  ) || 'CH';
  const provided = Boolean(
    firstName || lastName || relationship || phone || email ||
    sameAddress || street || houseNo || zip || city
  );
  let address = null;
  if (sameAddress) {
    const patientAddr = {
      street: patientAddress.street || null,
      houseNo: patientAddress.houseNo || null,
      zip: patientAddress.zip || null,
      city: patientAddress.city || null,
      country: patientAddress.country || 'CH'
    };
    const hasPatientAddr = Boolean(patientAddr.street || patientAddr.zip || patientAddr.city);
    address = hasPatientAddr ? patientAddr : null;
  } else if (street || houseNo || zip || city) {
    address = {
      street: street || null,
      houseNo: houseNo || null,
      zip: zip || null,
      city: city || null,
      country
    };
  }
  return {
    provided,
    firstName,
    lastName,
    relationship,
    phone,
    email,
    sameAddress: Boolean(sameAddress),
    address
  };
};
const normalizeGuardianFromClaim = (source = {}) => {
  if (!source || typeof source !== 'object') return null;
  const addrSource = (source.address && typeof source.address === 'object') ? source.address : {};
  const firstName = cleanString(source.first_name || source.firstName || source.vorname);
  const lastName = cleanString(source.last_name || source.lastName || source.nachname);
  const relationship = cleanString(source.relationship || source.beziehung);
  const phone = cleanString(source.phone || source.telefon || source.telefonnummer);
  const email = cleanString(source.email);
  const street = cleanString(addrSource.street || addrSource.strasse || source.street || source.strasse);
  const houseNo = cleanString(addrSource.houseNo || addrSource.hausnummer || source.houseNo || source.hausnummer);
  const zip = cleanString(addrSource.zip || addrSource.plz || source.zip || source.plz);
  const city = cleanString(addrSource.city || addrSource.ort || source.city || source.ort);
  const country = cleanString(addrSource.country || source.country) || 'CH';
  const provided = Boolean(firstName || lastName || relationship || phone || street || zip || city);
  if (!provided) return null;
  const address = (street || houseNo || zip || city) ? { street, houseNo, zip, city, country } : null;
  return {
    provided: true,
    firstName,
    lastName,
    relationship,
    phone,
    email,
    address
  };
};
const guardianValidationErrors = (guardianInfo) => {
  if (!guardianInfo) return ['Vor- und Nachname der verantwortlichen Person fehlen.'];
  const missing = [];
  if (!guardianInfo.firstName) missing.push('Vorname');
  if (!guardianInfo.lastName) missing.push('Nachname');
  if (!guardianInfo.relationship) missing.push('Beziehung');
  if (!guardianInfo.phone) missing.push('Telefonnummer');
  const addr = guardianInfo.address || {};
  if (!addr.street) missing.push('Adresse (Strasse)');
  if (!addr.zip) missing.push('PLZ');
  if (!addr.city) missing.push('Ort');
  return missing;
};
const toPatientDto = (row) => {
  if (!row) return null;
  const address = parseAddress(row);
  const guardian = parseGuardianFromRow(row);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: deriveName(row),
    birthdate: row.birthdate || row.geburtsdatum,
    gender: row.gender || row.geschlecht,
    treated_sex: row.treated_sex || null,
    insurance: row.insurance || row.krankenkasse,
    insurance_number: row.insurance_number || row.versichertennummer,
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name || null,
    doctor_email: row.doctor_email || null,
    phone: row.phone || row.telefonnummer,
    email: row.email,
    address,
    notes: row.notes || row.krankengeschichte || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    vorname: row.vorname,
    nachname: row.nachname,
    krankengeschichte: row.krankengeschichte,
    medikationsplan: row.medikationsplan || null,
    allergien: row.allergien || null,
    impfstatus: row.impfstatus || null,
    telefonnummer: row.telefonnummer,
    vorgesetzter: row.vorgesetzter || null,

    // Legacy/UI-expected aliases for compatibility
    geburtsdatum: row.geburtsdatum || row.birthdate || null,
    geschlecht: row.geschlecht || row.gender || null,
    adresse: row.adresse || address.street || null,
    hausnummer: row.hausnummer || address.houseNo || null,
    plz: row.plz || address.zip || null,
    ort: row.ort || address.city || null,
    ahv_nummer: row.ahv_nummer || null,
    krankenkasse: row.krankenkasse || row.insurance || null,
    krankenkasse_adresse: row.krankenkasse_adresse || null,
    versichertennummer: row.versichertennummer || row.insurance_number || null,

    // New: linked insurance details when joined
    insurance_id: row.insurance_id || null,
    insurance_name: row.insurance_name || row.krankenkasse || row.insurance || null,
    ean: row.insurance_ean || null,
    kvnr: row.insurance_kvnr || null,
    versicherung_ean: row.insurance_ean || null,
    insurance_address: row.insurance_address || row.krankenkasse_adresse || null,
    insurance_zip: row.insurance_zip || null,
    insurance_city: row.insurance_city || null,
    canton: row.insurance_canton || null,
    bfs_code: row.insurance_bfs_code || null,
    guardian,
    guardian_first_name: guardian.first_name || null,
    guardian_last_name: guardian.last_name || null,
    guardian_relationship: guardian.relationship || null,
    guardian_phone: guardian.phone || null,
    guardian_email: guardian.email || null,
    guardian_same_address: Boolean(row.guardian_same_address),
    guardian_adresse: guardian.address?.street || null,
    guardian_hausnummer: guardian.address?.houseNo || null,
    guardian_plz: guardian.address?.zip || null,
    guardian_ort: guardian.address?.city || null
  };
};
const normalizeGender = (value) => {
  const gender = String(value || '').trim().toLowerCase();
  if (!gender) return null;
  if (['w', 'f', 'female', 'weiblich'].includes(gender)) return { iso: 'female', legacy: 'w' };
  if (['m', 'male', 'männlich'].includes(gender)) return { iso: 'male', legacy: 'm' };
  if (['d', 'divers', 'diverse', 'other'].includes(gender)) return { iso: 'diverse', legacy: 'd' };
  return { iso: gender, legacy: gender[0] || null };
};

const normalizeSex = (value) => {
  const sex = String(value || '').trim().toLowerCase();
  if (!sex) return null;
  if (['w', 'f', 'female', 'weiblich'].includes(sex)) return 'female';
  if (['m', 'male', 'männlich'].includes(sex)) return 'male';
  return null;
};
const ensurePatientFolder = (tenantCtx, patientId) => {
  if (!tenantCtx?.paths?.patientFilesDir) return;
  try {
    const dir = safeJoin(tenantCtx.paths.patientFilesDir, String(patientId));
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  } catch (err) {
    console.warn('Patient directory creation failed:', err.message || err);
  }
};

/**
 * Sets document_prefix on the patient record and creates the local folder.
 * Gracefully skips if the column does not exist (old schema).
 */
const provisionPatientStorage = async (tenantCtx, patientId) => {
  ensurePatientFolder(tenantCtx, patientId);

  if (!s3docs.isS3Configured()) return;

  const prefix = s3docs.buildPatientPrefix(tenantCtx.id, String(patientId));
  try {
    await tenantCtx.db.query(
      `UPDATE patients SET document_prefix = $1 WHERE id = $2 AND tenant_id = $3`,
      [prefix, patientId, tenantCtx.id]
    );
  } catch (err) {
    // Column may not exist in legacy schema — not fatal
    if (!String(err.message).includes('column')) {
      console.warn('provisionPatientStorage: could not set document_prefix:', err.message);
    }
  }
};
const toAppointmentDto = (row) => {
  if (!row) return null;
  const startsAt = row.starts_at || (row.termin_datum && row.startzeit ? `${row.termin_datum}T${row.startzeit}` : null);
  const startsDate = startsAt ? new Date(startsAt) : null;
  const duration = Number(row.duration_minutes || row.dauer || 30);
  const endsDate = startsDate ? new Date(startsDate.getTime() + duration * 60000) : null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    calendar_id: row.calendar_id,
    patient_id: row.patient_id,
    doctor_id: row.doctor_id,
    starts_at: startsDate ? startsDate.toISOString() : null,
    ends_at: endsDate ? endsDate.toISOString() : null,
    duration_minutes: duration,
    reason: row.reason || row.beschreibung || row.termin_name,
    status: row.status || 'scheduled',
    patient_name: row.patient_name || deriveName(row),
    doctor_name: row.doctor_name || null,
    doctor_email: row.doctor_email || null,
    metadata: {
      legacy: {
        termin_name: row.termin_name,
        beschreibung: row.beschreibung,
        startzeit: row.startzeit,
        endzeit: row.endzeit,
        termin_datum: row.termin_datum
      }
    }
  };
};
const toPublicUser = (userRow) => {
  if (!userRow) return null;
  const {
    password_hash,
    beschreibung,
    rolle,
    metadata,
    ...rest
  } = userRow;
  const normalizedRole = normalizeAuthRole(userRow.role || rolle || 'assistant');
  const displayName =
    (userRow.name || `${userRow.vorname || ''} ${userRow.nachname || ''}`.trim() || userRow.username || '').trim()
    || (String(userRow.email || '').split('@')[0] || 'User');
  const nameTokens = displayName.split(/[\s._-]+/g).filter(Boolean);
  const initials = (
    nameTokens.length >= 2
      ? `${nameTokens[0][0] || ''}${nameTokens[nameTokens.length - 1][0] || ''}`
      : (nameTokens[0] || '').slice(0, 2)
  ).toUpperCase() || 'U';
  return {
    ...rest,
    role: normalizedRole,
    beschreibung: beschreibung || '',
    metadata: metadata || {},
    displayName,
    initials,
    permissions: Array.isArray(userRow.permissions) ? userRow.permissions : [],
  };
};
const xmlEscape = (s='') => String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
const loadFaelle = (tenantCtx) => {
  try {
    return JSON.parse(fs.readFileSync(tenantCtx.paths.faelleJsonPath, 'utf8'));
  } catch {
    return [];
  }
};
const saveFaelle = (tenantCtx, arr) => {
  fs.writeFileSync(tenantCtx.paths.faelleJsonPath, JSON.stringify(arr, null, 2));
};
const findFall = (arr, id) => arr.find(x => x.id === id || x.rechnungsId === id || x.invoice?.id === id);

const htmlEscape = (val='') => xmlEscape(String(val));
const fmtChDate = (val) => {
  if (!val) return '';
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-CH');
};
const fmtChCurrency = (val) => {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 'CHF 0.00';
  return num.toLocaleString('de-CH', { style: 'currency', currency: 'CHF' }).replace(/\u00a0/g, ' ');
};
const sanitizeLine = (val='') => String(val || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
const sanitizeIban = (val='') => String(val || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const clinicLogoCache = new Map();
const getClinicLogoDataUrl = (tenantCtx) => {
  const key = tenantCtx?.id || 'default';
  if (clinicLogoCache.has(key)) return clinicLogoCache.get(key);

  const branding = brandingMetaOf(tenantCtx);
  const configured = branding.logo || process.env.CLINIC_LOGO_PATH;
  const fallback = path.join(APP_DIR, 'assets', 'logo.png');
  const candidate = configured
    ? (path.isAbsolute(configured) ? configured : safeJoin(APP_DIR, configured.replace(/^\//, '')))
    : fallback;
  try {
    const buf = fs.readFileSync(candidate);
    const ext = (path.extname(candidate).toLowerCase().replace('.', '')) || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    const value = `data:${mime};base64,${buf.toString('base64')}`;
    clinicLogoCache.set(key, value);
    return value;
  } catch {
    clinicLogoCache.set(key, null);
    return null;
  }
};

// Fallback-Renderer entfernt: nur moderner Renderer in lib/invoices/pdf.js wird verwendet.

async function ensureClaimPdf(tenantCtx, arr, idx, fileId) {
  const claim = arr[idx];
  const pdfPath = path.join(tenantCtx.paths.pdfDir, `${fileId}.pdf`);
  let changed = false;
  let tmpPath = null;

  try {
    const tenantConfig = await getTenantBillingConfig(tenantCtx);
    const pdf = await renderInvoicePdf(claim, tenantConfig, APP_DIR);
    tmpPath = `${pdfPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmpPath, pdf.buffer, { mode: 0o640 });
    await fsp.rename(tmpPath, pdfPath);
    changed = true;
  } catch (err) {
    if (tmpPath) {
      try { await fsp.unlink(tmpPath); } catch {/* ignore */}
    }
    console.error('PDF generation failed:', err?.message || err);
    // kein Fallback mehr – Fehler propagieren
    throw err;
  }

  const url = `/api/faelle/${encodeURIComponent(fileId)}/pdf`;
  if (claim.pdf !== url) {
    claim.pdf = url;
    changed = true;
  }
  if (changed) saveFaelle(tenantCtx, arr);
  return pdfPath;
}

function ensureClaimJson(tenantCtx, arr, idx, fileId) {
  const claim = arr[idx];
  const jsonPath = path.join(tenantCtx.paths.jsonDir, `${fileId}.json`);
  let changed = false;
  if (!fs.existsSync(jsonPath)) {
    fs.writeFileSync(jsonPath, JSON.stringify(claim, null, 2), 'utf8');
    changed = true;
  }
  const url = `/api/faelle/${encodeURIComponent(fileId)}/json`;
  if (claim.json !== url) {
    claim.json = url;
    changed = true;
  }
  if (changed) saveFaelle(tenantCtx, arr);
  return jsonPath;
}

async function ensureClaimXml(tenantCtx, arr, idx, fileId) {
  const claim = arr[idx];
  const xmlPath = path.join(tenantCtx.paths.xmlDir, `${fileId}.xml`);
  let changed = false;
  let normalized = null;
  let validationResult = { ok: true, available: XMLLINT_AVAILABLE && Boolean(INVOICE_XSD_PATH), error: null };
  let billingSettings = null;
  try {
    billingSettings = await getBillingSettings(tenantCtx);
  } catch { /* ignore */ }
  if (!fs.existsSync(xmlPath)) {
    try {
      const cloned = JSON.parse(JSON.stringify(claim));
      normalized = validateAndNormalizeInvoiceClaim(cloned, { billingSettings });
      const xml = buildGeneralInvoice50XML(normalized); // TODO optional 4.5 fallback if required
      if (ENABLE_XSD_VALIDATION && INVOICE_XSD_PATH) {
        validationResult = await validateXMLWithXSD(xml, INVOICE_XSD_PATH);
        if (!validationResult.ok) {
          console.warn(`XML 5.0 validation failed for ${fileId}:`, validationResult.error);
        }
      }
      fs.writeFileSync(xmlPath, xml, 'utf8');
      claim.totals = normalized.totals;
      changed = true;
    } catch (err) {
      console.warn('XML generation skipped for claim', fileId, err.message || err);
      return null;
    }
  } else {
    try {
      const cloned = JSON.parse(JSON.stringify(claim));
      normalized = validateAndNormalizeInvoiceClaim(cloned, { billingSettings });
      claim.totals = normalized.totals;
    } catch {}
  }
  if (claim.xml_validation?.ok !== validationResult.ok || claim.xml_validation?.error !== validationResult.error) {
    claim.xml_validation = validationResult;
    changed = true;
  }
  const url = `/api/faelle/${encodeURIComponent(fileId)}/xml`;
  if (claim.xml !== url) {
    claim.xml = url;
    changed = true;
  }
  if (changed) saveFaelle(tenantCtx, arr);
  return { filepath: fs.existsSync(xmlPath) ? xmlPath : null, validation: validationResult };
}

// ── RBAC (rollen + permissions)
const PERMISSION_CACHE_TTL_MS = Number(process.env.PERMISSION_CACHE_TTL_MS || 30000);
const permissionCache = new Map();

function normalizeAuthRole(role) {
  const normalized = normalizeRoleName(role);
  if (normalized === 'arzt') return 'doctor';
  if (normalized === 'mpa') return 'assistant';
  return normalized;
}

function requireRole(...allowed) {
  const allowedNormalized = allowed.map((entry) => normalizeAuthRole(entry));
  return (req, res, next) => {
    if (!REQUIRE_AUTH) return next();
    const normalizedRole = normalizeAuthRole(req.user?.role || req.user?.rolle);
    if (normalizedRole === 'admin') return next();
    if (allowedNormalized.includes('any') || allowedNormalized.includes(normalizedRole)) return next();
    return res.status(403).json({ message: 'Nicht berechtigt' });
  };
}

function permissionCacheKey(req, normalizedRole) {
  const tenantId = String(req?.tenant?.id || 'default');
  const schemaName = String(req?.tenant?.schemaName || `tenant_${tenantId}`);
  return `${tenantId}:${schemaName}:${normalizedRole}`;
}

async function resolveRequestPermissionSet(req) {
  const normalizedRole = normalizeRoleName(req?.user?.role || req?.user?.rolle || 'mpa');
  const now = Date.now();
  const cacheKey = permissionCacheKey(req, normalizedRole);
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }
  const permissionSet = await resolvePermissionSetForRole({
    db: req?.tenant?.db,
    schemaName: req?.tenant?.schemaName,
    tenantId: req?.tenant?.id,
    role: normalizedRole,
  });
  permissionCache.set(cacheKey, {
    permissions: permissionSet,
    expiresAt: now + Math.max(1000, PERMISSION_CACHE_TTL_MS),
  });
  return permissionSet;
}

async function attachUserPermissions(req) {
  if (!req?.user) return [];
  if (Array.isArray(req.user.permissions) && req.user.permissions.length > 0) {
    return req.user.permissions;
  }
  const permissionSet = await resolveRequestPermissionSet(req);
  const permissions = toSortedPermissionArray(permissionSet);
  req.user.permissions = permissions;
  return permissions;
}

function requirePermission(permission, ...fallbackRoles) {
  const normalizedFallbackRoles = fallbackRoles.map((role) => normalizeAuthRole(role));
  return async (req, res, next) => {
    if (!REQUIRE_AUTH) return next();
    try {
      const normalizedRole = normalizeRoleName(req?.user?.role || req?.user?.rolle || '');
      if (normalizedRole === 'admin') return next();
      const permissionSet = await resolveRequestPermissionSet(req);
      if (hasPermission(permissionSet, permission)) return next();
      const legacyRole = normalizeAuthRole(normalizedRole);
      if (normalizedFallbackRoles.includes(legacyRole)) return next();
      return res.status(403).json({ message: `Nicht berechtigt (${permission})` });
    } catch (err) {
      console.error('Permission check failed:', err?.message || err);
      return res.status(500).json({ message: 'Berechtigungen konnten nicht geprüft werden' });
    }
  };
}

function isAdminAuth(req) {
  return normalizeRoleName(req?.user?.role || req?.user?.rolle) === 'admin';
}

// Optionale XML-XSD-Validierung via xmllint (wenn konfiguriert)
async function validateXMLWithXSD(xmlString, xsdPath) {
  if (!xmlString || !xsdPath || !XMLLINT_AVAILABLE) return { ok: true };
  const tmp = require('os').tmpdir();
  const xmlPath = path.join(tmp, `invoice_${Date.now()}.xml`);
  try {
    fs.writeFileSync(xmlPath, xmlString, 'utf8');
    await new Promise((resolve, reject) => {
      execFile('xmllint', ['--noout', '--schema', xsdPath, xmlPath], (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    try { fs.unlinkSync(xmlPath); } catch {}
  }
}

// ── Auth (JWT)
const verifyJwt = (token) => new Promise((resolve, reject) => {
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err || !payload) return reject(err || new Error('invalid token'));
    resolve(payload);
  });
});

const SCHEMA_IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function quoteSchemaIdent(schemaName, tenantIdForError = 'unknown') {
  const raw = String(schemaName || '').trim().toLowerCase();
  if (!SCHEMA_IDENT_RE.test(raw)) {
    throw new Error(`Ungültiger Tenant-Schema-Name für ${tenantIdForError}`);
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

async function resolveIdentifierEmail(tenantCtx, identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await tenantCtx.db.query(
    `SELECT email
       FROM users
      WHERE tenant_id = $1
        AND (lower(email) = $2 OR lower(username) = $2)
      LIMIT 1`,
    [tenantCtx.id, normalized]
  );
  return String(rows[0]?.email || '').trim().toLowerCase() || null;
}

async function findTenantAuthUserByEmail(tenantCtx, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const schema = quoteSchemaIdent(tenantCtx?.schemaName || `tenant_${tenantCtx?.id}`, tenantCtx?.id);
  const { rows } = await tenantCtx.db.query(
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

async function findTenantAuthUserByIdentifier(tenantCtx, identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return null;
  let authUser = await findTenantAuthUserByEmail(tenantCtx, normalized);
  if (authUser) return authUser;
  const resolvedEmail = await resolveIdentifierEmail(tenantCtx, normalized);
  if (!resolvedEmail) return null;
  return findTenantAuthUserByEmail(tenantCtx, resolvedEmail);
}

async function findTenantAuthUserByLegacyId(tenantCtx, legacyUserId) {
  const id = Number(legacyUserId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const schema = quoteSchemaIdent(tenantCtx?.schemaName || `tenant_${tenantCtx?.id}`, tenantCtx?.id);
  const { rows } = await tenantCtx.db.query(
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
      WHERE u.legacy_user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function buildAppUserFromTenantAuth(tenantCtx, tenantAuthUser) {
  if (!tenantAuthUser) return null;
  const legacyUserId = Number(tenantAuthUser.legacy_user_id);
  const legacyRole = mapTenantRoleToLegacyRole(tenantAuthUser.role_name);
  const { rows } = await tenantCtx.db.query(
    `SELECT id,
            tenant_id,
            name,
            vorname,
            nachname,
            username,
            role,
            rolle,
            email,
            beschreibung,
            metadata
       FROM users
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1`,
    [legacyUserId, tenantCtx.id]
  );
  if (rows.length > 0) {
    const userRow = rows[0];
    userRow.role = legacyRole;
    userRow.rolle = tenantAuthUser.role_name || userRow.rolle || legacyRole;
    userRow.email = userRow.email || tenantAuthUser.email || null;
    userRow.name = userRow.name || tenantAuthUser.display_name || null;
    return userRow;
  }
  const email = String(tenantAuthUser.email || '').trim().toLowerCase();
  const fallbackName = String(tenantAuthUser.display_name || email.split('@')[0] || 'User').trim();
  return {
    id: legacyUserId,
    tenant_id: tenantCtx.id,
    name: fallbackName,
    vorname: null,
    nachname: null,
    username: email.split('@')[0] || null,
    role: legacyRole,
    rolle: tenantAuthUser.role_name || legacyRole,
    email: email || null,
    beschreibung: '',
    metadata: {},
  };
}

async function authenticateToken(req, res, next) {
  if (!REQUIRE_AUTH) {
    try {
      await attachTenantContext(req, req.headers['x-tenant-id'] || tenantManager.getDefaultTenantId());
    } catch (_) { /* ignore in auth-disabled mode */ }
    req.user = req.user || {
      id: req.headers['x-user-id'] || 'test',
      role: req.headers['x-role'] || 'admin',
      name: req.headers['x-user-name'] || 'Test User',
      email: req.headers['x-user-email'] || 'test@example.com'
    };
    return next();
  }
  const cookieToken = req.signedCookies?.[SESSION_COOKIE_NAME];
  const headerToken = (req.headers['authorization'] || '').split(' ')[1];
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ message: 'Kein Token' });

  let payload;
  try {
    payload = await verifyJwt(token);
  } catch (err) {
    await audit('unknown', 'auth.invalid_token', { ...clientMeta(req), reason: err?.message || 'invalid' });
    return res.status(403).json({ message: 'Token ungültig' });
  }

  const tenantId = payload.tenant || payload.mandant || tenantManager.getDefaultTenantId();
  let tenantCtx;
  try {
    tenantCtx = await attachTenantContext(req, tenantId);
  } catch (tenantErr) {
    await audit(tenantId, 'auth.tenant_error', { ...clientMeta(req), reason: tenantErr.message });
    return res.status(403).json({ message: 'Mandant ungültig' });
  }

  try {
    const sessionCheck = await validateSessionToken({ tenantCtx, payload, token });
    if (!sessionCheck.ok) {
      await audit(tenantCtx, 'auth.session_invalid', { ...clientMeta(req), reason: sessionCheck.reason });
      return res.status(401).json({ message: 'Sitzung abgelaufen oder ungültig' });
    }
  } catch (sessionErr) {
    await audit(tenantCtx, 'auth.session_check_failed', { ...clientMeta(req), reason: sessionErr.message });
    return res.status(500).json({ message: 'Session konnte nicht geprüft werden' });
  }

  try {
    const tenantAuthUser = await findTenantAuthUserByLegacyId(tenantCtx, payload.id);
    if (!tenantAuthUser || !tenantAuthUser.is_active) {
      await audit(tenantCtx, 'auth.unknown_user', { ...clientMeta(req), userId: payload.id });
      return res.status(401).json({ message: 'Benutzer nicht gefunden' });
    }
    const userRow = await buildAppUserFromTenantAuth(tenantCtx, tenantAuthUser);
    if (!userRow.role && userRow.rolle) userRow.role = userRow.rolle;
    if (!userRow.role && payload.role) userRow.role = payload.role;
    req.user = userRow;
    await attachUserPermissions(req);
    req.authTokenPayload = payload;
    return next();
  } catch (dbErr) {
    console.error('Auth DB Fehler:', dbErr);
    await audit(tenantCtx, 'auth.db_error', { ...clientMeta(req), error: dbErr.message });
    return res.status(500).json({ message: 'Serverfehler' });
  }
}

const maybeAuth = async (req, res, next) => {
  if (REQUIRE_AUTH) return authenticateToken(req, res, next);
  try {
    await attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId());
    return next();
  } catch (err) {
    return res.status(400).json({ message: 'Mandant ungültig oder fehlt' });
  }
};

// ── Login
// Login rate limiting (configurable for dev troubleshooting)
const DISABLE_LOGIN_RATE_LIMIT = String(process.env.DISABLE_LOGIN_RATE_LIMIT || 'false').toLowerCase() === 'true';
const LOGIN_RATE_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 15*60*1000);
const LOGIN_RATE_LIMIT = Number(process.env.LOGIN_RATE_LIMIT || 20);
if (isProd && DISABLE_LOGIN_RATE_LIMIT) {
  console.error('FATAL: DISABLE_LOGIN_RATE_LIMIT must be false in production.');
  process.exit(1);
}
const loginLimiter = DISABLE_LOGIN_RATE_LIMIT
  ? (_req, _res, next) => next()
  : rateLimit({ windowMs: LOGIN_RATE_WINDOW_MS, limit: LOGIN_RATE_LIMIT, standardHeaders: true, legacyHeaders: false });
const DUMMY_PASSWORD_HASH = process.env.DUMMY_PASSWORD_HASH || bcrypt.hashSync('dummy-password', 10);
const LOGIN_FAILURE_MESSAGE = 'Ungültige Zugangsdaten';

app.get('/api/public/tenants/:tenantId', async (req, res) => {
  try {
    const tenantId = tenantManager.resolveTenantId(req.params.tenantId);
    const tenantCtx = await tenantManager.getTenantContext(tenantId);
    res.json({
      id: tenantCtx.id,
      displayName: tenantCtx.displayName,
      plan: tenantCtx.plan || null,
      country: tenantCtx.country || null,
      dataResidency: tenantCtx.dataResidency || null,
      // SECURITY: Do not leak internal DB info
      meta: publicTenantMeta(tenantCtx),
    });
  } catch (_err) {
    res.status(404).json({ message: 'Mandant nicht gefunden' });
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, username, password, tenant } = req.body || {};
  const identifier = String(email || username || '').trim().toLowerCase();
  if (!identifier || !password) {
    return res.status(400).json({ message: 'E-Mail/Benutzername und Passwort erforderlich' });
  }
  let tenantId;
  try {
    tenantId = tenantManager.resolveTenantId(tenant || resolveTenantIdFromRequest(req));
  } catch (err) {
    return res.status(400).json({ message: 'Ungültiger oder fehlender Mandant' });
  }
  let tenantCtx;
  try {
    tenantCtx = await attachTenantContext(req, tenantId);
  } catch (err) {
    return res.status(400).json({ message: 'Mandant konnte nicht geladen werden' });
  }
  try {
    const tenantAuthUser = await findTenantAuthUserByIdentifier(tenantCtx, identifier);
    if (!tenantAuthUser || !tenantAuthUser.is_active) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      await audit(tenantCtx, 'login.failed', { username: identifier, ...clientMeta(req), reason: 'invalid_credentials' });
      return res.status(401).json({ message: LOGIN_FAILURE_MESSAGE });
    }
    if (!tenantAuthUser.legacy_user_id) {
      await audit(tenantCtx, 'login.failed', { username: identifier, ...clientMeta(req), reason: 'legacy_user_mapping_missing' });
      return res.status(500).json({ message: 'Benutzer-Mapping ist unvollständig' });
    }
    const ok = await bcrypt.compare(password, tenantAuthUser.password_hash || '');
    if (!ok) {
      await audit(tenantCtx, 'login.failed', { username: identifier, ...clientMeta(req), reason: 'invalid_credentials' });
      return res.status(401).json({ message: LOGIN_FAILURE_MESSAGE });
    }
    const user = await buildAppUserFromTenantAuth(tenantCtx, tenantAuthUser);
    const { token, ttlHours, sessionId, expiresAt } = await createSessionToken({
      tenantCtx,
      user,
      jwtSecret: JWT_SECRET,
      req,
      expiresHours: JWT_EXPIRES_HOURS,
    });
    const isHttps = SESSION_COOKIE_SECURE || req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieOptions = {
      httpOnly: true,
      secure: Boolean(isHttps),
      sameSite: SESSION_COOKIE_SAMESITE,
      signed: true,
      maxAge: ttlHours * 60 * 60 * 1000
    };
    if (SESSION_COOKIE_DOMAIN) cookieOptions.domain = SESSION_COOKIE_DOMAIN;
    res.cookie(SESSION_COOKIE_NAME, token, cookieOptions);
    await audit(tenantCtx, 'login.success', {
      userId: user.id,
      username: user.email || user.username,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      ...clientMeta(req)
    });
    const loginPermissions = toSortedPermissionArray(
      await resolvePermissionSetForRole({
        db: tenantCtx.db,
        schemaName: tenantCtx.schemaName,
        tenantId: tenantCtx.id,
        role: tenantAuthUser.role_name || user.role || user.rolle,
      })
    );
    res.json({
      user: {
        ...toPublicUser(user),
        permissions: loginPermissions,
      },
      tenant: tenantCtx.id,
      tenantName: tenantCtx.displayName,
      tenantSchema: tenantCtx.schemaName || null,
      tenantPlan: tenantCtx.plan || null,
      tenantCountry: tenantCtx.country || null,
      tenantDataResidency: tenantCtx.dataResidency || null,
      sessionExpiresAt: expiresAt.toISOString(),
      sessionTtlHours: ttlHours,
      // SECURITY: Do not expose database name
      tenantMeta: publicTenantMeta(tenantCtx)
    });
  } catch (e) {
    console.error(e);
    await audit(tenantCtx || tenantId || 'unknown', 'login.error', { username, error: e.message });
    res.status(500).json({ message: 'Serverfehler' });
  }
});

app.post('/api/logout', authenticateToken, async (req, res) => {
  const isHttps = SESSION_COOKIE_SECURE || req.secure || req.headers['x-forwarded-proto'] === 'https';
  const clearOptions = { httpOnly: true, secure: Boolean(isHttps), sameSite: SESSION_COOKIE_SAMESITE, signed: true };
  if (SESSION_COOKIE_DOMAIN) clearOptions.domain = SESSION_COOKIE_DOMAIN;
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
  try {
    const payload = req.authTokenPayload || null;
    if (payload?.sid && req.tenant) {
      await revokeSessionById({ tenantCtx: req.tenant, sessionId: payload.sid });
    }
  } catch (err) {
    console.error('Session revoke failed on logout:', err?.message || err);
  }
  await audit(req, 'logout', { userId: req.user?.id, username: req.user?.username, ...clientMeta(req) });
  res.status(204).end();
});

// ====== KALENDER & TERMINE API (Tenant-aware, JWT-geschützt) ======
// Hinweis: Diese Routen sind gezielt für main_kalender.js optimiert.
// Sie werden VOR älteren, abwärtskompatiblen Routen registriert, damit sie greifen.
const apiRouter = express.Router();

// Session / Profil (für Frontend-Init)
apiRouter.get('/session/me', authenticateToken, async (req, res) => {
  try {
    const permissions = await attachUserPermissions(req);
    const tenant = {
      id: req.tenant.id,
      name: req.tenant?.config?.meta?.clinic?.name || req.tenant?.id || 'Tenant',
      schema: req.tenant?.schemaName || null,
      plan: req.tenant?.plan || null,
      country: req.tenant?.country || null,
      dataResidency: req.tenant?.dataResidency || null,
    };
    const user = req.user ? {
      id: req.user.id,
      role: req.user.role || req.user.rolle || 'assistant',
      name: req.user.displayName || req.user.name || `${req.user.vorname || ''} ${req.user.nachname || ''}`.trim(),
      email: req.user.email || null,
      permissions,
    } : null;
    res.json({ tenant, user });
  } catch (err) {
    res.status(500).json({ message: 'Session konnte nicht gelesen werden' });
  }
});

// Kalender auflisten
apiRouter.get('/calendars', authenticateToken, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const role = String(req.user?.role || req.user?.rolle || '').toLowerCase();
    const uid = Number(req.user?.id);
    const isPrivileged = ['admin', 'doctor', 'arzt', 'ärztin'].includes(role);

    let rows;
    if (isPrivileged) {
      // Ensure all tenant users have personal calendars so admins can find/switch user calendars.
      try {
        await db.query(`SELECT public.ensure_tenant_default_calendar($1)`, [req.tenant.id]);
      } catch {}
      try {
        await db.query(
          `SELECT public.ensure_user_calendar($1, u.id)
             FROM users u
            WHERE u.tenant_id = $1`,
          [req.tenant.id]
        );
      } catch (e) {
        // Fallback for DBs where helper functions are not present yet.
        if (String(e?.code || '') !== '42883') {
          console.warn('calendar auto-provision warning:', e?.message || e);
        }
        await db.query(
          `INSERT INTO calendars (tenant_id, name, type, owner_user_id, is_default, metadata)
           SELECT u.tenant_id,
                  COALESCE(NULLIF(trim(u.name), ''), u.email, 'Benutzer-Kalender'),
                  'user',
                  u.id,
                  false,
                  jsonb_build_object('role', u.role)
             FROM users u
             LEFT JOIN calendars c
               ON c.tenant_id = u.tenant_id
              AND c.type = 'user'
              AND c.owner_user_id = u.id
            WHERE u.tenant_id = $1
              AND c.id IS NULL
           ON CONFLICT DO NOTHING`,
          [req.tenant.id]
        );
        await db.query(
          `INSERT INTO calendar_members (calendar_id, user_id, role)
           SELECT c.id, c.owner_user_id, 'owner'
             FROM calendars c
            WHERE c.tenant_id = $1
              AND c.type = 'user'
              AND c.owner_user_id IS NOT NULL
           ON CONFLICT DO NOTHING`,
          [req.tenant.id]
        );
        await db.query(
          `INSERT INTO calendar_members (calendar_id, user_id, role)
           SELECT c.id, u.id, 'viewer'
             FROM calendars c
             JOIN users u
               ON u.tenant_id = c.tenant_id
            WHERE c.tenant_id = $1
              AND c.type = 'user'
              AND c.owner_user_id IS NOT NULL
              AND lower(coalesce(u.role, u.rolle, '')) = 'admin'
              AND u.id <> c.owner_user_id
           ON CONFLICT DO NOTHING`,
          [req.tenant.id]
        );
      }
      const { rows: r } = await db.query(
        `SELECT id, tenant_id, name, type, owner_user_id, is_default, metadata
           FROM calendars
          WHERE tenant_id = $1
          ORDER BY type, id`,
        [req.tenant.id]
      );
      rows = r;
    } else {
      const { rows: r } = await db.query(
        `SELECT id, tenant_id, name, type, owner_user_id, is_default, metadata
           FROM calendars
          WHERE tenant_id = $1
            AND (
              (type = 'user' AND owner_user_id = $2)
              OR (type = 'tenant' AND (is_default = true OR (metadata->>'is_default')::boolean = true))
            )
          ORDER BY type, id`,
        [req.tenant.id, uid || 0]
      );
      rows = r;
    }

    res.json({ items: rows });
  } catch (err) {
    console.error('GET /api/calendars error', err);
    res.status(500).json({ message: 'Kalender konnten nicht geladen werden' });
  }
});

// Kompat-Aliasse für bestehendes Frontend
apiRouter.get('/calendars/tenant', authenticateToken, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  // Delegiert an /api/calendars
  req.url = '/calendars';
  return apiRouter.handle(req, res);
});
apiRouter.get('/calendars/me', authenticateToken, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  // Delegiert an /api/calendars
  req.url = '/calendars';
  return apiRouter.handle(req, res);
});
apiRouter.get('/calendars/mine', authenticateToken, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const uid = Number(req.user?.id || 0);
    const ensureMemberships = async (calendarId) => {
      if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(Number(calendarId))) return;
      await db.query(
        `INSERT INTO calendar_members (calendar_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (calendar_id, user_id) DO UPDATE
         SET role = CASE
           WHEN calendar_members.role = 'owner' THEN calendar_members.role
           ELSE EXCLUDED.role
         END`,
        [Number(calendarId), uid]
      );
      await db.query(
        `INSERT INTO calendar_members (calendar_id, user_id, role)
         SELECT $1, u.id, 'viewer'
           FROM users u
          WHERE u.tenant_id = $2
            AND lower(coalesce(u.role, u.rolle, '')) = 'admin'
            AND u.id <> $3
         ON CONFLICT DO NOTHING`,
        [Number(calendarId), req.tenant.id, uid]
      );
    };
    const { rows } = await db.query(
      `SELECT id, tenant_id, name, type, owner_user_id, is_default, metadata
         FROM calendars
        WHERE tenant_id = $1 AND type = 'user' AND owner_user_id = $2
        LIMIT 1`,
      [req.tenant.id, uid]
    );
    if (rows.length) {
      await ensureMemberships(rows[0].id);
      return res.json(rows[0]);
    }
    // Auto-Provision persönlicher Kalender
    const display = req.user?.name || req.user?.email || 'Mein Kalender';
    const ins = await db.query(
      `INSERT INTO calendars(tenant_id, name, type, owner_user_id, is_default)
       VALUES ($1,$2,'user',$3,false)
       RETURNING id, tenant_id, name, type, owner_user_id, is_default, metadata`,
      [req.tenant.id, String(display).slice(0,80), uid]
    );
    await ensureMemberships(ins.rows[0]?.id);
    return res.json(ins.rows[0]);
  } catch (err) {
    console.error('GET /api/calendars/mine error', err);
    res.status(500).json({ message: 'Persönlicher Kalender nicht verfügbar' });
  }
});

// NOTE: Termine & Benutzerliste laufen über die tenant-aware Endpunkte weiter unten:
// - GET/POST/PUT/DELETE /api/appointments (inkl. legacy Payloads)
// - GET /api/appointments/by-calendars (für main_kalender.js)
// - GET /api/users/accessible (für Calendar UI)

// ====== NOTES API (tenant-aware) ======
const notesService = require('./lib/notes/service');

// List notes
apiRouter.get('/notes', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const filters = {
      visibilityType: req.query.visibilityType || req.query.visibility_type || req.query.visibility,
      patientId: req.query.patientId != null ? Number(req.query.patientId) : (req.query.patient_id != null ? Number(req.query.patient_id) : undefined),
      tag: req.query.tag,
      search: req.query.q || req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
    };
    const items = await notesService.listNotes(req.tenant, filters, req.user);
    res.json({ items, count: items.length });
  } catch (err) {
    console.error('GET /api/notes failed:', err);
    res.status(500).json({ message: 'Notizen konnten nicht geladen werden' });
  }
});

// Get single note (with attachments)
apiRouter.get('/notes/:id', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const dto = await notesService.getNote(req.tenant, req.params.id);
    if (!dto) return res.status(404).json({ message: 'Notiz nicht gefunden' });
    // Visibility enforcement for PERSONAL
    if (dto.note.visibility_type === 'PERSONAL' && Number(dto.note.owner_user_id) !== Number(req.user?.id)) {
      return res.status(403).json({ message: 'Nicht berechtigt' });
    }
    res.json(dto);
  } catch (err) {
    console.error('GET /api/notes/:id failed:', err);
    res.status(500).json({ message: 'Notiz konnte nicht geladen werden' });
  }
});

// Create note
apiRouter.post('/notes', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const created = await notesService.createNote(req.tenant, req.body || {}, req.user);
    res.status(201).json(created);
  } catch (err) {
    console.error('POST /api/notes failed:', err);
    res.status(400).json({ message: err?.message || 'Notiz konnte nicht erstellt werden' });
  }
});

// Update note
apiRouter.patch('/notes/:id', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const updated = await notesService.updateNote(req.tenant, req.params.id, req.body || {}, req.user);
    res.json(updated);
  } catch (err) {
    const code = /nicht gefunden/i.test(String(err?.message)) ? 404 : 400;
    console.error('PATCH /api/notes/:id failed:', err);
    res.status(code).json({ message: err?.message || 'Notiz konnte nicht aktualisiert werden' });
  }
});

// Lock note (set locked = true)
apiRouter.patch('/notes/:id/lock', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const locked = await notesService.lockNote(req.tenant, req.params.id, req.user);
    res.json(locked);
  } catch (err) {
    const code = /nicht gefunden/i.test(String(err?.message)) ? 404 : 400;
    console.error('PATCH /api/notes/:id/lock failed:', err);
    res.status(code).json({ message: err?.message || 'Notiz konnte nicht gesperrt werden' });
  }
});

// Soft-delete
apiRouter.delete('/notes/:id', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const ok = await notesService.softDeleteNote(req.tenant, req.params.id, req.user);
    if (!ok) return res.status(404).json({ message: 'Notiz nicht gefunden' });
    res.json({ ok: true });
  } catch (err) {
    const code = /nicht gefunden/i.test(String(err?.message)) ? 404 : 400;
    console.error('DELETE /api/notes/:id failed:', err);
    res.status(code).json({ message: err?.message || 'Notiz konnte nicht gelöscht werden' });
  }
});

// Attachments: list
apiRouter.get('/notes/:id/attachments', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const list = await notesService.listAttachments(req.tenant, req.params.id);
    res.json({ items: list, count: list.length });
  } catch (err) {
    console.error('GET /api/notes/:id/attachments failed:', err);
    res.status(500).json({ message: 'Anhänge konnten nicht geladen werden' });
  }
});

// Attachments: add by file_path reference (integrate with existing uploads)
apiRouter.post('/notes/:id/attachments', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const filePath = String(req.body?.file_path || req.body?.path || '').trim();
    if (!filePath) return res.status(400).json({ message: 'file_path erforderlich' });
    const row = await notesService.addAttachment(req.tenant, req.params.id, filePath, req.user?.id);
    res.status(201).json(row);
  } catch (err) {
    const code = /nicht gefunden/i.test(String(err?.message)) ? 404 : 400;
    console.error('POST /api/notes/:id/attachments failed:', err);
    res.status(code).json({ message: err?.message || 'Anhang konnte nicht hinzugefügt werden' });
  }
});

// ====== PATIENTEN-JOURNEY & WARTEZIMMER ======
const JOURNEY_STAGES = ['NEW','ABKLAERUNG','OP_GEPLANT','OP_ERFOLGT','NACHKONTROLLE','ABGESCHLOSSEN'];
const WAITING_STATUSES = ['ANGEMELDET','WARTEZIMMER','IN_BEHANDLUNG','FERTIG'];

// Helper to ensure patient belongs to tenant and exists
async function ensurePatientInTenant(db, tenantId, patientId) {
  const { rows } = await db.query(
    `SELECT id, vorname, nachname, name FROM patients WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, Number(patientId)]
  );
  return rows[0] || null;
}

// List journey entries (optionally filter by stage)
apiRouter.get('/patient-journey', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const stage = (req.query.stage || '').toString().trim().toUpperCase();
    const params = [tenantId];
    let where = 'pj.tenant_id = $1';
    if (stage && JOURNEY_STAGES.includes(stage)) { params.push(stage); where += ` AND pj.stage = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT pj.id, pj.tenant_id, pj.patient_id, pj.stage, pj.updated_at, pj.updated_by_user_id,
              p.vorname, p.nachname, p.name
         FROM patient_journey pj
         JOIN patients p ON p.id = pj.patient_id AND p.tenant_id = pj.tenant_id
        WHERE ${where}
        ORDER BY pj.updated_at DESC`
      , params);
    res.json({ items: rows });
  } catch (err) {
    console.error('GET /api/patient-journey failed:', err);
    res.status(500).json({ message: 'Patienten-Journey konnte nicht geladen werden' });
  }
});

// Get journey for a patient
apiRouter.get('/patients/:id/journey', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    const patient = await ensurePatientInTenant(db, tenantId, pid);
    if (!patient) return res.status(404).json({ message: 'Patient nicht gefunden' });
    const { rows } = await db.query(
      `SELECT id, tenant_id, patient_id, stage, updated_at, updated_by_user_id
         FROM patient_journey
        WHERE tenant_id = $1 AND patient_id = $2
        LIMIT 1`,
      [tenantId, pid]
    );
    if (!rows.length) return res.json({ patient_id: pid, stage: 'NEW' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/patients/:id/journey failed:', err);
    res.status(500).json({ message: 'Patienten-Journey konnte nicht geladen werden' });
  }
});

// Update journey stage for a patient (upsert)
apiRouter.patch('/patients/:id/journey', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const uid = Number(req.user?.id) || null;
    const pid = Number(req.params.id);
    const stage = String(req.body?.stage || '').trim().toUpperCase();
    if (!pid) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    if (!JOURNEY_STAGES.includes(stage)) return res.status(400).json({ message: 'Ungültige Stage' });
    const patient = await ensurePatientInTenant(db, tenantId, pid);
    if (!patient) return res.status(404).json({ message: 'Patient nicht gefunden' });
    const { rows } = await db.query(
      `INSERT INTO patient_journey (tenant_id, patient_id, stage, updated_by_user_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, patient_id)
       DO UPDATE SET stage = EXCLUDED.stage, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
       RETURNING id, tenant_id, patient_id, stage, updated_at, updated_by_user_id`,
      [tenantId, pid, stage, uid]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/patients/:id/journey failed:', err);
    res.status(500).json({ message: 'Patienten-Journey konnte nicht gespeichert werden' });
  }
});

// List waiting room entries (optionally filter by status)
apiRouter.get('/waiting-room', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const status = (req.query.status || '').toString().trim().toUpperCase();
    const params = [tenantId];
    let where = 'w.tenant_id = $1';
    if (status && WAITING_STATUSES.includes(status)) { params.push(status); where += ` AND w.status = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT w.id, w.tenant_id, w.patient_id, w.status, w.last_change_at, w.last_change_by_user_id,
              p.vorname, p.nachname, p.name
         FROM waiting_room_status w
         JOIN patients p ON p.id = w.patient_id AND p.tenant_id = w.tenant_id
        WHERE ${where}
        ORDER BY w.last_change_at DESC`,
      params
    );
    const now = Date.now();
    const items = rows.map(r => ({ ...r, waiting_ms: Math.max(0, now - new Date(r.last_change_at).getTime()) }));
    res.json({ items });
  } catch (err) {
    console.error('GET /api/waiting-room failed:', err);
    res.status(500).json({ message: 'Wartezimmer konnte nicht geladen werden' });
  }
});

// Get waiting status for a patient
apiRouter.get('/patients/:id/waiting-status', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    const patient = await ensurePatientInTenant(db, tenantId, pid);
    if (!patient) return res.status(404).json({ message: 'Patient nicht gefunden' });
    const { rows } = await db.query(
      `SELECT id, tenant_id, patient_id, status, last_change_at, last_change_by_user_id
         FROM waiting_room_status
        WHERE tenant_id = $1 AND patient_id = $2
        LIMIT 1`,
      [tenantId, pid]
    );
    if (!rows.length) return res.json({ patient_id: pid, status: 'ANGEMELDET' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/patients/:id/waiting-status failed:', err);
    res.status(500).json({ message: 'Wartezimmer-Status konnte nicht geladen werden' });
  }
});

// Update waiting status (upsert)
apiRouter.post('/patients/:id/waiting-status', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const db = req.tenant.db;
    const tenantId = req.tenant.id;
    const uid = Number(req.user?.id) || null;
    const pid = Number(req.params.id);
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!pid) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    if (!WAITING_STATUSES.includes(status)) return res.status(400).json({ message: 'Ungültiger Status' });
    const patient = await ensurePatientInTenant(db, tenantId, pid);
    if (!patient) return res.status(404).json({ message: 'Patient nicht gefunden' });
    const { rows } = await db.query(
      `INSERT INTO waiting_room_status (tenant_id, patient_id, status, last_change_by_user_id, last_change_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (tenant_id, patient_id)
       DO UPDATE SET status = EXCLUDED.status, last_change_by_user_id = EXCLUDED.last_change_by_user_id, last_change_at = now()
       RETURNING id, tenant_id, patient_id, status, last_change_at, last_change_by_user_id`,
      [tenantId, pid, status, uid]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('POST /api/patients/:id/waiting-status failed:', err);
    res.status(500).json({ message: 'Wartezimmer-Status konnte nicht gespeichert werden' });
  }
});

// Router mounten (vor Alt-Routen, damit diese greifen)
app.use('/api', apiRouter);

app.post('/api/admin/tenants/reload', maybeAuth, requireRole('admin'), async (req, res) => {
  try {
    tenantManager.reloadTenants();
    await tenantManager.bootstrapAllTenants();
    permissionCache.clear();
    const contexts = await Promise.all(
      tenantManager.listTenants().map((tenant) => tenantManager.getTenantContext(tenant.id))
    );
    const summary = contexts.map((ctx) => ({
      id: ctx.id,
      name: ctx.displayName,
      schema: ctx.schemaName || null,
      plan: ctx.plan || null,
      country: ctx.country || null,
      dataResidency: ctx.dataResidency || null,
      database: ctx.config.db.database,
      storage: describeTenantStorage(ctx),
    }));
    await audit(req, 'tenant.reload', { userId: req.user?.id || req.user?.username, ...clientMeta(req) });
    res.status(202).json({ message: 'Mandantenkonfiguration wurde neu geladen', tenants: summary });
  } catch (err) {
    console.error('Tenant reload failed:', err);
    await audit(req, 'tenant.reload_failed', { error: err?.message, ...clientMeta(req) });
    res.status(500).json({ message: 'Mandanten konnten nicht neu geladen werden' });
  }
});

app.get('/api/session', authenticateToken, async (req, res) => {
  try {
    const permissions = await attachUserPermissions(req);
    res.json({
      user: {
        ...toPublicUser(req.user),
        permissions,
      },
      tenant: req.tenant?.id,
      tenantName: req.tenant?.displayName,
      tenantSchema: req.tenant?.schemaName || null,
      tenantPlan: req.tenant?.plan || null,
      tenantCountry: req.tenant?.country || null,
      tenantDataResidency: req.tenant?.dataResidency || null,
      // SECURITY: Do not expose database name
      tenantMeta: publicTenantMeta(req.tenant)
    });
  } catch (err) {
    res.status(500).json({ message: 'Session konnte nicht gelesen werden' });
  }
});

// ====== Automation & Reminders Settings ======
// Basic per-tenant settings: reminders and auto-tasks
async function getAutomationSettings(tenantCtx) {
  const defaults = {
    reminders: { enabled: true, defaults: [{ offsetMinutes: 1440, channel: 'INTERNAL' }, { offsetMinutes: 120, channel: 'INTERNAL' }] },
    autoTasks: { labResult: true, discharge: true }
  };
  const storedRoot = (await loadTenantSettingsJson(tenantCtx)).json || {};
  const legacyStored = (storedRoot && typeof storedRoot === 'object') ? storedRoot : {};
  const stored = (legacyStored.automation && typeof legacyStored.automation === 'object')
    ? legacyStored.automation
    : (legacyStored.reminders || legacyStored.autoTasks ? legacyStored : {});
  const merged = { ...defaults, ...(stored || {}) };
  // merge nested for safety
  merged.reminders = { ...defaults.reminders, ...(merged.reminders || {}) };
  if (!Array.isArray(merged.reminders.defaults)) merged.reminders.defaults = defaults.reminders.defaults;
  merged.autoTasks = { ...defaults.autoTasks, ...(merged.autoTasks || {}) };
  return merged;
}

async function saveAutomationSettings(tenantCtx, settings) {
  const value = settings && typeof settings === 'object' ? settings : {};
  const loaded = await loadTenantSettingsJson(tenantCtx);
  const root = loaded.json && typeof loaded.json === 'object' ? loaded.json : {};
  root.automation = { ...(root.automation || {}), ...value };
  await saveTenantSettingsJson(tenantCtx, root, { prefer: loaded.column || 'settings' });
  return root.automation;
}

app.get('/api/settings/automation', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const s = await getAutomationSettings(tenantCtx);
    res.json({ settings: s });
  } catch (err) {
    res.status(500).json({ message: 'Einstellungen konnten nicht geladen werden' });
  }
});

app.patch('/api/settings/automation', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const merged = req.body && typeof req.body === 'object' ? req.body : {};
    const saved = await saveAutomationSettings(tenantCtx, merged);
    res.json({ settings: saved });
  } catch (err) {
    res.status(400).json({ message: 'Einstellungen konnten nicht gespeichert werden' });
  }
});

// ====== Billing Settings (TARDOC/GeneralInvoice) ======
const normalizeLawKey = (raw) => {
  const v = String(raw || '').trim().toUpperCase();
  if (!v) return '';
  if (v === 'IV') return 'IVG';
  if (v === 'MV') return 'MVG';
  if (v.includes('SELBST') || v.includes('SELF') || v === 'SEL') return 'ORG';
  return v;
};

const parsePointValue = (val) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (!(n > 0)) return null;
  return n;
};

const normalizePointValuesPayload = (payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const enforce = Boolean(p.enforce_point_value ?? p.enforcePointValue ?? p.enforce ?? false);
  const pointValuesIn = p.pointValues || p.point_values || p.point_values_chf || {};
  const out = { enforce_point_value: enforce, pointValues: {} };
  if (!pointValuesIn || typeof pointValuesIn !== 'object' || Array.isArray(pointValuesIn)) return out;

  for (const [lawRaw, lawCfg] of Object.entries(pointValuesIn)) {
    const law = normalizeLawKey(lawRaw);
    if (!law) continue;
    const cfg = lawCfg && typeof lawCfg === 'object' && !Array.isArray(lawCfg) ? lawCfg : {};
    const def = parsePointValue(cfg.default ?? cfg.default_chf ?? cfg.point_value_chf ?? cfg.value);
    const byCantonIn = cfg.byCanton || cfg.by_canton || cfg.cantons || {};
    const byCanton = {};
    if (byCantonIn && typeof byCantonIn === 'object' && !Array.isArray(byCantonIn)) {
      for (const [cantonRaw, pvRaw] of Object.entries(byCantonIn)) {
        const canton = String(cantonRaw || '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(canton)) continue;
        const pv = parsePointValue(pvRaw);
        if (pv) byCanton[canton] = pv;
      }
    }
    out.pointValues[law] = {
      ...(def ? { default: def } : {}),
      ...(Object.keys(byCanton).length ? { byCanton } : {})
    };
  }
  return out;
};

const resolvePointValueFromSettings = ({ billingSettings, law, canton }) => {
  const key = normalizeLawKey(law);
  const pv = billingSettings?.pointValues?.[key];
  if (!pv || typeof pv !== 'object') return null;
  const c = String(canton || '').trim().toUpperCase();
  if (c && pv.byCanton && typeof pv.byCanton === 'object' && pv.byCanton[c]) {
    return parsePointValue(pv.byCanton[c]);
  }
  return parsePointValue(pv.default);
};

async function getBillingSettings(tenantCtx) {
  const defaults = { enforce_point_value: false, pointValues: {} };
  const storedRoot = (await loadTenantSettingsJson(tenantCtx)).json || {};
  const stored = (storedRoot && typeof storedRoot === 'object' && storedRoot.billing && typeof storedRoot.billing === 'object')
    ? storedRoot.billing
    : {};
  const normalized = normalizePointValuesPayload(stored);
  return { ...defaults, ...normalized };
}

async function saveBillingSettings(tenantCtx, patch) {
  const loaded = await loadTenantSettingsJson(tenantCtx);
  const root = loaded.json && typeof loaded.json === 'object' ? loaded.json : {};
  const current = (root.billing && typeof root.billing === 'object') ? root.billing : {};
  const merged = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
  const normalized = normalizePointValuesPayload(merged);
  root.billing = normalized;
  await saveTenantSettingsJson(tenantCtx, root, { prefer: loaded.column || 'settings' });
  return normalized;
}

app.get('/api/settings/billing', authenticateToken, requireRole('admin','abrechnung','billing','arzt','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const settings = await getBillingSettings(tenantCtx);
    res.json({ settings });
  } catch (err) {
    console.error('GET /api/settings/billing failed:', err?.message || err);
    res.status(500).json({ message: 'Billing-Einstellungen konnten nicht geladen werden' });
  }
});

app.patch('/api/settings/billing', authenticateToken, requireRole('admin','abrechnung','billing','arzt','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const saved = await saveBillingSettings(tenantCtx, req.body || {});
    res.json({ settings: saved });
  } catch (err) {
    console.error('PATCH /api/settings/billing failed:', err?.message || err);
    res.status(400).json({ message: err?.message || 'Billing-Einstellungen konnten nicht gespeichert werden' });
  }
});

// Generic event hook → automatic tasks (lab result, discharge)
app.post('/api/automation/events', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { type, patientId, details } = req.body || {};
    if (!type) return res.status(400).json({ message: 'type fehlt' });
    const pid = patientId ? Number(patientId) : null;
    const settings = await getAutomationSettings(tenantCtx);
    const auto = settings.autoTasks || {};
    let created = null;
    if (type === 'NEW_LAB_RESULT' && auto.labResult) {
      created = await tasksService.createTask(tenantCtx, {
        title: 'Laborbefund prüfen / Patient informieren',
        description: details ? JSON.stringify(details) : null,
        type: 'LAB_RESULT',
        priority: 'HIGH',
        patient_id: pid
      }, req.user?.id || null);
    } else if (type === 'DISCHARGE' && auto.discharge) {
      created = await tasksService.createTask(tenantCtx, {
        title: 'Austrittsbericht erstellen',
        description: details ? JSON.stringify(details) : null,
        type: 'DISCHARGE',
        priority: 'NORMAL',
        patient_id: pid
      }, req.user?.id || null);
    }
    // Flow engine: execute active workflows for this trigger
    try {
      const { rows: defs } = await tenantCtx.db.query(`SELECT * FROM workflow_definitions WHERE tenant_id = $1 AND is_active = true AND trigger_type = $2`, [tenantCtx.id, String(type).toUpperCase()]);
      for (const def of defs) {
        try {
          const steps = Array.isArray(def.definition_json) ? def.definition_json : [];
          for (const step of steps) {
            if (step?.type === 'CREATE_TASK') {
              await tasksService.createTask(tenantCtx, {
                title: step.parameters?.title || 'Automatische Aufgabe',
                description: step.parameters?.description || null,
                type: step.parameters?.taskType || 'FLOW',
                priority: step.parameters?.priority || 'NORMAL',
                patient_id: pid || null,
                due_date: step.parameters?.dueOffsetDays ? new Date(Date.now() + Number(step.parameters.dueOffsetDays)*24*60*60*1000) : null
              }, req.user?.id || null);
            } else if (step?.type === 'SEND_REMINDER') {
              // Mark a reminder job by creating an appointment_reminders row for context if appointment_id known in details
              if (details?.appointment_id) {
                const off = Number(step.parameters?.offsetMinutes || 60);
                const channel = String(step.parameters?.channel || 'INTERNAL').toUpperCase();
                const { rows: apptRows } = await tenantCtx.db.query(`SELECT starts_at FROM appointments WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, Number(details.appointment_id)]);
                if (apptRows.length) {
                  const due = new Date(new Date(apptRows[0].starts_at).getTime() - off*60000);
                  await tenantCtx.db.query(
                    `INSERT INTO appointment_reminders (tenant_id, appointment_id, channel, due_at, status, payload) VALUES ($1,$2,$3,$4,'PENDING',$5) ON CONFLICT DO NOTHING`,
                    [tenantCtx.id, Number(details.appointment_id), channel, due, { patient_id: pid }]
                  );
                }
              }
            }
          }
          await tenantCtx.db.query(`INSERT INTO workflow_runs (tenant_id, workflow_definition_id, trigger_context) VALUES ($1,$2,$3)`, [tenantCtx.id, def.id, { type, patientId, details }]);
        } catch (_) {}
      }
    } catch (_) {}

    res.json({ ok: true, task: created });
  } catch (err) {
    res.status(500).json({ message: 'Event konnte nicht verarbeitet werden' });
  }
});

// ====== Reminder Scheduler (lightweight) ======
async function sweepCreateReminders(tenantCtx, now = new Date()) {
  const settings = await getAutomationSettings(tenantCtx);
  if (!settings?.reminders?.enabled) return { created: 0 };
  const defs = Array.isArray(settings.reminders.defaults) ? settings.reminders.defaults : [];
  if (!defs.length) return { created: 0 };

  // limit search window: next 2 days
  const windowEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  // fetch candidate appointments
  const { rows } = await tenantCtx.db.query(
    `SELECT id, tenant_id, patient_id, starts_at
       FROM appointments
      WHERE tenant_id = $1 AND starts_at >= $2 AND starts_at <= $3`,
    [tenantCtx.id, now, windowEnd]
  );
  let created = 0;
  for (const appt of rows) {
    for (const def of defs) {
      const off = Number(def?.offsetMinutes);
      const channel = String(def?.channel || 'INTERNAL').toUpperCase();
      if (!Number.isFinite(off)) continue;
      const due = new Date(new Date(appt.starts_at).getTime() - off * 60000);
      // Avoid creating reminders extremely in the past (server restart)
      if (due.getTime() < now.getTime() - 10 * 60 * 1000) continue;
      try {
        await tenantCtx.db.query(
          `INSERT INTO appointment_reminders (tenant_id, appointment_id, channel, due_at, status, payload)
           VALUES ($1,$2,$3,$4,'PENDING', $5)
           ON CONFLICT (tenant_id, appointment_id, channel, due_at) DO NOTHING`,
          [tenantCtx.id, appt.id, channel, due, { patient_id: appt.patient_id }]
        );
        created++;
      } catch (_) {}
    }
  }
  return { created };
}

async function sweepDispatchReminders(tenantCtx, now = new Date()) {
  const { rows } = await tenantCtx.db.query(
    `SELECT r.id, r.appointment_id, r.channel, r.due_at, a.patient_id, a.starts_at
       FROM appointment_reminders r
       JOIN appointments a ON a.id = r.appointment_id
      WHERE r.tenant_id = $1 AND r.status = 'PENDING' AND r.due_at <= $2
      ORDER BY r.due_at ASC
      LIMIT 100`,
    [tenantCtx.id, now]
  );
  let sent = 0;
  for (const row of rows) {
    try {
      // For now: create an internal task instead of external delivery
      await tasksService.createTask(tenantCtx, {
        title: 'Terminerinnerung senden',
        description: `Erinnerung für Termin am ${new Date(row.starts_at).toLocaleString('de-CH')}`,
        type: 'REMINDER',
        priority: 'NORMAL',
        patient_id: row.patient_id,
        related_appointment_id: row.appointment_id,
        tags: ['REMINDER','AUTO']
      }, null);
      await tenantCtx.db.query(
        `UPDATE appointment_reminders SET status='SENT', sent_at = now(), updated_at = now() WHERE id = $1`,
        [row.id]
      );
      sent++;
    } catch (err) {
      await tenantCtx.db.query(`UPDATE appointment_reminders SET status='FAILED', updated_at = now() WHERE id = $1`, [row.id]);
    }
  }
  return { sent };
}

setInterval(async () => {
  try {
    const tenants = tenantManager.listTenants();
    for (const t of tenants) {
      try {
        const ctx = await tenantManager.getTenantContext(t.id);
        await sweepCreateReminders(ctx);
        await sweepDispatchReminders(ctx);
      } catch (eTenant) {
        // continue other tenants
      }
    }
  } catch (e) {
    // ignore
  }
}, 60 * 1000).unref();

// ====== Rooms & Room Bookings (tenant-aware) ======
// List rooms
app.get('/api/rooms', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const q = req.query || {};
    const activeOnly = String(q.active || '').toLowerCase() === 'true';
    const withStatus = String(q.with_status || '').toLowerCase() === 'true';
    const statusAt = q.status_at ? new Date(String(q.status_at)) : null;
    const nowRef = statusAt && !isNaN(statusAt.getTime()) ? statusAt : new Date();
    const params = [tenantCtx.id];
    let where = 'r.tenant_id = $1';
    if (activeOnly) where += ' AND r.active = true';
    let sql = `SELECT r.* FROM rooms r WHERE ${where} ORDER BY r.type, r.name`;
    if (withStatus) {
      params.push(nowRef); // $2
      params.push(nowRef); // $3
      sql = `SELECT r.*, EXISTS (
                SELECT 1 FROM room_bookings b
                 WHERE b.tenant_id = r.tenant_id
                   AND b.room_id = r.id
                   AND b.start_time < $2
                   AND b.end_time   > $3
              ) AS occupied
             FROM rooms r
            WHERE ${where}
            ORDER BY r.type, r.name`;
    }
    const { rows } = await tenantCtx.db.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Räume konnten nicht geladen werden' });
  }
});

// Create room
app.post('/api/rooms', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { name, type = 'BEHANDLUNG', active = true, floor = null, building = null, width = null, height = null, color = null } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name fehlt' });
    const t = String(type).toUpperCase();
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO rooms (tenant_id, name, type, active, floor, building, width, height, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenantCtx.id, String(name), t, Boolean(active), floor, building, width, height, color]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Raum konnte nicht erstellt werden' });
  }
});

// Update room
app.patch('/api/rooms/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
  const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
  if (req.body?.name !== undefined) set('name', String(req.body.name));
  if (req.body?.type !== undefined) set('type', String(req.body.type).toUpperCase());
  if (req.body?.active !== undefined) set('active', Boolean(req.body.active));
  if (req.body?.floor !== undefined) set('floor', req.body.floor || null);
  if (req.body?.building !== undefined) set('building', req.body.building || null);
  if (req.body?.width !== undefined) set('width', req.body.width != null ? Number(req.body.width) : null);
  if (req.body?.height !== undefined) set('height', req.body.height != null ? Number(req.body.height) : null);
  if (req.body?.color !== undefined) set('color', req.body.color || null);
  if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    const { rows } = await tenantCtx.db.query(
      `UPDATE rooms SET ${fields.join(', ')}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ message: 'Raum nicht gefunden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Raum konnte nicht aktualisiert werden' });
  }
});

// Deactivate room (soft delete)
app.delete('/api/rooms/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rows } = await tenantCtx.db.query(
      `UPDATE rooms SET active = false, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantCtx.id, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Raum nicht gefunden' });
    res.json({ ok: true, room: rows[0] });
  } catch (err) {
    res.status(400).json({ message: 'Raum konnte nicht deaktiviert werden' });
  }
});

// Room layout endpoints
app.get('/api/rooms/:id/layout', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rows } = await tenantCtx.db.query(
      `SELECT * FROM room_layout_objects WHERE tenant_id = $1 AND room_id = $2 ORDER BY COALESCE(z_index,0), id`,
      [tenantCtx.id, id]
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Layout konnte nicht geladen werden' });
  }
});

app.post('/api/rooms/:id/layout', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { type, x=0, y=0, width=1, height=1, rotation=0, z_index=null, properties=null } = req.body || {};
    if (!type) return res.status(400).json({ message: 'type fehlt' });
    const { rows: exists } = await tenantCtx.db.query(`SELECT 1 FROM rooms WHERE tenant_id = $1 AND id = $2 AND active = true`, [tenantCtx.id, id]);
    if (!exists.length) return res.status(404).json({ message: 'Raum nicht gefunden' });
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO room_layout_objects (tenant_id, room_id, type, x, y, width, height, rotation, z_index, properties)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'{}'::jsonb))
       RETURNING *`,
      [tenantCtx.id, id, String(type).toUpperCase(), Number(x), Number(y), Number(width), Number(height), Number(rotation), z_index != null ? Number(z_index) : null, properties]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Objekt konnte nicht erstellt werden' });
  }
});

app.put('/api/room-layout-objects/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const existing = await tenantCtx.db.query(`SELECT * FROM room_layout_objects WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Objekt nicht gefunden' });
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
    const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
    const body = req.body || {};
    if (body.type !== undefined) set('type', String(body.type).toUpperCase());
    if (body.x !== undefined) set('x', Number(body.x));
    if (body.y !== undefined) set('y', Number(body.y));
    if (body.width !== undefined) set('width', Number(body.width));
    if (body.height !== undefined) set('height', Number(body.height));
    if (body.rotation !== undefined) set('rotation', Number(body.rotation));
    if (body.z_index !== undefined) set('z_index', body.z_index != null ? Number(body.z_index) : null);
    if (body.properties !== undefined) set('properties', body.properties || {});
    if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    const { rows } = await tenantCtx.db.query(
      `UPDATE room_layout_objects SET ${fields.join(', ')}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Objekt konnte nicht aktualisiert werden' });
  }
});

app.delete('/api/room-layout-objects/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rowCount } = await tenantCtx.db.query(`DELETE FROM room_layout_objects WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!rowCount) return res.status(404).json({ message: 'Objekt nicht gefunden' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: 'Objekt konnte nicht gelöscht werden' });
  }
});

// List bookings per room window
app.get('/api/rooms/bookings', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const roomId = Number(req.query.roomId);
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to   = req.query.to ? new Date(String(req.query.to)) : null;
    if (!roomId || !from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: 'roomId, from, to erforderlich' });
    }
    const { rows } = await tenantCtx.db.query(
      `SELECT b.*, p.vorname, p.nachname
         FROM room_bookings b
         LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.room_id = $2
          AND b.start_time < $3 AND b.end_time > $4
        ORDER BY b.start_time ASC`,
      [tenantCtx.id, roomId, to, from]
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Belegungen konnten nicht geladen werden' });
  }
});

function hasOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Create booking with simple overlap check within same room
app.post('/api/rooms/bookings', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { room_id, start_time, end_time, patient_id, appointment_id, note, doctor_id, staff_ids, procedure_type, status, color, ignore_doctor_conflicts } = req.body || {};
    const rid = Number(room_id);
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (!rid || !start_time || !end_time || isNaN(start.getTime()) || isNaN(end.getTime()) || !(end > start)) {
      return res.status(400).json({ message: 'Ungültige Zeit oder room_id' });
    }
    const r = await tenantCtx.db.query(`SELECT id, name FROM rooms WHERE tenant_id = $1 AND id = $2 AND active = true`, [tenantCtx.id, rid]);
    if (!r.rowCount) return res.status(404).json({ message: 'Raum nicht gefunden' });
    const roomName = r.rows[0].name;
    // overlap check within room
    const { rows: ov } = await tenantCtx.db.query(
      `SELECT id FROM room_bookings
         WHERE tenant_id = $1 AND room_id = $2 AND start_time < $3 AND end_time > $4
         LIMIT 1`,
      [tenantCtx.id, rid, end, start]
    );
    if (ov.length) return res.status(409).json({ message: 'Zeitraum ist bereits belegt' });
    // optional doctor conflict
    const docId = doctor_id ? Number(doctor_id) : (req.user?.id || null);
    if (docId) {
      const dconf = await tenantCtx.db.query(
        `SELECT id FROM room_bookings WHERE tenant_id = $1 AND doctor_id = $2 AND start_time < $3 AND end_time > $4 LIMIT 1`,
        [tenantCtx.id, Number(docId), end, start]
      );
      if (dconf.rows.length && String(ignore_doctor_conflicts || '').toLowerCase() !== 'true') {
        return res.status(409).json({ message: 'Der ausgewählte Arzt ist im Zeitraum bereits verplant', code: 'doctor_conflict' });
      }
    }
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO room_bookings (
         tenant_id, room_id, start_time, end_time, patient_id, appointment_id, note,
         doctor_id, staff_ids, procedure_type, status, color
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'GEPLANT'),$12
       )
       RETURNING *`,
      [tenantCtx.id, rid, start, end, patient_id ? Number(patient_id) : null, appointment_id ? Number(appointment_id) : null, note || null,
       docId ? Number(docId) : null, Array.isArray(staff_ids) && staff_ids.length ? staff_ids.map(Number) : null,
       procedure_type || null, status || null, color || null]
    );
    const created = rows[0];
    // Notify doctor/staff via internal task(s)
    try {
      const title = `Raum-Buchung: ${roomName}`;
      const desc = `Zeitraum: ${start.toLocaleString('de-CH')} – ${end.toLocaleString('de-CH')}`;
      if (created.doctor_id) {
        await tasksService.createTask(tenantCtx, {
          title, description: desc, type: 'ROOM_BOOKING', priority: 'NORMAL',
          assigned_to_user_id: created.doctor_id, due_date: created.start_time, patient_id: created.patient_id,
          related_appointment_id: created.appointment_id, tags: ['ROOM','BOOKING']
        }, req.user?.id || null);
      }
      if (Array.isArray(created.staff_ids)) {
        for (const sid of created.staff_ids) {
          try {
            await tasksService.createTask(tenantCtx, {
              title, description: desc, type: 'ROOM_BOOKING', priority: 'LOW',
              assigned_to_user_id: Number(sid), due_date: created.start_time, patient_id: created.patient_id,
              related_appointment_id: created.appointment_id, tags: ['ROOM','BOOKING','STAFF']
            }, req.user?.id || null);
          } catch (_) {}
        }
      }
    } catch (_) {}
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht erstellt werden' });
  }
});

// Update booking
app.patch('/api/rooms/bookings/:id', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const existingRes = await tenantCtx.db.query(`SELECT * FROM room_bookings WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!existingRes.rowCount) return res.status(404).json({ message: 'Buchung nicht gefunden' });
    const existing = existingRes.rows[0];
    const start = req.body?.start_time ? new Date(req.body.start_time) : new Date(existing.start_time);
    const end = req.body?.end_time ? new Date(req.body.end_time) : new Date(existing.end_time);
    if (!(end > start)) return res.status(400).json({ message: 'Ungültiger Zeitraum' });
    // overlap check
    const { rows: ov } = await tenantCtx.db.query(
      `SELECT id FROM room_bookings
        WHERE tenant_id = $1 AND room_id = $2 AND id <> $3
          AND start_time < $4 AND end_time > $5
        LIMIT 1`,
      [tenantCtx.id, Number(existing.room_id), id, end, start]
    );
    if (ov.length) return res.status(409).json({ message: 'Zeitraum ist bereits belegt' });
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
    const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
    if (req.body?.start_time !== undefined) set('start_time', start);
    if (req.body?.end_time !== undefined) set('end_time', end);
    if (req.body?.patient_id !== undefined) set('patient_id', req.body.patient_id ? Number(req.body.patient_id) : null);
    if (req.body?.appointment_id !== undefined) set('appointment_id', req.body.appointment_id ? Number(req.body.appointment_id) : null);
    if (req.body?.note !== undefined) set('note', req.body.note || null);
    if (req.body?.doctor_id !== undefined) set('doctor_id', req.body.doctor_id ? Number(req.body.doctor_id) : null);
    if (req.body?.staff_ids !== undefined) set('staff_ids', Array.isArray(req.body.staff_ids) ? req.body.staff_ids.map(Number) : null);
    if (req.body?.procedure_type !== undefined) set('procedure_type', req.body.procedure_type || null);
    if (req.body?.status !== undefined) set('status', req.body.status || 'GEPLANT');
    if (req.body?.color !== undefined) set('color', req.body.color || null);
    if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    const { rows } = await tenantCtx.db.query(
      `UPDATE room_bookings SET ${fields.join(', ')}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      params
    );
    const updated = rows[0];
    // Notify doctor/staff via internal task(s)
    try {
      const rres = await tenantCtx.db.query(`SELECT name FROM rooms WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, Number(updated.room_id)]);
      const roomName = rres.rows[0]?.name || `#${updated.room_id}`;
      const title = `Buchung aktualisiert: ${roomName}`;
      const desc = `Neuer Zeitraum: ${new Date(updated.start_time).toLocaleString('de-CH')} – ${new Date(updated.end_time).toLocaleString('de-CH')}`;
      if (updated.doctor_id) {
        await tasksService.createTask(tenantCtx, {
          title, description: desc, type: 'ROOM_BOOKING_UPDATE', priority: 'NORMAL',
          assigned_to_user_id: updated.doctor_id, due_date: updated.start_time, patient_id: updated.patient_id,
          related_appointment_id: updated.appointment_id, tags: ['ROOM','BOOKING','UPDATE']
        }, req.user?.id || null);
      }
      if (Array.isArray(updated.staff_ids)) {
        for (const sid of updated.staff_ids) {
          try {
            await tasksService.createTask(tenantCtx, {
              title, description: desc, type: 'ROOM_BOOKING_UPDATE', priority: 'LOW',
              assigned_to_user_id: Number(sid), due_date: updated.start_time, patient_id: updated.patient_id,
              related_appointment_id: updated.appointment_id, tags: ['ROOM','BOOKING','UPDATE','STAFF']
            }, req.user?.id || null);
          } catch (_) {}
        }
      }
    } catch (_) {}
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht aktualisiert werden' });
  }
});

// Delete booking
app.delete('/api/rooms/bookings/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rowCount } = await tenantCtx.db.query(`DELETE FROM room_bookings WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!rowCount) return res.status(404).json({ message: 'Buchung nicht gefunden' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht gelöscht werden' });
  }
});

// Aliased unified bookings endpoints
app.get('/api/bookings', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const roomId = req.query.roomId ? Number(req.query.roomId) : null;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to   = req.query.to ? new Date(String(req.query.to)) : null;
    const doctorIdParam = req.query.doctorId || req.query.doctor_id || null;
    const staffIdParam = req.query.staffId || req.query.staff_id || null;
    const me = String(doctorIdParam || '').toLowerCase() === 'me';
    const doctorId = me ? (req.user?.id || null) : (doctorIdParam != null ? Number(doctorIdParam) : null);
    const staffId = (String(staffIdParam || '').toLowerCase() === 'me') ? (req.user?.id || null) : (staffIdParam != null ? Number(staffIdParam) : null);
    if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: 'from und to erforderlich' });
    }
    const params = [tenantCtx.id, to, from];
    let where = 'b.tenant_id = $1 AND b.start_time < $2 AND b.end_time > $3';
    if (roomId) { params.push(roomId); where += ` AND b.room_id = $${params.length}`; }
    if (doctorId) { params.push(Number(doctorId)); where += ` AND b.doctor_id = $${params.length}`; }
    if (staffId) { params.push(Number(staffId)); where += ` AND $${params.length} = ANY(b.staff_ids)`; }
    const { rows } = await tenantCtx.db.query(
      `SELECT b.*, p.vorname, p.nachname
         FROM room_bookings b
         LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
        WHERE ${where}
        ORDER BY b.start_time ASC`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Buchungen konnten nicht geladen werden' });
  }
});

app.post('/api/bookings', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { room_id, start_time, end_time, patient_id, appointment_id, note, doctor_id, staff_ids, procedure_type, status, color, ignore_doctor_conflicts } = req.body || {};
    const rid = Number(room_id);
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (!rid || !start_time || !end_time || isNaN(start.getTime()) || isNaN(end.getTime()) || !(end > start)) {
      return res.status(400).json({ message: 'Ungültige Zeit oder room_id' });
    }
    const r = await tenantCtx.db.query(`SELECT id, name FROM rooms WHERE tenant_id = $1 AND id = $2 AND active = true`, [tenantCtx.id, rid]);
    if (!r.rowCount) return res.status(404).json({ message: 'Raum nicht gefunden' });
    const roomName = r.rows[0].name;
    const { rows: ov } = await tenantCtx.db.query(
      `SELECT id FROM room_bookings WHERE tenant_id = $1 AND room_id = $2 AND start_time < $3 AND end_time > $4 LIMIT 1`,
      [tenantCtx.id, rid, end, start]
    );
    if (ov.length) return res.status(409).json({ message: 'Zeitraum ist bereits belegt' });
    const docId = doctor_id ? Number(doctor_id) : (req.user?.id || null);
    if (docId) {
      const dconf = await tenantCtx.db.query(
        `SELECT id FROM room_bookings WHERE tenant_id = $1 AND doctor_id = $2 AND start_time < $3 AND end_time > $4 LIMIT 1`,
        [tenantCtx.id, Number(docId), end, start]
      );
      if (dconf.rows.length && String(ignore_doctor_conflicts || '').toLowerCase() !== 'true') {
        return res.status(409).json({ message: 'Der ausgewählte Arzt ist im Zeitraum bereits verplant', code: 'doctor_conflict' });
      }
    }
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO room_bookings (
         tenant_id, room_id, start_time, end_time, patient_id, appointment_id, note,
         doctor_id, staff_ids, procedure_type, status, color
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,'GEPLANT'),$12
       ) RETURNING *`,
      [tenantCtx.id, rid, start, end, patient_id ? Number(patient_id) : null, appointment_id ? Number(appointment_id) : null, note || null,
       docId ? Number(docId) : null, Array.isArray(staff_ids) && staff_ids.length ? staff_ids.map(Number) : null,
       procedure_type || null, status || null, color || null]
    );
    const created = rows[0];
    try {
      const title = `Raum-Buchung: ${roomName}`;
      const desc = `Zeitraum: ${start.toLocaleString('de-CH')} – ${end.toLocaleString('de-CH')}`;
      if (created.doctor_id) {
        await tasksService.createTask(tenantCtx, { title, description: desc, type: 'ROOM_BOOKING', priority: 'NORMAL', assigned_to_user_id: created.doctor_id, due_date: created.start_time, patient_id: created.patient_id, related_appointment_id: created.appointment_id, tags: ['ROOM','BOOKING'] }, req.user?.id || null);
      }
      if (Array.isArray(created.staff_ids)) {
        for (const sid of created.staff_ids) {
          try { await tasksService.createTask(tenantCtx, { title, description: desc, type: 'ROOM_BOOKING', priority: 'LOW', assigned_to_user_id: Number(sid), due_date: created.start_time, patient_id: created.patient_id, related_appointment_id: created.appointment_id, tags: ['ROOM','BOOKING','STAFF'] }, req.user?.id || null); } catch (_) {}
        }
      }
    } catch (_) {}
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht erstellt werden' });
  }
});

app.put('/api/bookings/:id', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const existingRes = await tenantCtx.db.query(`SELECT * FROM room_bookings WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!existingRes.rowCount) return res.status(404).json({ message: 'Buchung nicht gefunden' });
    const existing = existingRes.rows[0];
    const start = req.body?.start_time ? new Date(req.body.start_time) : new Date(existing.start_time);
    const end = req.body?.end_time ? new Date(req.body.end_time) : new Date(existing.end_time);
    if (!(end > start)) return res.status(400).json({ message: 'Ungültiger Zeitraum' });
    const { rows: ov } = await tenantCtx.db.query(
      `SELECT id FROM room_bookings WHERE tenant_id = $1 AND room_id = $2 AND id <> $3 AND start_time < $4 AND end_time > $5 LIMIT 1`,
      [tenantCtx.id, Number(existing.room_id), id, end, start]
    );
    if (ov.length) return res.status(409).json({ message: 'Zeitraum ist bereits belegt' });
    const nextDoctorId = req.body?.doctor_id != null ? (req.body.doctor_id ? Number(req.body.doctor_id) : null) : (existing.doctor_id || null);
    if (nextDoctorId) {
      const ignoreDoc = String(req.body?.ignore_doctor_conflicts || '').toLowerCase() === 'true';
      const dconf = await tenantCtx.db.query(
        `SELECT id FROM room_bookings WHERE tenant_id = $1 AND doctor_id = $2 AND id <> $3 AND start_time < $4 AND end_time > $5 LIMIT 1`,
        [tenantCtx.id, Number(nextDoctorId), id, end, start]
      );
      if (dconf.rows.length && !ignoreDoc) {
        return res.status(409).json({ message: 'Der ausgewählte Arzt ist im Zeitraum bereits verplant', code: 'doctor_conflict' });
      }
    }
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
    const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
    if (req.body?.start_time !== undefined) set('start_time', start);
    if (req.body?.end_time !== undefined) set('end_time', end);
    if (req.body?.patient_id !== undefined) set('patient_id', req.body.patient_id ? Number(req.body.patient_id) : null);
    if (req.body?.appointment_id !== undefined) set('appointment_id', req.body.appointment_id ? Number(req.body.appointment_id) : null);
    if (req.body?.note !== undefined) set('note', req.body.note || null);
    if (req.body?.doctor_id !== undefined) set('doctor_id', req.body.doctor_id ? Number(req.body.doctor_id) : null);
    if (req.body?.staff_ids !== undefined) set('staff_ids', Array.isArray(req.body.staff_ids) ? req.body.staff_ids.map(Number) : null);
    if (req.body?.procedure_type !== undefined) set('procedure_type', req.body.procedure_type || null);
    if (req.body?.status !== undefined) set('status', req.body.status || 'GEPLANT');
    if (req.body?.color !== undefined) set('color', req.body.color || null);
    if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    const { rows } = await tenantCtx.db.query(
      `UPDATE room_bookings SET ${fields.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht aktualisiert werden' });
  }
});

app.delete('/api/bookings/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rowCount } = await tenantCtx.db.query(`DELETE FROM room_bookings WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!rowCount) return res.status(404).json({ message: 'Buchung nicht gefunden' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: 'Buchung konnte nicht gelöscht werden' });
  }
});

// ====== Inventory (tenant-aware) ======
function likeSearch(s) { return `%${String(s || '').toLowerCase()}%`; }

// List items (optional search and lowStockOnly)
app.get('/api/inventory/items', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const q = req.query || {};
    const params = [tenantCtx.id];
    let where = 'tenant_id = $1';
    if (q.search) { params.push(likeSearch(q.search)); where += ` AND lower(name) LIKE $${params.length}`; }
    if (String(q.lowStockOnly || '').toLowerCase() === 'true') {
      where += ' AND current_stock < min_stock';
    }
    const { rows } = await tenantCtx.db.query(
      `SELECT * FROM inventory_items WHERE ${where} ORDER BY (current_stock < min_stock) DESC, lower(name)`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Inventar konnte nicht geladen werden' });
  }
});

// Create item
app.post('/api/inventory/items', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { name, category, min_stock = 0, current_stock = 0, unit } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name fehlt' });
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO inventory_items (tenant_id, name, category, min_stock, current_stock, unit, last_updated_by)
       VALUES ($1,$2,$3, GREATEST(0,$4), GREATEST(0,$5), $6, $7)
       RETURNING *`,
      [tenantCtx.id, String(name), category || null, Number(min_stock) || 0, Number(current_stock) || 0, unit || null, Number(req.user?.id) || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Item konnte nicht erstellt werden' });
  }
});

// Update item meta
app.patch('/api/inventory/items/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const existing = await tenantCtx.db.query(`SELECT * FROM inventory_items WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!existing.rowCount) return res.status(404).json({ message: 'Item nicht gefunden' });
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
    const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
    if (req.body?.name !== undefined) set('name', String(req.body.name));
    if (req.body?.category !== undefined) set('category', req.body.category || null);
    if (req.body?.min_stock !== undefined) set('min_stock', Math.max(0, Number(req.body.min_stock) || 0));
    if (req.body?.unit !== undefined) set('unit', req.body.unit || null);
    if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    set('last_updated_by', Number(req.user?.id) || null);
    set('last_updated_at', new Date());
    const { rows } = await tenantCtx.db.query(
      `UPDATE inventory_items SET ${fields.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'Item konnte nicht aktualisiert werden' });
  }
});

async function ensureLowStockTask(tenantCtx, item) {
  try {
    if (item.current_stock >= item.min_stock) return;
    const dup = await tenantCtx.db.query(
      `SELECT 1 FROM tasks
        WHERE tenant_id = $1
          AND type = 'INVENTORY'
          AND status IN ('OPEN','IN_PROGRESS')
          AND lower(title) LIKE $2
        LIMIT 1`,
      [tenantCtx.id, `%${String(item.name||'').toLowerCase()}%`]
    );
    if (dup.rowCount) return;
    await tasksService.createTask(tenantCtx, {
      title: `Bestellung für Item ${item.name} auslösen` ,
      description: `Aktueller Bestand ${item.current_stock} ${item.unit||''} unter Mindestbestand ${item.min_stock}.`,
      type: 'INVENTORY',
      priority: 'HIGH',
      tags: ['INVENTORY','AUTO']
    }, null);
  } catch (_) {}
}

// Adjust stock with transaction log and auto-task on low stock
app.post('/api/inventory/items/:id/adjust', authenticateToken, requireRole('admin','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const delta = Number(req.body?.delta);
    const reason = req.body?.reason || null;
    if (!Number.isFinite(delta)) return res.status(400).json({ message: 'delta fehlt/ungültig' });
    const { rows: updatedRows } = await tenantCtx.db.query(
      `UPDATE inventory_items
          SET current_stock = GREATEST(0, current_stock + $3),
              last_updated_by = $4,
              last_updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      [tenantCtx.id, id, delta, Number(req.user?.id) || null]
    );
    if (!updatedRows.length) return res.status(404).json({ message: 'Item nicht gefunden' });
    const item = updatedRows[0];
    await tenantCtx.db.query(
      `INSERT INTO inventory_transactions (tenant_id, item_id, change_amount, reason, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantCtx.id, id, delta, reason, Number(req.user?.id) || null]
    );
    await ensureLowStockTask(tenantCtx, item);
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: 'Bestand konnte nicht angepasst werden' });
  }
});

// List transactions for item
app.get('/api/inventory/items/:id/transactions', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rows } = await tenantCtx.db.query(
      `SELECT * FROM inventory_transactions WHERE tenant_id = $1 AND item_id = $2 ORDER BY created_at DESC, id DESC`,
      [tenantCtx.id, id]
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'Transaktionen konnten nicht geladen werden' });
  }
});

// ====== SOPs (tenant-aware, admin/doctor modify) ======
app.get('/api/sops', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const q = req.query || {};
    const params = [tenantCtx.id];
    let where = 'tenant_id = $1';
    if (q.search) { params.push(`%${String(q.search).toLowerCase()}%`); where += ` AND lower(title) LIKE $${params.length}`; }
    const { rows } = await tenantCtx.db.query(`SELECT * FROM sops WHERE ${where} ORDER BY locked DESC, updated_at DESC` , params);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ message: 'SOPs konnten nicht geladen werden' });
  }
});

// ====== Chat (tenant-aware) ======
app.get('/api/chat/channels', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const uid = Number(req.user?.id);
    // Only return DM channels where user is a member, plus all non-DM channels
    const { rows } = await t.db.query(
      `SELECT c.*
         FROM chat_channels c
         LEFT JOIN chat_channel_members m
           ON m.channel_id = c.id AND m.tenant_id = c.tenant_id AND m.user_id = $2
        WHERE c.tenant_id = $1
          AND (c.type <> 'DM' OR m.user_id IS NOT NULL)
        ORDER BY c.type, c.name`,
      [t.id, uid]
    );

    // Ensure a GLOBAL default exists (once per tenant)
    if (!rows.length) {
      const existing = await t.db.query(`SELECT 1 FROM chat_channels WHERE tenant_id = $1 AND type = 'GLOBAL' AND name = 'Allgemein' LIMIT 1`, [t.id]);
      if (!existing.rowCount) {
        try { await t.db.query(`INSERT INTO chat_channels (tenant_id, name, type) VALUES ($1,$2,'GLOBAL')`, [t.id, 'Allgemein']); } catch (_) {}
      }
      const re = await t.db.query(
        `SELECT c.*
           FROM chat_channels c
           LEFT JOIN chat_channel_members m
             ON m.channel_id = c.id AND m.tenant_id = c.tenant_id AND m.user_id = $2
          WHERE c.tenant_id = $1
            AND (c.type <> 'DM' OR m.user_id IS NOT NULL)
          ORDER BY c.type, c.name`,
        [t.id, uid]
      );
      return res.json({ items: re.rows });
    }

    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ message: 'Kanäle konnten nicht geladen werden' });
  }
});

app.post('/api/chat/channels', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const { name, type = 'GLOBAL', related_patient_id, related_task_id } = req.body || {};
    if (!name) return res.status(400).json({ message: 'name fehlt' });
    const { rows } = await t.db.query(
      `INSERT INTO chat_channels (tenant_id, name, type, related_patient_id, related_task_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [t.id, String(name), String(type).toUpperCase(), related_patient_id ? Number(related_patient_id) : null, related_task_id ? Number(related_task_id) : null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ message: 'Kanal konnte nicht erstellt werden' });
  }
});

app.get('/api/chat/messages', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const channelId = Number(req.query.channelId);
    let limit = Number(req.query.limit || 100);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    limit = Math.min(limit, 500);
    if (!channelId) return res.json({ items: [] });
    const { rows } = await t.db.query(
      `SELECT m.*, u.name AS author_name
         FROM chat_messages m
         LEFT JOIN users u ON u.id = m.author_user_id AND u.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.channel_id = $2
        ORDER BY m.created_at DESC
        LIMIT ${limit}`,
      [t.id, channelId]
    );
    res.json({ items: rows.reverse() });
  } catch (e) {
    res.status(500).json({ message: 'Nachrichten konnten nicht geladen werden' });
  }
});

function parseMentions(text='') {
  const m = new Set();
  const re = /@([A-Za-z0-9_.-]{2,32})/g;
  let match;
  while ((match = re.exec(String(text))) !== null) m.add(match[1].toLowerCase());
  return Array.from(m);
}

app.post('/api/chat/messages', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const { channel_id, content } = req.body || {};
    if (!channel_id || !content) return res.status(400).json({ message: 'channel_id oder content fehlt' });
    const { rows } = await t.db.query(
      `INSERT INTO chat_messages (tenant_id, channel_id, author_user_id, content)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [t.id, Number(channel_id), Number(req.user?.id) || null, String(content)]
    );
    const msg = rows[0];
    // Grundsätzlich: alle Empfänger (außer Sender) bekommen einen offenen "unread"-Eintrag
    try {
      const uid = Number(req.user?.id);
      // Bevorzugt Kanal-Mitglieder, sonst alle aktiven Benutzer im Tenant
      let recipients = [];
      const membersRes = await t.db.query(
        `SELECT user_id FROM chat_channel_members WHERE tenant_id = $1 AND channel_id = $2`,
        [t.id, Number(channel_id)]
      );
      if (membersRes.rowCount) {
        recipients = membersRes.rows.map(r => Number(r.user_id));
      } else {
        const usersRes = await t.db.query(
          `SELECT id FROM users WHERE tenant_id = $1`,
          [t.id]
        );
        recipients = usersRes.rows.map(r => Number(r.id));
      }
      for (const rid of recipients) {
        if (!rid || rid === uid) continue;
        await t.db.query(
          `INSERT INTO chat_message_reads (message_id, user_id, tenant_id)
           VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [msg.id, rid, t.id]
        );
      }
    } catch (_) {}

    // Mentions → zusätzlich unread-Einträge (z. B. für GLOBAL‑Kanäle ohne explizite Mitglieder)
    try {
      const names = parseMentions(content);
      if (names.length) {
        const { rows: users } = await t.db.query(`SELECT id, username, email FROM users WHERE tenant_id = $1 AND (lower(username) = ANY($2) OR lower(email) = ANY($2))`, [t.id, names]);
        let allowed = users;
        const { rows: members } = await t.db.query(`SELECT user_id FROM chat_channel_members WHERE tenant_id = $1 AND channel_id = $2`, [t.id, Number(channel_id)]);
        if (members.length) {
          const set = new Set(members.map(m => Number(m.user_id)));
          allowed = users.filter(u => set.has(Number(u.id)));
        }
        for (const u of allowed) {
          if (Number(u.id) === Number(req.user?.id)) continue;
          await t.db.query(`INSERT INTO chat_message_reads (message_id, user_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [msg.id, u.id, t.id]);
        }
      }
    } catch (_) {}
    res.status(201).json(msg);
  } catch (e) {
    res.status(400).json({ message: 'Nachricht konnte nicht gesendet werden' });
  }
});

app.post('/api/chat/messages/:id/read', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    await t.db.query(
      `INSERT INTO chat_message_reads (message_id, user_id, tenant_id, read_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()`,
      [id, Number(req.user?.id), t.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: 'Nachricht konnte nicht als gelesen markiert werden' });
  }
});

app.get('/api/chat/unreadCount', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const channelId = req.query?.channelId ? Number(req.query.channelId) : null;
    let sql = `SELECT COUNT(1) AS cnt
                 FROM chat_message_reads r
                 JOIN chat_messages m ON m.id = r.message_id
                WHERE r.tenant_id = $1 AND r.user_id = $2 AND r.read_at IS NULL`;
    const params = [t.id, Number(req.user?.id)];
    if (channelId) { sql += ` AND m.channel_id = $3`; params.push(channelId); }
    const { rows } = await t.db.query(sql, params);
    res.json({ count: Number(rows[0]?.cnt || 0) });
  } catch (e) {
    res.status(500).json({ message: 'Unread Count nicht möglich' });
  }
});

// Ephemeral typing indicators (in-memory per process)
const chatTypingStore = new Map(); // key: `${tenantId}:${channelId}` -> Map(userId -> expiresMs)
function cleanupTyping() {
  const now = Date.now();
  for (const [key, map] of chatTypingStore.entries()) {
    for (const [uid, until] of map.entries()) {
      if (until <= now) map.delete(uid);
    }
    if (!map.size) chatTypingStore.delete(key);
  }
}
setInterval(cleanupTyping, 5000).unref();

app.post('/api/chat/typing', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const channelId = Number(req.body?.channel_id);
    if (!channelId) return res.status(400).json({ message: 'channel_id fehlt' });
    const key = `${t.id}:${channelId}`;
    const map = chatTypingStore.get(key) || new Map();
    map.set(Number(req.user?.id), Date.now() + 8000);
    chatTypingStore.set(key, map);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: 'typing nicht möglich' });
  }
});

app.get('/api/chat/typing', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const channelId = Number(req.query?.channelId);
    if (!channelId) return res.json({ users: [] });
    cleanupTyping();
    const key = `${t.id}:${channelId}`;
    const map = chatTypingStore.get(key) || new Map();
    const ids = Array.from(map.keys());
    if (!ids.length) return res.json({ users: [] });
    const { rows } = await t.db.query(`SELECT id, name, username, email FROM users WHERE tenant_id = $1 AND id = ANY($2)`, [t.id, ids]);
    const users = rows.map(u => ({ id: u.id, name: u.name || u.username || u.email || `User ${u.id}` }));
    res.json({ users });
  } catch (e) {
    res.status(500).json({ users: [] });
  }
});

// Direct Messages (DM)
app.post('/api/chat/dm/start', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const uid = Number(req.user?.id);
    const other = Number(req.body?.user_id);
    if (!other || other === uid) return res.status(400).json({ message: 'Ungültiger Zielnutzer' });
    const found = await t.db.query(
      `SELECT c.id
         FROM chat_channels c
         JOIN chat_channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $2 AND m1.tenant_id = c.tenant_id
         JOIN chat_channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $3 AND m2.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.type = 'DM'
        GROUP BY c.id
        HAVING COUNT(*) = 2`,
      [t.id, uid, other]
    );
    let channelId = found.rows[0]?.id;
    if (!channelId) {
      const name = `DM:${Math.min(uid, other)}-${Math.max(uid, other)}`;
      const ins = await t.db.query(`INSERT INTO chat_channels (tenant_id, name, type) VALUES ($1,$2,'DM') RETURNING id`, [t.id, name]);
      channelId = ins.rows[0].id;
      await t.db.query(`INSERT INTO chat_channel_members (tenant_id, channel_id, user_id) VALUES ($1,$2,$3),($1,$2,$4) ON CONFLICT DO NOTHING`, [t.id, channelId, uid, other]);
    }
    res.json({ channel_id: channelId });
  } catch (e) {
    res.status(400).json({ message: 'DM konnte nicht gestartet werden' });
  }
});

app.get('/api/chat/dm/list', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const uid = Number(req.user?.id);
    const { rows } = await t.db.query(
      `SELECT c.id AS channel_id, u.id AS other_user_id, COALESCE(u.name, u.username, u.email) AS other_name
         FROM chat_channels c
         JOIN chat_channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $2 AND m1.tenant_id = c.tenant_id
         JOIN chat_channel_members m2 ON m2.channel_id = c.id AND m2.user_id <> $2 AND m2.tenant_id = c.tenant_id
         JOIN users u ON u.id = m2.user_id AND u.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.type = 'DM'
        ORDER BY c.id DESC`,
      [t.id, uid]
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ message: 'DM‑Liste nicht verfügbar' });
  }
});

// ====== Patient Communication Log ======
app.get('/api/patients/:id/communication', authenticateToken, requirePermission('patients.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant', 'billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const pid = Number(req.params.id);
    const { rows } = await t.db.query(
      `SELECT c.*, u.name AS author_name
         FROM patient_communication_log c
         LEFT JOIN users u ON u.id = c.created_by_user_id AND u.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.patient_id = $2
        ORDER BY c.created_at DESC, c.id DESC`,
      [t.id, pid]
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ message: 'Kommunikationslog konnte nicht geladen werden' });
  }
});

// ====== Tenant Dashboard Summary ======
app.get('/api/dashboard/tenantSummary', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30*24*60*60*1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const params = [t.id, from, to];

    const appts = await t.db.query(`SELECT COUNT(1) AS c FROM appointments WHERE tenant_id = $1 AND starts_at >= $2 AND starts_at < $3`, params);
    const patients = await t.db.query(`SELECT COUNT(1) AS c FROM patients WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`, params);
    const tasksByType = await t.db.query(`SELECT COALESCE(type,'OTHER') AS type, COUNT(1) AS c FROM tasks WHERE tenant_id = $1 AND status IN ('OPEN','IN_PROGRESS') GROUP BY COALESCE(type,'OTHER') ORDER BY 2 DESC`, [t.id]);
    const overdueTasks = await t.db.query(`SELECT COUNT(1) AS c FROM tasks WHERE tenant_id = $1 AND status IN ('OPEN','IN_PROGRESS') AND due_date IS NOT NULL AND due_date < now()`, [t.id]);

    res.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      consultations: Number(appts.rows[0]?.c || 0),
      newPatients: Number(patients.rows[0]?.c || 0),
      tasksByType: tasksByType.rows.map(r => ({ type: r.type, count: Number(r.c||0) })),
      overdueTasks: Number(overdueTasks.rows[0]?.c || 0)
    });
  } catch (e) {
    res.status(500).json({ message: 'Dashboard konnte nicht berechnet werden' });
  }
});

// ====== Personal Dashboard & Favorites ======
app.get('/api/me/dashboard', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const { rows } = await t.db.query(`SELECT widgets FROM user_dashboard_config WHERE tenant_id = $1 AND user_id = $2`, [t.id, Number(req.user?.id)]);
    res.json({ widgets: rows[0]?.widgets || [] });
  } catch (e) {
    res.status(500).json({ message: 'Dashboard konnte nicht geladen werden' });
  }
});

// ====== Workflow Definitions API ======
app.get('/api/workflows', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try { const t = await ensureRequestTenant(req); const { rows } = await t.db.query(`SELECT * FROM workflow_definitions WHERE tenant_id = $1 ORDER BY updated_at DESC`, [t.id]); res.json({ items: rows }); } catch (e) { res.status(500).json({ message: 'Workflows konnten nicht geladen werden' }); }
});
app.post('/api/workflows', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try { const t = await ensureRequestTenant(req); const { name, description, triggerType, isActive = true, definitionJson = [] } = req.body || {}; if (!name || !triggerType) return res.status(400).json({ message: 'name/triggerType fehlt' }); const { rows } = await t.db.query(`INSERT INTO workflow_definitions (tenant_id, name, description, trigger_type, is_active, definition_json) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [t.id, name, description||null, String(triggerType).toUpperCase(), Boolean(isActive), definitionJson]); res.status(201).json(rows[0]); } catch (e) { res.status(400).json({ message: 'Workflow konnte nicht erstellt werden' }); }
});
app.patch('/api/workflows/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try { const t = await ensureRequestTenant(req); const id = Number(req.params.id); const fields = []; const params=[t.id,id]; let i=params.length; const set=(c,v)=>{fields.push(`${c}=$${++i}`); params.push(v);}; if (req.body?.name!==undefined) set('name', req.body.name); if (req.body?.description!==undefined) set('description', req.body.description||null); if (req.body?.triggerType!==undefined) set('trigger_type', String(req.body.triggerType).toUpperCase()); if (req.body?.isActive!==undefined) set('is_active', Boolean(req.body.isActive)); if (req.body?.definitionJson!==undefined) set('definition_json', req.body.definitionJson||[]); if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' }); const { rows } = await t.db.query(`UPDATE workflow_definitions SET ${fields.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`, params); res.json(rows[0]); } catch (e) { res.status(400).json({ message: 'Workflow konnte nicht aktualisiert werden' }); }
});

// ====== Patient Timeline ======
app.get('/api/patients/:id/timeline', authenticateToken, requirePermission('patients.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant', 'billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const pid = Number(req.params.id);
    const items = [];
    // Appointments
    try {
      const { rows } = await t.db.query(`SELECT id, starts_at, reason FROM appointments WHERE tenant_id = $1 AND patient_id = $2 ORDER BY starts_at ASC`, [t.id, pid]);
      for (const r of rows) items.push({ type: 'APPOINTMENT', date: r.starts_at, text: r.reason || 'Termin', ref: { id: r.id } });
    } catch {}
    // Tasks (mit deutschen Statusbezeichnungen in der Ausgabe)
    try {
      const { rows } = await t.db.query(`SELECT id, created_at, title, status FROM tasks WHERE tenant_id = $1 AND patient_id = $2 ORDER BY created_at ASC`, [t.id, pid]);
      const label = (s) => {
        switch (String(s).toUpperCase()) {
          case 'OPEN': return 'Offen';
          case 'IN_PROGRESS': return 'In Bearbeitung';
          case 'DONE': return 'Erledigt';
          case 'ARCHIVED': return 'Archiviert';
          default: return String(s);
        }
      };
      for (const r of rows) items.push({ type: 'TASK', date: r.created_at, text: `${r.title} [${label(r.status)}]`, ref: { id: r.id } });
    } catch {}
    // Notes (PATIENT)
    try {
      const { rows } = await t.db.query(`SELECT id, created_at, title FROM notes WHERE tenant_id = $1 AND patient_id = $2 AND visibility_type = 'PATIENT' ORDER BY created_at ASC`, [t.id, pid]);
      for (const r of rows) items.push({ type: 'NOTE', date: r.created_at, text: r.title || 'Notiz', ref: { id: r.id } });
    } catch {}
    // Communication
    try {
      const { rows } = await t.db.query(`SELECT id, created_at, type, direction, summary FROM patient_communication_log WHERE tenant_id = $1 AND patient_id = $2 ORDER BY created_at ASC`, [t.id, pid]);
      for (const r of rows) items.push({ type: 'COMM', date: r.created_at, text: `${r.type}/${r.direction}: ${r.summary || ''}`, ref: { id: r.id } });
    } catch {}
    // Waiting room status (nur wenn FERTIG, damit der Ablauf sichtbar wird)
    try {
      const { rows } = await t.db.query(
        `SELECT status, last_change_at
           FROM waiting_room_status
          WHERE tenant_id = $1 AND patient_id = $2
          LIMIT 1`,
        [t.id, pid]
      );
      if (rows.length && rows[0].status === 'FERTIG') {
        items.push({
          type: 'TASK',
          date: rows[0].last_change_at,
          text: 'Wartezimmer abgeschlossen (Status: FERTIG)',
          ref: { status: rows[0].status }
        });
      }
    } catch {}
    items.sort((a,b) => new Date(a.date) - new Date(b.date));
    res.json({ items });
  } catch (e) {
    res.status(500).json({ message: 'Timeline konnte nicht geladen werden' });
  }
});

app.patch('/api/me/dashboard', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const widgets = Array.isArray(req.body?.widgets) ? req.body.widgets : [];
    await t.db.query(
      `INSERT INTO user_dashboard_config (tenant_id, user_id, widgets, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (user_id, tenant_id)
       DO UPDATE SET widgets = EXCLUDED.widgets, updated_at = now()`,
      [t.id, Number(req.user?.id), widgets]
    );
    res.json({ widgets });
  } catch (e) {
    res.status(400).json({ message: 'Dashboard konnte nicht gespeichert werden' });
  }
});

app.get('/api/me/favorites', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const { rows } = await t.db.query(`SELECT * FROM favorites WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [t.id, Number(req.user?.id)]);
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ message: 'Favoriten konnten nicht geladen werden' });
  }
});

app.post('/api/me/favorites', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const { type, targetId } = req.body || {};
    if (!type || !targetId) return res.status(400).json({ message: 'type/targetId fehlt' });
    const { rows } = await t.db.query(
      `INSERT INTO favorites (tenant_id, user_id, type, target_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [t.id, Number(req.user?.id), String(type).toUpperCase(), String(targetId)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ message: 'Favorit konnte nicht gespeichert werden' });
  }
});

app.delete('/api/me/favorites/:id', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant','billing'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rowCount } = await t.db.query(`DELETE FROM favorites WHERE tenant_id = $1 AND user_id = $2 AND id = $3`, [t.id, Number(req.user?.id), id]);
    if (!rowCount) return res.status(404).json({ message: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: 'Favorit konnte nicht gelöscht werden' });
  }
});

app.post('/api/patients/:id/communication', authenticateToken, requirePermission('patients.write', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const t = await ensureRequestTenant(req);
    const pid = Number(req.params.id);
    const { type, direction, summary } = req.body || {};
    const TYPES = new Set(['PHONE','EMAIL','SMS','LETTER','IN_PERSON']);
    const DIRS = new Set(['INBOUND','OUTBOUND']);
    if (!TYPES.has(String(type).toUpperCase()) || !DIRS.has(String(direction).toUpperCase())) {
      return res.status(400).json({ message: 'Ungültiger Typ oder Richtung' });
    }
    const { rows } = await t.db.query(
      `INSERT INTO patient_communication_log (tenant_id, patient_id, type, direction, summary, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [t.id, pid, String(type).toUpperCase(), String(direction).toUpperCase(), summary || null, Number(req.user?.id) || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ message: 'Eintrag konnte nicht erstellt werden' });
  }
});

app.get('/api/sops/:id', authenticateToken, requireRole('admin','arzt','assistenz','doctor','assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rows } = await tenantCtx.db.query(`SELECT * FROM sops WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!rows.length) return res.status(404).json({ message: 'SOP nicht gefunden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'SOP konnte nicht geladen werden' });
  }
});

app.post('/api/sops', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { title, content } = req.body || {};
    if (!title) return res.status(400).json({ message: 'title fehlt' });
    const { rows } = await tenantCtx.db.query(
      `INSERT INTO sops (tenant_id, title, content, created_by_user_id)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [tenantCtx.id, String(title), content || null, Number(req.user?.id) || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'SOP konnte nicht erstellt werden' });
  }
});

app.patch('/api/sops/:id', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const existing = await tenantCtx.db.query(`SELECT * FROM sops WHERE tenant_id = $1 AND id = $2`, [tenantCtx.id, id]);
    if (!existing.rowCount) return res.status(404).json({ message: 'SOP nicht gefunden' });
    const prev = existing.rows[0];
    if (prev.locked) return res.status(403).json({ message: 'SOP ist gesperrt' });
    const fields = [];
    const params = [tenantCtx.id, id];
    let i = params.length;
    const set = (col, val) => { fields.push(`${col} = $${++i}`); params.push(val); };
    if (req.body?.title !== undefined) set('title', String(req.body.title));
    if (req.body?.content !== undefined) set('content', req.body.content || null);
    // bump version if content changed
    if (req.body?.content !== undefined && String(req.body.content || '') !== String(prev.content || '')) {
      set('version', Number(prev.version || 1) + 1);
    }
    if (!fields.length) return res.status(400).json({ message: 'keine Änderungen' });
    const { rows } = await tenantCtx.db.query(
      `UPDATE sops SET ${fields.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'SOP konnte nicht aktualisiert werden' });
  }
});

app.post('/api/sops/:id/lock', authenticateToken, requireRole('admin','doctor'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const id = Number(req.params.id);
    const { rows } = await tenantCtx.db.query(
      `UPDATE sops SET locked = true, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND locked = false RETURNING *`,
      [tenantCtx.id, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'SOP nicht gefunden oder bereits gesperrt' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: 'SOP konnte nicht gesperrt werden' });
  }
});

// ── Patienten (CRUD light)
async function resolveDoctorId(tenantCtx, identifier, fallbackUser) {
  if (!identifier && fallbackUser && ['doctor'].includes(String(fallbackUser.role || fallbackUser.rolle || '').toLowerCase())) {
    return fallbackUser.id;
  }
  if (!identifier) return null;
  const db = tenantCtx.db;
  const normalized = String(identifier).trim().toLowerCase();
  if (!normalized) return null;
  const { rows } = await db.query(
    `SELECT id
       FROM users
      WHERE tenant_id = $1
        AND (lower(email) = $2 OR lower(username) = $2)
      LIMIT 1`,
    [tenantCtx.id, normalized]
  );
  if (rows.length) return rows[0].id;
  const asNumber = Number(identifier);
  if (Number.isFinite(asNumber)) {
    const resultById = await db.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantCtx.id, asNumber]
    );
    if (resultById.rows.length) return resultById.rows[0].id;
  }
  return null;
}

async function createPatientHandler(req, res) {
  const tenantCtx = req.tenant;
  const db = tenantCtx?.db;
  if (!db) return res.status(500).json({ message: 'Mandanten-Datenbank nicht verfügbar' });

  const body = req.body || {};
  const firstName = body.vorname || body.firstName || body.first_name || (body.name ? body.name.split(' ')[0] : null);
  const lastName =
    body.nachname ||
    body.lastName ||
    body.last_name ||
    (body.name ? body.name.split(' ').slice(1).join(' ') : null);
  const fullName = (body.name || `${firstName || ''} ${lastName || ''}`).trim();
  if (!fullName) {
    return res.status(400).json({ message: 'Name des Patienten fehlt.' });
  }

  const birthdate = body.birthdate || body.geburtsdatum || null;
  const genderInfo = normalizeGender(body.gender || body.geschlecht);
  const treatedSex = normalizeSex(body.treated_sex || body.treatedSex || body.sex || body.billing_sex || body.billingSex);
  const insurance = body.insurance || body.krankenkasse || body.krankenkasse_name || null;
  const insuranceNumber = body.insurance_number || body.versichertennummer || null;
  const ahvNummer = body.ahv_nummer || body.ahv || null;
  const kassenAdresse = body.krankenkasse_adresse || body.insurance_address || null;
  const medikationsplan = body.medikationsplan || null;
  const allergien = body.allergien || null;
  const impfstatus = body.impfstatus || null;
  const phone = body.phone || body.telefonnummer || null;
  const email = body.email || null;
  const notes = body.notes || body.krankengeschichte || '';
  const vorgesetzter = cleanString(body.vorgesetzter ?? body.supervisor ?? body.vorgesetzte);
  const doctorIdentifier = body.doctor_id || body.doctorId || body.doctorEmail || body.doctor_email;

  const address = body.address && typeof body.address === 'object'
    ? body.address
    : {
        street: body.street || body.adresse || null,
        houseNo: body.houseNo || body.hausnummer || null,
        zip: body.zip || body.plz || null,
        city: body.city || body.ort || null,
        country: body.country || 'CH'
      };

  const guardianInput = normalizeGuardianInput(body, address);
  const minor = isMinorPatient(birthdate);
  if (minor) {
    if (!guardianInput.provided) {
      return res.status(400).json({ message: 'Für minderjährige Patienten ist eine verantwortliche Person (Name, Beziehung, Adresse, Telefon) erforderlich.' });
    }
    const missing = guardianValidationErrors(guardianInput);
    if (missing.length) {
      return res.status(400).json({ message: `Verantwortliche Person unvollständig: ${missing.join(', ')}` });
    }
  } else if (guardianInput.provided) {
    const missing = guardianValidationErrors(guardianInput);
    if (missing.length) {
      return res.status(400).json({ message: `Verantwortliche Person unvollständig: ${missing.join(', ')}` });
    }
  }
  const guardianAddress = guardianInput.address;
  const guardianDb = {
    firstName: guardianInput.firstName || null,
    lastName: guardianInput.lastName || null,
    relationship: guardianInput.relationship || null,
    phone: guardianInput.phone || null,
    email: guardianInput.email || null,
    addressJson: guardianAddress ? JSON.stringify(guardianAddress) : null,
    sameAddress: Boolean(guardianInput.sameAddress && guardianAddress),
    street: guardianAddress?.street || null,
    houseNo: guardianAddress?.houseNo || null,
    zip: guardianAddress?.zip || null,
    city: guardianAddress?.city || null
  };

  const requiresTreatedSex = Boolean(genderInfo?.iso && ['diverse', 'other'].includes(String(genderInfo.iso).toLowerCase()));
  if (requiresTreatedSex && !treatedSex) {
    return res.status(400).json({ message: 'Bei Geschlecht "Divers" ist das behandelte Geschlecht (treated_sex/sex: male|female) für die Abrechnung erforderlich.' });
  }

  let doctorId = Number(body.doctor_id || body.doctorId);
  if (!Number.isFinite(doctorId)) {
    doctorId = await resolveDoctorId(tenantCtx, doctorIdentifier, req.user);
  }

  let insuranceId = body.insurance_id ? Number(body.insurance_id) : null;
  if (!Number.isFinite(insuranceId) && insurance) {
    try {
      const { rows: ins } = await db.query(
        `SELECT id FROM insurances WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [tenantCtx.id, String(insurance).trim()]
      );
      if (ins.length) insuranceId = ins[0].id;
    } catch {}
  }
  const params = [
    tenantCtx.id,
    fullName,
    birthdate,
    genderInfo?.iso || null,
    insurance,
    insuranceNumber,
    doctorId,
    phone,
    email,
    JSON.stringify(address),
    notes,
    medikationsplan,
    allergien,
    impfstatus,
    ahvNummer,
    firstName || fullName,
    lastName || '',
    birthdate,
    genderInfo?.legacy || null,
    address.street || null,
    address.houseNo || null,
    address.zip || null,
    address.city || null,
    phone,
    insuranceNumber,
    insurance,
    kassenAdresse,
    notes,
    insuranceId,
    guardianDb.firstName,
    guardianDb.lastName,
    guardianDb.relationship,
    guardianDb.phone,
    guardianDb.email,
    guardianDb.addressJson,
    guardianDb.sameAddress,
    guardianDb.street,
    guardianDb.houseNo,
    guardianDb.zip,
    guardianDb.city,
    treatedSex,
    vorgesetzter
  ];

  try {
    const result = await db.query(
       `INSERT INTO patients (
         tenant_id, name, birthdate, gender, insurance, insurance_number,
         doctor_id, phone, email, address, notes,
         medikationsplan, allergien, impfstatus,
         ahv_nummer,
         vorname, nachname, geburtsdatum, geschlecht,
         adresse, hausnummer, plz, ort, telefonnummer,
         versichertennummer, krankenkasse, krankenkasse_adresse, krankengeschichte,
         insurance_id,
         guardian_first_name, guardian_last_name, guardian_relationship, guardian_phone, guardian_email,
         guardian_address, guardian_same_address, guardian_adresse, guardian_hausnummer, guardian_plz, guardian_ort,
         treated_sex,
         vorgesetzter
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,$10::jsonb,$11,
         $12,$13,$14,
         $15,
         $16,$17,$18,$19,
         $20,$21,$22,$23,$24,
         $25,$26,$27,$28,
         $29,
         $30,$31,$32,$33,$34,
         $35::jsonb,$36,$37,$38,$39,$40,
         $41,
         $42
       )
       ON CONFLICT (tenant_id, insurance_number)
       DO UPDATE SET
         name = EXCLUDED.name,
         birthdate = EXCLUDED.birthdate,
         gender = EXCLUDED.gender,
         insurance = EXCLUDED.insurance,
         doctor_id = COALESCE(EXCLUDED.doctor_id, patients.doctor_id),
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         address = EXCLUDED.address,
         notes = EXCLUDED.notes,
         medikationsplan = COALESCE(EXCLUDED.medikationsplan, patients.medikationsplan),
         allergien = COALESCE(EXCLUDED.allergien, patients.allergien),
         impfstatus = COALESCE(EXCLUDED.impfstatus, patients.impfstatus),
         ahv_nummer = COALESCE(EXCLUDED.ahv_nummer, patients.ahv_nummer),
         treated_sex = COALESCE(EXCLUDED.treated_sex, patients.treated_sex),
         vorgesetzter = COALESCE(EXCLUDED.vorgesetzter, patients.vorgesetzter),
         vorname = EXCLUDED.vorname,
         nachname = EXCLUDED.nachname,
         geburtsdatum = EXCLUDED.geburtsdatum,
         geschlecht = EXCLUDED.geschlecht,
         adresse = EXCLUDED.adresse,
         hausnummer = EXCLUDED.hausnummer,
         plz = EXCLUDED.plz,
         ort = EXCLUDED.ort,
         telefonnummer = EXCLUDED.telefonnummer,
         versichertennummer = EXCLUDED.versichertennummer,
         krankenkasse = EXCLUDED.krankenkasse,
         krankenkasse_adresse = EXCLUDED.krankenkasse_adresse,
         krankengeschichte = EXCLUDED.krankengeschichte,
         insurance_id = COALESCE(EXCLUDED.insurance_id, patients.insurance_id),
         guardian_first_name = EXCLUDED.guardian_first_name,
         guardian_last_name = EXCLUDED.guardian_last_name,
         guardian_relationship = EXCLUDED.guardian_relationship,
         guardian_phone = EXCLUDED.guardian_phone,
         guardian_email = EXCLUDED.guardian_email,
         guardian_address = EXCLUDED.guardian_address,
         guardian_same_address = EXCLUDED.guardian_same_address,
         guardian_adresse = EXCLUDED.guardian_adresse,
         guardian_hausnummer = EXCLUDED.guardian_hausnummer,
         guardian_plz = EXCLUDED.guardian_plz,
         guardian_ort = EXCLUDED.guardian_ort
       RETURNING *`,
      params
    );
    const patient = result.rows[0];
    await provisionPatientStorage(tenantCtx, patient.id);
    await audit(req, 'patient.create', { userId: req.user?.id, patientId: patient.id, ...clientMeta(req) });
    res.status(201).json({ patient: toPatientDto(patient) });
  } catch (err) {
    console.error('Patient creation failed:', err);
    res.status(500).json({ message: 'Fehler beim Anlegen des Patienten' });
  }
}

async function listPatientsHandler(req, res) {
  try {
    const { rows } = await req.tenant.db.query(
      `SELECT p.*,
              u.name AS doctor_name,
              u.email AS doctor_email,
              i.name AS insurance_name,
              i.ean AS insurance_ean,
              i.kvnr AS insurance_kvnr,
              i.address AS insurance_address,
              i.zip AS insurance_zip,
              i.city AS insurance_city,
              i.canton AS insurance_canton,
              i.bfs_code AS insurance_bfs_code
         FROM patients p
         LEFT JOIN users u ON u.id = p.doctor_id
         LEFT JOIN insurances i ON i.id = p.insurance_id AND i.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1
        ORDER BY COALESCE(p.name, concat_ws(' ', p.vorname, p.nachname)) ASC`,
      [req.tenant.id]
    );
    res.json(rows.map(toPatientDto));
  } catch (err) {
    console.error('Patient listing failed:', err);
    res.status(500).json({ message: 'Fehler beim Abrufen der Patienten' });
  }
}

async function searchPatientsHandler(req, res) {
  const query = String(req.query.query || req.query.q || '').trim();
  if (!query) return res.status(400).json({ message: 'Kein Suchbegriff angegeben' });
  const like = `%${query}%`;
  try {
    const { rows } = await req.tenant.db.query(
      `SELECT p.*,
              u.name AS doctor_name,
              u.email AS doctor_email
         FROM patients p
         LEFT JOIN users u ON u.id = p.doctor_id
        WHERE p.tenant_id = $1
          AND (
            COALESCE(p.name, '') ILIKE $2 OR
            COALESCE(p.vorname, '') ILIKE $2 OR
            COALESCE(p.nachname, '') ILIKE $2 OR
            COALESCE(p.versichertennummer, '') ILIKE $2 OR
            COALESCE(p.insurance_number, '') ILIKE $2
          )
        ORDER BY COALESCE(p.name, concat_ws(' ', p.vorname, p.nachname)) ASC
        LIMIT 50`,
      [req.tenant.id, like]
    );
    res.json(rows.map(toPatientDto));
  } catch (err) {
    console.error('Patient search failed:', err);
    res.status(500).json({ message: 'Fehler beim Suchen der Patienten' });
  }
}

app.post('/api/patients', maybeAuth, requirePermission('patients.write', 'admin', 'doctor', 'assistant'), createPatientHandler);
// SECURITY: removed incorrect mapping of /api/users to createPatientHandler

app.get('/api/patients', maybeAuth, requirePermission('patients.read', 'admin', 'doctor', 'assistant', 'billing'), listPatientsHandler);

app.get('/api/patients/search', maybeAuth, requirePermission('patients.read', 'admin', 'doctor', 'assistant'), searchPatientsHandler);

app.get('/api/patients/:id', maybeAuth, requirePermission('patients.read', 'admin', 'doctor', 'assistant', 'billing'), async (req, res) => {
  try {
    const { rows } = await req.tenant.db.query(
      `SELECT p.*,
              u.name AS doctor_name,
              u.email AS doctor_email,
              i.name AS insurance_name,
              i.ean AS insurance_ean,
              i.kvnr AS insurance_kvnr,
              i.address AS insurance_address,
              i.zip AS insurance_zip,
              i.city AS insurance_city,
              i.canton AS insurance_canton,
              i.bfs_code AS insurance_bfs_code
         FROM patients p
         LEFT JOIN users u ON u.id = p.doctor_id
         LEFT JOIN insurances i ON i.id = p.insurance_id AND i.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.id = $2
        LIMIT 1`,
      [req.tenant.id, Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ message: 'Patient nicht gefunden' });
    res.json(toPatientDto(rows[0]));
  } catch (err) {
    console.error('Get patient failed:', err);
    res.status(500).json({ message: 'Fehler beim Abrufen des Patienten' });
  }
});

// Update patient (limited fields)
app.put('/api/patients/:id', maybeAuth, requirePermission('patients.write', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    const body = req.body || {};
    const existingRes = await req.tenant.db.query(
      `SELECT * FROM patients WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [req.tenant.id, id]
    );
    if (!existingRes.rows.length) return res.status(404).json({ message: 'Patient nicht gefunden' });
    const existing = existingRes.rows[0];
    const currentAddress = parseAddress(existing);
    const currentGuardian = parseGuardianFromRow(existing);

    const fields = {
      vorname: body.vorname,
      nachname: body.nachname,
      birthdate: body.birthdate,
      geburtsdatum: body.geburtsdatum,
      telefonnummer: body.telefonnummer || body.phone,
      phone: body.phone || body.telefonnummer,
      email: body.email,
      adresse: body.adresse || (body.address && body.address.street),
      hausnummer: body.hausnummer || (body.address && body.address.houseNo),
      plz: body.plz || (body.address && body.address.zip),
      ort: body.ort || (body.address && body.address.city),
      krankengeschichte: body.krankengeschichte || body.notes,
      notes: body.notes || body.krankengeschichte,
      medikationsplan: body.medikationsplan,
      allergien: body.allergien,
      impfstatus: body.impfstatus,
      krankenkasse: body.krankenkasse || body.insurance || body.krankenkasse_name,
      krankenkasse_adresse: body.krankenkasse_adresse || body.insurance_address,
      versichertennummer: body.versichertennummer || body.insurance_number,
      ahv_nummer: body.ahv_nummer || body.ahv,
      insurance: body.insurance || body.krankenkasse || body.krankenkasse_name,
      insurance_number: body.insurance_number || body.versichertennummer
    };

    const birthdatePatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'birthdate') ||
      Object.prototype.hasOwnProperty.call(body, 'geburtsdatum');
    if (birthdatePatchProvided) {
      const nextBirthdate = body.birthdate || body.geburtsdatum || null;
      fields.birthdate = nextBirthdate;
      fields.geburtsdatum = nextBirthdate;
    }

    const genderPatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'geschlecht') ||
      Object.prototype.hasOwnProperty.call(body, 'gender');
    if (genderPatchProvided) {
      const g = normalizeGender(body.geschlecht || body.gender);
      if (!g) return res.status(400).json({ message: 'Ungültiges Geschlecht.' });
      fields.gender = g.iso;
      fields.geschlecht = g.legacy;
    }

    const namePatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'name') ||
      Object.prototype.hasOwnProperty.call(body, 'vorname') ||
      Object.prototype.hasOwnProperty.call(body, 'nachname');
    if (namePatchProvided) {
      const nextFirst = typeof body.vorname !== 'undefined' ? body.vorname : existing.vorname;
      const nextLast = typeof body.nachname !== 'undefined' ? body.nachname : existing.nachname;
      const explicit = typeof body.name !== 'undefined' ? String(body.name || '').trim() : '';
      const derived = [nextFirst, nextLast].filter(Boolean).join(' ').trim();
      const nextName = explicit || derived;
      if (nextName) fields.name = nextName;
    }

    const treatedSexPatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'treated_sex') ||
      Object.prototype.hasOwnProperty.call(body, 'treatedSex') ||
      Object.prototype.hasOwnProperty.call(body, 'sex') ||
      Object.prototype.hasOwnProperty.call(body, 'billing_sex') ||
      Object.prototype.hasOwnProperty.call(body, 'billingSex');
    if (treatedSexPatchProvided) {
      const raw = body.treated_sex ?? body.treatedSex ?? body.sex ?? body.billing_sex ?? body.billingSex;
      if (raw == null || raw === '') {
        fields.treated_sex = null;
      } else {
        const normalized = normalizeSex(raw);
        if (!normalized) return res.status(400).json({ message: 'treated_sex/sex muss "male" oder "female" sein.' });
        fields.treated_sex = normalized;
      }
    }

    const vorgesetzterPatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'vorgesetzter') ||
      Object.prototype.hasOwnProperty.call(body, 'supervisor') ||
      Object.prototype.hasOwnProperty.call(body, 'vorgesetzte');
    if (vorgesetzterPatchProvided) {
      fields.vorgesetzter = cleanString(body.vorgesetzter ?? body.supervisor ?? body.vorgesetzte);
    }

    const addressPatchProvided =
      Object.prototype.hasOwnProperty.call(body, 'adresse') ||
      Object.prototype.hasOwnProperty.call(body, 'hausnummer') ||
      Object.prototype.hasOwnProperty.call(body, 'plz') ||
      Object.prototype.hasOwnProperty.call(body, 'ort') ||
      (body.address && typeof body.address === 'object');
    if (addressPatchProvided) {
      const nextAddress = {
        street: typeof fields.adresse !== 'undefined' ? fields.adresse : (currentAddress.street || null),
        houseNo: typeof fields.hausnummer !== 'undefined' ? fields.hausnummer : (currentAddress.houseNo || null),
        zip: typeof fields.plz !== 'undefined' ? fields.plz : (currentAddress.zip || null),
        city: typeof fields.ort !== 'undefined' ? fields.ort : (currentAddress.city || null),
        country: currentAddress.country || 'CH'
      };
      fields.address = JSON.stringify(nextAddress);
    }

    const nextGenderIso = (genderPatchProvided ? fields.gender : normalizeGender(existing.gender || existing.geschlecht)?.iso) || null;
    const nextTreatedSex = (treatedSexPatchProvided ? fields.treated_sex : (existing.treated_sex || null)) || null;
    if (nextGenderIso && ['diverse', 'other'].includes(String(nextGenderIso).toLowerCase()) && !nextTreatedSex) {
      return res.status(400).json({ message: 'Bei Geschlecht "Divers" ist treated_sex/sex (male|female) erforderlich.' });
    }

    // Optional: set or resolve insurance_id for proper JOIN to insurances
    let insuranceId = body.insurance_id;
    if (Object.prototype.hasOwnProperty.call(body, 'insurance_id') && body.insurance_id === null) {
      fields.insurance_id = null;
    } else if (typeof insuranceId !== 'undefined') {
      const n = Number(insuranceId);
      if (Number.isFinite(n)) fields.insurance_id = n;
    } else if ((fields.krankenkasse || '').trim()) {
      try {
        const { rows: ins } = await req.tenant.db.query(
          `SELECT id FROM insurances WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [req.tenant.id, String(fields.krankenkasse).trim()]
        );
        if (ins.length) fields.insurance_id = ins[0].id;
      } catch {}
    }

    const guardianPatchProvided = hasGuardianPatch(body);
    let guardianInput = null;
    if (guardianPatchProvided) {
      const nextAddress = {
        street: typeof fields.adresse !== 'undefined' ? fields.adresse : (currentAddress.street || null),
        houseNo: typeof fields.hausnummer !== 'undefined' ? fields.hausnummer : (currentAddress.houseNo || null),
        zip: typeof fields.plz !== 'undefined' ? fields.plz : (currentAddress.zip || null),
        city: typeof fields.ort !== 'undefined' ? fields.ort : (currentAddress.city || null),
        country: currentAddress.country || 'CH'
      };
      guardianInput = normalizeGuardianInput(body, nextAddress);
      if (guardianInput.provided) {
        const missing = guardianValidationErrors(guardianInput);
        if (missing.length) {
          return res.status(400).json({ message: `Verantwortliche Person unvollständig: ${missing.join(', ')}` });
        }
      }
      const guardianAddress = guardianInput.address;
      fields.guardian_first_name = guardianInput.firstName || null;
      fields.guardian_last_name = guardianInput.lastName || null;
      fields.guardian_relationship = guardianInput.relationship || null;
      fields.guardian_phone = guardianInput.phone || null;
      fields.guardian_email = guardianInput.email || null;
      fields.guardian_address = guardianAddress ? JSON.stringify(guardianAddress) : null;
      fields.guardian_same_address = guardianInput.sameAddress && guardianAddress ? true : false;
      fields.guardian_adresse = guardianAddress?.street || null;
      fields.guardian_hausnummer = guardianAddress?.houseNo || null;
      fields.guardian_plz = guardianAddress?.zip || null;
      fields.guardian_ort = guardianAddress?.city || null;
    }

    const keys = Object.keys(fields).filter((k) => typeof fields[k] !== 'undefined');
    if (!keys.length) return res.status(400).json({ message: 'Keine Felder zum Aktualisieren übergeben' });

    const nextBirthdate = (birthdatePatchProvided ? (fields.birthdate || fields.geburtsdatum) : null) || existing.geburtsdatum || existing.birthdate || null;
    const minorAfterUpdate = isMinorPatient(nextBirthdate);
    const guardianForValidation = guardianPatchProvided
      ? (guardianInput?.provided ? guardianInput : null)
      : (currentGuardian.first_name || currentGuardian.last_name || currentGuardian.phone || currentGuardian.address
          ? {
              provided: true,
              firstName: currentGuardian.first_name,
              lastName: currentGuardian.last_name,
              relationship: currentGuardian.relationship,
              phone: currentGuardian.phone,
              email: currentGuardian.email,
              address: currentGuardian.address
            }
          : null);
    if (minorAfterUpdate) {
      if (!guardianForValidation) {
        return res.status(400).json({ message: 'Verantwortliche Person darf bei minderjährigen Patienten nicht entfernt werden.' });
      }
      const missingGuardian = guardianValidationErrors(guardianForValidation);
      if (missingGuardian.length) {
        return res.status(400).json({ message: `Verantwortliche Person unvollständig: ${missingGuardian.join(', ')}` });
      }
    }

    const sets = keys.map((k, i) => {
      const placeholder = `$${i + 3}`;
      if (k === 'guardian_address') return `${k} = ${placeholder}::jsonb`;
      if (k === 'address') return `${k} = ${placeholder}::jsonb`;
      return `${k} = ${placeholder}`;
    });
    const params = [req.tenant.id, id, ...keys.map((k) => fields[k])];
    const sql = `UPDATE patients SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`;
    const { rows } = await req.tenant.db.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: 'Patient nicht gefunden' });
    res.json({ patient: toPatientDto(rows[0]) });
  } catch (err) {
    console.error('Patient update failed:', err?.message || err);
    res.status(500).json({ message: 'Aktualisieren des Patienten fehlgeschlagen' });
  }
});

// Delete patient
app.delete('/api/patients/:id', maybeAuth, requirePermission('patients.delete', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige Patienten-ID' });
    const { rowCount } = await req.tenant.db.query(
      `DELETE FROM patients WHERE tenant_id = $1 AND id = $2`,
      [req.tenant.id, id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Patient nicht gefunden' });
    await audit(req, 'patient.delete', { userId: req.user?.id, patientId: id, ...clientMeta(req) });
    res.json({ ok: true });
  } catch (err) {
    console.error('Patient delete failed:', err?.message || err);
    res.status(500).json({ message: 'Löschen des Patienten fehlgeschlagen' });
  }
});

// ── Dateien / Uploads (JWT-geschützt)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        if (!req?.tenant?.paths?.tmpDir) throw new Error('Mandanten-TMP-Verzeichnis nicht verfügbar');
        fs.mkdirSync(req.tenant.paths.tmpDir, { recursive: true, mode: 0o750 });
        cb(null, req.tenant.paths.tmpDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const base = path.basename(file.originalname).replace(/[^\w.\-+]/g, '_') || 'upload';
      const ext = path.extname(base);
      const stem = ext ? base.slice(0, -ext.length) : base;
      const unique = `${stem}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      cb(null, `${unique}${ext}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Presigned-URL für S3-Dokument — GET /api/patient-files/:patientId/url?key=<s3key>
// Frontend: User klickt "Dokument öffnen" → Backend prüft Session → gibt zeitlich begrenzten S3-Link
app.get('/api/patient-files/:patientId/url',
  authenticateToken,
  requireRole('admin','abrechnung','arzt','assistenz'),
  async (req, res) => {
    if (!s3docs.isS3Configured()) {
      return res.status(404).json({ message: 'S3 nicht konfiguriert' });
    }
    try {
      const patientId = String(req.params.patientId);
      const s3Key = String(req.query.key || '').trim();
      if (!s3Key) return res.status(400).json({ message: 'Parameter "key" fehlt' });

      // Ensure the key belongs to this tenant + patient (path injection guard)
      const expectedPrefix = s3docs.buildPatientPrefix(req.tenant.id, patientId);
      if (!s3Key.startsWith(expectedPrefix)) {
        return res.status(403).json({ message: 'Zugriff verweigert' });
      }

      const url = await s3docs.generatePresignedGetUrl(s3Key);
      audit(req, 'patient.file_served', {
        userId: req.user?.id, patientId,
        s3Key, storage: 's3', ...clientMeta(req)
      });
      res.json({ url, expiresIn: 3600 });
    } catch (err) {
      console.error('Presigned URL Fehler:', err);
      res.status(500).json({ message: 'Fehler beim Erstellen des Dokument-Links' });
    }
  }
);

// Dateien ausliefern (Filesystem-Fallback wenn S3 nicht konfiguriert)
app.use(
  '/patient-files',
  authenticateToken,
  requireRole('admin','abrechnung','arzt','assistenz'),
  async (req, res, next) => {
    if (s3docs.isS3Configured()) {
      return res.status(410).json({ message: 'Direkte Dateiauslieferung nicht verfügbar. Bitte /api/patient-files/:id/url verwenden.' });
    }
    try {
      if (!req.tenant) {
        await attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId());
      }
    } catch (err) {
      return res.status(400).json({ message: 'Mandant ungültig oder fehlt' });
    }

    res.setHeader('Cache-Control', 'no-store');
    const parts = (req.path || '').split('/').filter(Boolean);
    const patientId = parts[0] || null;
    const filename = parts.length > 1 ? parts.slice(1).join('/') : null;
    const onFinish = () => {
      if (req.method === 'GET' && res.statusCode === 200 && patientId && filename) {
        audit(req, 'patient.file_served', {
          patientId, filename,
          tenant: req.tenant?.id,
          userId: req.user?.id || req.user?.username,
          storage: 'filesystem', ...clientMeta(req)
        });
      }
    };
    res.on('finish', onFinish);
    const staticMiddleware = express.static(req.tenant.paths.patientFilesDir, { dotfiles: 'deny', index: false, fallthrough: false, maxAge: 0 });
    staticMiddleware(req, res, (err) => {
      res.removeListener('finish', onFinish);
      if (err) {
        const status = err.status || err.statusCode;
        if (status === 404 || err.code === 'ENOENT') {
          return res.status(404).json({ message: 'Datei nicht gefunden' });
        }
        return next(err);
      }
      next();
    });
  }
);

// Ensure 404 JSON for any non-matched /patient-files requests
app.use('/patient-files', authenticateToken, requireRole('admin','abrechnung','arzt','assistenz'), (req, res) => {
  return res.status(404).json({ message: 'Datei nicht gefunden' });
});

// Datei-Upload nach /patient-files/<patientId>
app.post(
  '/api/upload-patient-file/:patientId',
  authenticateToken,
  requireRole('admin','abrechnung','arzt','assistenz'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'Keine Datei erhalten' });
      const patientId = String(req.params.patientId);
      const rawName = path.basename(req.file.originalname).replace(/[^\w.\-+]/g, '_') || 'upload';

      if (s3docs.isS3Configured()) {
        // S3 upload — deduplicate filename with timestamp suffix
        const ext = path.extname(rawName);
        const stem = ext ? rawName.slice(0, -ext.length) : rawName;
        const s3Key = await s3docs.buildFileKey(req.tenant.id, patientId, `${stem}-${Date.now().toString(36)}${ext}`);
        const fileBuffer = fs.readFileSync(req.file.path);
        await s3docs.uploadPatientFile(
          req.tenant.id, patientId,
          `${stem}-${Date.now().toString(36)}${ext}`,
          fileBuffer,
          req.file.mimetype
        );
        fs.unlink(req.file.path, () => {});
        audit(req, 'patient.file_upload', {
          userId: req.user?.id, patientId,
          filename: rawName, storage: 's3', ...clientMeta(req)
        });
        return res.json({ message: 'Datei erfolgreich hochgeladen' });
      }

      // Filesystem fallback
      const patientDir = safeJoin(req.tenant.paths.patientFilesDir, patientId);
      fs.mkdirSync(patientDir, { recursive: true, mode: 0o750 });
      let targetPath = path.join(patientDir, rawName);
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(rawName);
        const stem = ext ? rawName.slice(0, -ext.length) : rawName;
        targetPath = path.join(patientDir, `${stem}-${Date.now().toString(36)}${ext}`);
      }
      fs.rename(req.file.path, targetPath, (err) => {
        if (err) {
          console.error('Datei verschieben fehlgeschlagen:', err);
          return res.status(500).json({ message: 'Fehler beim Speichern der Datei' });
        }
        audit(req, 'patient.file_upload', {
          userId: req.user?.id, patientId,
          filename: path.basename(targetPath), storage: 'filesystem', ...clientMeta(req)
        });
        res.json({ message: 'Datei erfolgreich hochgeladen' });
      });
    } catch (err) {
      console.error('Upload fehlgeschlagen:', err);
      return res.status(500).json({ message: 'Fehler beim Hochladen der Datei' });
    }
  }
);

// Dateien listen (mit Typ-Erkennung)
app.get('/api/patient-files/:patientId',
  authenticateToken,
  requireRole('admin','abrechnung','arzt','assistenz'),
  async (req, res) => {
    try {
      const patientId = String(req.params.patientId);

      if (s3docs.isS3Configured()) {
        const files = await s3docs.listPatientFiles(req.tenant.id, patientId);
        audit(req, 'patient.file_list', {
          userId: req.user?.id, patientId, files: files.length, storage: 's3', ...clientMeta(req)
        });
        return res.json({ files });
      }

      // Filesystem fallback
      const directoryPath = safeJoin(req.tenant.paths.patientFilesDir, patientId);
      if (!fs.existsSync(directoryPath)) return res.json({ files: [] });

      const out = [];
      const walk = (base, rel = '') => {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const ent of entries) {
          const relPath = rel ? path.join(rel, ent.name) : ent.name;
          const absPath = path.join(base, ent.name);
          if (ent.isDirectory()) {
            if (relPath.split(path.sep).length <= 3) walk(absPath, relPath);
            continue;
          }
          if (!ent.isFile()) continue;
          const ext = path.extname(ent.name).toLowerCase();
          let type = 'other';
          if (['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(ext)) type = 'image';
          else if (ext === '.pdf') type = 'pdf';
          else if (['.txt','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp'].includes(ext)) type = 'office';
          out.push({ name: relPath, type });
        }
      };
      walk(directoryPath, '');

      audit(req, 'patient.file_list', {
        userId: req.user?.id, patientId, files: out.length, storage: 'filesystem', ...clientMeta(req)
      });
      res.json({ files: out });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Fehler beim Abrufen der Dateien' });
    }
  }
);

// Datei löschen: /api/patient-files/:patientId?key=<s3key>  (S3)
//                /api/patient-files/:patientId?name=<relPfad> (Filesystem-Fallback)
app.delete('/api/patient-files/:patientId',
  authenticateToken,
  requireRole('admin','abrechnung','arzt','assistenz'),
  async (req, res) => {
    try {
      const patientId = String(req.params.patientId);

      if (s3docs.isS3Configured()) {
        const s3Key = String(req.query.key || '').trim();
        if (!s3Key) return res.status(400).json({ message: 'Parameter "key" fehlt' });

        // Path injection guard
        const expectedPrefix = s3docs.buildPatientPrefix(req.tenant.id, patientId);
        if (!s3Key.startsWith(expectedPrefix)) {
          return res.status(403).json({ message: 'Zugriff verweigert' });
        }
        const exists = await s3docs.patientFileExists(s3Key);
        if (!exists) return res.status(404).json({ message: 'Datei nicht gefunden' });

        await s3docs.deletePatientFile(s3Key);
        audit(req, 'patient.file_delete', {
          userId: req.user?.id, patientId,
          s3Key, storage: 's3', ...clientMeta(req)
        });
        return res.json({ ok: true });
      }

      // Filesystem fallback
      const name = String(req.query.name || '').trim();
      if (!name) return res.status(400).json({ message: 'Parameter "name" fehlt' });

      const patientDir = safeJoin(req.tenant.paths.patientFilesDir, patientId);
      const rel = name.replace(/^\/+/, '');
      const target = safeJoin(patientDir, rel);

      if (!fs.existsSync(target)) return res.status(404).json({ message: 'Datei nicht gefunden' });
      const stat = fs.statSync(target);
      if (!stat.isFile()) return res.status(400).json({ message: 'Kein reguläres File' });

      await fsp.unlink(target);
      audit(req, 'patient.file_delete', {
        userId: req.user?.id, patientId,
        filename: path.basename(target), storage: 'filesystem', ...clientMeta(req)
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Delete file error:', err?.message || err);
      return res.status(500).json({ message: 'Löschen fehlgeschlagen' });
    }
  }
);

// Datei lokal öffnen (Server) – optional
// In Produktion deaktiviert: schützt vor Missbrauch/Exec auf dem Server
app.get('/api/open-file', authenticateToken, requireRole('admin','arzt','assistenz'), (req, res) => {
  if (isProd) return res.status(403).json({ message: 'Endpoint in Produktion deaktiviert' });
  try {
    let fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).json({ message: "Kein Pfad angegeben" });
    if (fileUrl.startsWith("file://")) fileUrl = fileUrl.replace("file://", "");
    const base = req.tenant.paths.patientFilesDir;
    const abs = safeJoin(base, path.relative(base, fileUrl));
    if (!fs.existsSync(abs)) return res.status(404).json({ message: "Datei nicht gefunden" });
    audit(req, 'patient.file_open', {
      userId: req.user?.id,
      file: path.basename(abs),
      patientId: path.basename(path.dirname(abs)),
      ...clientMeta(req)
    });
    const cmd = process.platform === "win32" ? `start "" "${abs}"`
              : process.platform === "darwin" ? `open "${abs}"`
              : `xdg-open "${abs}"`;
    exec(cmd, (err) => err ? res.status(500).json({ message: "Fehler beim Öffnen der Datei" }) : res.json({ message: "Datei geöffnet" }));
  } catch {
    return res.status(400).json({ message: "Ungültiger Pfad" });
  }
});

// ── Rezepte: PDF immer in /patient-files/<PATIENT_ID> speichern
function formatDate(dateString) { const d = new Date(dateString); return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`; }

app.post("/api/rezept", authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  const { rezeptData, patientData } = req.body || {};
  try {
    const tenantCtx = req.tenant;
    if (!tenantCtx) return res.status(500).json({ success: false, error: 'Mandantenkontext fehlt' });

    const patientId = String(patientData?.id || '').trim();
    if (!patientId) return res.status(400).json({ success: false, error: "patientData.id fehlt" });

    const dir = safeJoin(tenantCtx.paths.patientFilesDir, patientId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o750 });

    const dateiname = `Rezept_${(patientData?.nachname||'Patient').replace(/[^\w.\-+]/g,'_')}_${Date.now()}.pdf`;
    const fullPath = path.join(dir, dateiname);

    const clinic = clinicMetaOf(tenantCtx);
    const recipeCfg = recipeMetaOf(tenantCtx);
    const address = clinic.address || {};
    const contact = clinic.contact || {};
    const headerTitle = recipeCfg.headerTitle || clinic.name || 'Rezept';
    const headerSubtitle = recipeCfg.headerSubtitle || clinic.subtitle || '';
    const footerText = recipeCfg.footer || [
      [clinic.name, clinic.subtitle].filter(Boolean).join(' • '),
      [address.street, address.houseNo].filter(Boolean).join(' '),
      [address.zip, address.city].filter(Boolean).join(' '),
      contact.email,
      contact.phone
    ].filter(Boolean).join(' • ');
    const signatureLabel = recipeCfg.signatureLabel || '';
    const signatureHint = recipeCfg.signatureHint || '';

    const contactBlock = [
      clinic.name,
      clinic.subtitle,
      [address.street, address.houseNo].filter(Boolean).join(' '),
      [address.zip, address.city, address.country || 'CH'].filter(Boolean).join(' '),
      contact.email,
      contact.phone,
      clinic.zsr ? `ZSR ${clinic.zsr}` : null,
      clinic.gln ? `GLN ${clinic.gln}` : null
    ].filter(Boolean).join('<br />');

    const logoSrc = getClinicLogoDataUrl(tenantCtx) || '';

    const html = `
      <html><head><meta charset="utf-8" />
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        .title { text-align:center; font-size:28px; background:#d9d9d9; padding:10px; }
        .subtitle { text-align:center; font-size:16px; margin-top:8px; color:#444; }
        .meta { margin-top:20px; }
        .table { width:100%; border-collapse: collapse; margin-top: 20px; }
        .table td { border:1px solid #000; padding: 10px; }
        .logo { text-align:center; margin-top: 50px; }
        .footer { margin-top:32px; text-align:center; font-size:12px; color:#555; }
        .signature { margin-top:48px; }
      </style></head>
      <body>
        <div class="title">${htmlEscape(headerTitle)}</div>
        ${headerSubtitle ? `<div class="subtitle">${htmlEscape(headerSubtitle)}</div>` : ''}
        <div class="meta">
          <div><strong>${htmlEscape(clinic.name || headerTitle)}</strong></div>
          <div>${contactBlock || ''}</div>
        </div>
        <div style="margin:16px 0;font-weight:bold">
          Patient: ${htmlEscape([patientData?.vorname, patientData?.nachname].filter(Boolean).join(' '))}
          ${patientData?.geburtsdatum ? `, Geb. ${htmlEscape(formatDate(patientData.geburtsdatum))}` : ''}
          ${patientData?.adresse ? `, Adr. ${htmlEscape(patientData.adresse)}` : ''}
        </div>
        <table class="table">
          <tr><td>${htmlEscape(rezeptData?.medikament||'')}</td><td>${htmlEscape(rezeptData?.dosierung||'')}</td></tr>
          <tr><td>${htmlEscape(rezeptData?.haeufigkeit||'')}</td><td>${htmlEscape(rezeptData?.dauer||'')}</td></tr>
        </table>
        ${rezeptData?.hinweise ? `<div>Hinweis: ${htmlEscape(rezeptData.hinweise)}</div>` : ""}
        <div class="signature">
          ${signatureLabel ? `<div>${htmlEscape(signatureLabel)}</div>` : ''}
          ${signatureHint ? `<div style="font-size:12px;color:#555;">${htmlEscape(signatureHint)}</div>` : ''}
        </div>
        <div class="logo">${logoSrc ? `<img src="${logoSrc}" width="300" />` : ''}</div>
        <div class="footer">${htmlEscape(footerText)}</div>
      </body></html>
    `;

    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: fullPath, format: "A4", printBackground: true });
    await browser.close();
    res.json({ success: true, file: fullPath });
  } catch (e) {
    console.error("Fehler beim Erstellen des PDFs:", e);
    res.status(500).json({ success: false, error: "PDF konnte nicht erstellt werden" });
  }
});

// ── Briefe (Arztbrief, OP-Bericht, etc.) ─────────────────────────────────────
const letters = require('./lib/letters/service');
const tasksService = require('./lib/tasks/service');

// List letters for a patient
app.get('/api/letters', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const patientId = Number(req.query.patient_id || req.query.patientId);
    if (!Number.isFinite(patientId)) return res.status(400).json({ message: 'patient_id fehlt' });
    const list = await letters.listLetters(tenantCtx, patientId);
    res.json({ items: list });
  } catch (err) {
    console.error('GET /api/letters failed', err);
    res.status(500).json({ message: 'Briefe konnten nicht geladen werden' });
  }
});

// Create a new letter (draft)
app.post('/api/letters', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const created = await letters.createLetter(tenantCtx, req.body || {}, req.user?.id || null);
    audit(req, 'letter.create', { userId: req.user?.id, letterId: created.id, patientId: created.patient_id, type: created.type, ...clientMeta(req) });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err?.message || 'Brief konnte nicht erstellt werden' });
  }
});

// Get letter by id
app.get('/api/letters/:id', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const letter = await letters.getLetter(tenantCtx, req.params.id);
    if (!letter) return res.status(404).json({ message: 'Brief nicht gefunden' });
    res.json(letter);
  } catch (err) {
    res.status(500).json({ message: 'Brief konnte nicht geladen werden' });
  }
});

// Update letter (title/type/content/status)
app.put('/api/letters/:id', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const updated = await letters.updateLetter(tenantCtx, req.params.id, req.body || {});
    audit(req, 'letter.update', { userId: req.user?.id, letterId: updated.id, status: updated.status, ...clientMeta(req) });
    res.json(updated);
  } catch (err) {
    const msg = err?.message || 'Brief konnte nicht aktualisiert werden';
    const code = msg.includes('nicht gefunden') ? 404 : 400;
    res.status(code).json({ message: msg });
  }
});

// Finalize letter and generate PDF
app.post('/api/letters/:id/finalize', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const letter = await letters.getLetter(tenantCtx, req.params.id);
    if (!letter) return res.status(404).json({ message: 'Brief nicht gefunden' });
    const { row, file } = await letters.finalizeLetter(tenantCtx, letter, APP_DIR);
    audit(req, 'letter.finalize', { userId: req.user?.id, letterId: row.id, pdf: file.relPath, ...clientMeta(req) });
    res.json({ ok: true, letter: row, pdf: `/patient-files/${file.relPath}` });
  } catch (err) {
    console.error('Finalize letter error', err);
    res.status(500).json({ message: 'Finalisieren fehlgeschlagen' });
  }
});

// Stream/download PDF for letter
app.get('/api/letters/:id/pdf', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const letter = await letters.getLetter(tenantCtx, req.params.id);
    if (!letter?.pdf_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    const base = tenantCtx.paths.patientFilesDir;
    const file = safeJoin(base, letter.pdf_path);
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'PDF nicht gefunden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="letter-${letter.id}.pdf"`);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});
app.get('/api/letters/:id/pdf/view', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const letter = await letters.getLetter(tenantCtx, req.params.id);
    if (!letter?.pdf_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    const base = tenantCtx.paths.patientFilesDir;
    const file = safeJoin(base, letter.pdf_path);
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'PDF nicht gefunden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="letter-${letter.id}.pdf"`);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});

// Delete letter (only drafts)
app.delete('/api/letters/:id', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    await letters.deleteLetter(tenantCtx, req.params.id);
    audit(req, 'letter.delete', { userId: req.user?.id, letterId: req.params.id, ...clientMeta(req) });
    res.json({ ok: true });
  } catch (err) {
    const msg = err?.message || 'Löschen fehlgeschlagen';
    const code = /nicht gefunden/i.test(msg) ? 404 : 400;
    res.status(code).json({ message: msg });
  }
});

// ── Krankmeldungen / Sick Notes (Arbeitsunfähigkeitszeugnis) ────────────────
const sickNotes = require('./lib/sicknotes/service');

// List sick notes for a patient
app.get('/api/sick-notes', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const patientId = Number(req.query.patient_id || req.query.patientId);
    if (!Number.isFinite(patientId)) return res.status(400).json({ message: 'patient_id fehlt' });
    const list = await sickNotes.listSickNotes(tenantCtx, patientId);
    res.json({ items: list });
  } catch (err) {
    console.error('GET /api/sick-notes failed', err);
    res.status(500).json({ message: 'Krankmeldungen konnten nicht geladen werden' });
  }
});

// Create sick note (draft)
app.post('/api/sick-notes', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const created = await sickNotes.createSickNote(tenantCtx, req.body || {}, req.user?.id || null);
    audit(req, 'sicknote.create', { userId: req.user?.id, noteId: created.id, patientId: created.patient_id, ...clientMeta(req) });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ message: err?.message || 'Krankmeldung konnte nicht erstellt werden' });
  }
});

// Get sick note by id
app.get('/api/sick-notes/:id', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const note = await sickNotes.getSickNote(tenantCtx, req.params.id);
    if (!note) return res.status(404).json({ message: 'Krankmeldung nicht gefunden' });
    res.json(note);
  } catch {
    res.status(500).json({ message: 'Krankmeldung konnte nicht geladen werden' });
  }
});

// Update sick note
app.put('/api/sick-notes/:id', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const updated = await sickNotes.updateSickNote(tenantCtx, req.params.id, req.body || {});
    audit(req, 'sicknote.update', { userId: req.user?.id, noteId: updated.id, status: updated.status, ...clientMeta(req) });
    res.json(updated);
  } catch (err) {
    const msg = err?.message || 'Krankmeldung konnte nicht aktualisiert werden';
    const code = msg.includes('nicht gefunden') ? 404 : 400;
    res.status(code).json({ message: msg });
  }
});

// Finalize sick note and generate PDF
app.post('/api/sick-notes/:id/finalize', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const note = await sickNotes.getSickNote(tenantCtx, req.params.id);
    if (!note) return res.status(404).json({ message: 'Krankmeldung nicht gefunden' });
    const { row, file } = await sickNotes.finalizeSickNote(tenantCtx, note, APP_DIR);
    audit(req, 'sicknote.finalize', { userId: req.user?.id, noteId: row.id, pdf: file.relPath, ...clientMeta(req) });
    res.json({ ok: true, note: row, pdf: `/patient-files/${file.relPath}` });
  } catch (err) {
    console.error('Finalize sick note error', err);
    res.status(500).json({ message: 'Finalisieren fehlgeschlagen' });
  }
});

// Stream/download PDF for sick note
app.get('/api/sick-notes/:id/pdf', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const note = await sickNotes.getSickNote(tenantCtx, req.params.id);
    if (!note?.pdf_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    const base = tenantCtx.paths.patientFilesDir;
    const file = safeJoin(base, note.pdf_path);
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'PDF nicht gefunden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sicknote-${note.id}.pdf"`);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});
app.get('/api/sick-notes/:id/pdf/view', authenticateToken, requireRole('admin','arzt','assistenz'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const note = await sickNotes.getSickNote(tenantCtx, req.params.id);
    if (!note?.pdf_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    const base = tenantCtx.paths.patientFilesDir;
    const file = safeJoin(base, note.pdf_path);
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'PDF nicht gefunden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sicknote-${note.id}.pdf"`);
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});

// ── Aufgaben / Tasks ─────────────────────────────────────────────────────────
// Unread badge count for current user within tenant
app.get('/api/tasks/unreadCount', authenticateToken, requirePermission('tasks.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const statuses = (req.query.status || '').split(',').map(s => s.trim()).filter(Boolean);
    const count = await tasksService.unreadCount(tenantCtx, req.user?.id, statuses.length ? statuses : ['OPEN','IN_PROGRESS']);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Unread-Count konnte nicht ermittelt werden' });
  }
});

// List tasks with filters + pagination
app.get('/api/tasks', authenticateToken, requirePermission('tasks.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const q = req.query || {};
    const filters = {
      assignedToUserId: q.assigned_to_user_id ? Number(q.assigned_to_user_id) : (q.assignedToUserId ? Number(q.assignedToUserId) : undefined),
      createdByUserId: q.created_by_user_id ? Number(q.created_by_user_id) : (q.createdByUserId ? Number(q.createdByUserId) : undefined),
      status: q.status ? String(q.status).split(',') : undefined,
      priority: q.priority ? String(q.priority).split(',') : undefined,
      type: q.type || undefined,
      patientId: q.patient_id ? Number(q.patient_id) : (q.patientId ? Number(q.patientId) : undefined),
      search: q.q || q.search || undefined,
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
    };
    const list = await tasksService.listTasks(tenantCtx, filters, req.user, req.user?.role || req.user?.rolle);
    res.json({ items: list });
  } catch (err) {
    console.error('GET /api/tasks failed:', err?.message || err);
    res.status(500).json({ message: 'Aufgaben konnten nicht geladen werden' });
  }
});

// Create task
app.post('/api/tasks', authenticateToken, requirePermission('tasks.write', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const row = await tasksService.createTask(tenantCtx, req.body || {}, req.user?.id || null);
    audit(req, 'task.create', { userId: req.user?.id, taskId: row.id, assigned: row.assigned_to_user_id, ...clientMeta(req) });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ message: err?.message || 'Aufgabe konnte nicht erstellt werden' });
  }
});

// Get single task with comments/attachments
app.get('/api/tasks/:id', authenticateToken, requirePermission('tasks.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const dto = await tasksService.getTask(tenantCtx, req.params.id);
    if (!dto) return res.status(404).json({ message: 'Aufgabe nicht gefunden' });
    // Auto-mark read if assignee opens
    if (dto.task?.assigned_to_user_id && dto.task.assigned_to_user_id === req.user?.id && !dto.task.read_at_assignee) {
      try { await tasksService.markTaskRead(tenantCtx, dto.task.id, req.user.id); } catch (_) {}
    }
    res.json(dto);
  } catch (err) {
    res.status(500).json({ message: 'Aufgabe konnte nicht geladen werden' });
  }
});

// Update task (PATCH/PUT supported)
const updateTaskHandler = async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const updated = await tasksService.updateTask(tenantCtx, req.params.id, req.body || {}, req.user || null);
    audit(req, 'task.update', { userId: req.user?.id, taskId: updated.id, status: updated.status, assigned: updated.assigned_to_user_id, ...clientMeta(req) });
    res.json(updated);
  } catch (err) {
    const msg = err?.message || 'Aufgabe konnte nicht aktualisiert werden';
    const code = /nicht gefunden/i.test(msg) ? 404 : 400;
    res.status(code).json({ message: msg });
  }
};
app.patch('/api/tasks/:id', authenticateToken, requirePermission('tasks.write', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), updateTaskHandler);
app.put('/api/tasks/:id', authenticateToken, requirePermission('tasks.write', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), updateTaskHandler);

// Add comment to task
app.post('/api/tasks/:id/comments', authenticateToken, requirePermission('tasks.write', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const comment = await tasksService.addComment(tenantCtx, req.params.id, req.body?.comment_text || req.body?.commentText, req.user?.id || null);
    audit(req, 'task.comment', { userId: req.user?.id, taskId: Number(req.params.id), commentId: comment.id, ...clientMeta(req) });
    res.status(201).json(comment);
  } catch (err) {
    const msg = err?.message || 'Kommentar konnte nicht hinzugefügt werden';
    const code = /nicht gefunden/i.test(msg) ? 404 : 400;
    res.status(code).json({ message: msg });
  }
});

// Mark task as read for assignee
app.post('/api/tasks/:id/read', authenticateToken, requirePermission('tasks.read', 'admin', 'arzt', 'assistenz', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const row = await tasksService.markTaskRead(tenantCtx, req.params.id, req.user?.id);
    if (!row) return res.status(404).json({ message: 'Aufgabe nicht gefunden oder nicht zugewiesen' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: 'Aufgabe konnte nicht markiert werden' });
  }
});

// ── Termine / Appointments
async function canWriteCalendar({ db, tenantId, calendarId, userId, isAdmin }) {
  const { rows } = await db.query(
    `SELECT id, type
       FROM calendars
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1`,
    [calendarId, tenantId]
  );
  if (!rows.length) return { ok: false, reason: 'not_found' };
  if (rows[0].type === 'tenant' || isAdmin) return { ok: true, type: rows[0].type };
  const { rows: memberRows } = await db.query(
    `SELECT 1
       FROM calendar_members
      WHERE calendar_id = $1
        AND user_id = $2
        AND role IN ('owner', 'editor')
      LIMIT 1`,
    [calendarId, userId]
  );
  if (!memberRows.length) return { ok: false, reason: 'forbidden' };
  return { ok: true, type: rows[0].type };
}

async function canWriteAppointment({ db, tenantId, appointmentId, userId, isAdmin }) {
  const { rows } = await db.query(
    `SELECT a.calendar_id, c.type
       FROM appointments a
       JOIN calendars c
         ON c.id = a.calendar_id
        AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.id = $2
      LIMIT 1`,
    [tenantId, appointmentId]
  );
  if (!rows.length) return { ok: false, reason: 'not_found' };
  if (rows[0].type === 'tenant' || isAdmin) return { ok: true, calendarId: rows[0].calendar_id };
  const { rows: memberRows } = await db.query(
    `SELECT 1
       FROM calendar_members
      WHERE calendar_id = $1
        AND user_id = $2
        AND role IN ('owner', 'editor')
      LIMIT 1`,
    [rows[0].calendar_id, userId]
  );
  if (!memberRows.length) return { ok: false, reason: 'forbidden' };
  return { ok: true, calendarId: rows[0].calendar_id };
}

// New: load by calendar IDs and time window (Outlook-style overlay)
app.get('/api/appointments/by-calendars', maybeAuth, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const tenantId = req.tenant.id;
    const userId = Number(req.user?.id) || 0;
    const isAdmin = isAdminAuth(req);
    const idsParam = String(req.query.ids || '').trim();
    if (!idsParam) return res.status(400).json({ message: 'ids erforderlich' });
    const idList = idsParam.split(',').map(s => s.trim()).filter(Boolean).map(v => BigInt(v));
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ message: 'from/to erforderlich (ISO8601)' });
    }
    if (from > to) return res.status(400).json({ message: 'from muss <= to sein' });
    const maxWindowMs = 90 * 24 * 60 * 60 * 1000;
    if ((to.getTime() - from.getTime()) > maxWindowMs) {
      return res.status(400).json({ message: 'Zeitraum zu groß (max 90 Tage)' });
    }
    let limit = Number(req.query.limit || 500);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    limit = Math.min(limit, 1000);

    const params = [tenantId, idList];
    let i = params.length;
    const rangeConds = [];
    params.push(from); rangeConds.push(`a.starts_at >= $${++i}`);
    params.push(to);   rangeConds.push(`a.starts_at <= $${++i}`);

    // Keyset pagination via cursor="<ISO>_<id>"
    const cursor = String(req.query.cursor || '').trim();
    let hasCursor = false;
    if (cursor) {
      const parts = cursor.split('_');
      if (parts.length === 2) {
        const cDate = new Date(parts[0]);
        const cId = Number(parts[1]);
        if (!Number.isNaN(cDate.getTime()) && Number.isFinite(cId)) {
          params.push(cDate); params.push(cId);
          rangeConds.push(`(a.starts_at, a.id) > ($${++i - 1}::timestamptz, $${i}::bigint)`);
          hasCursor = true;
        }
      }
    }

    // Enforce access: tenant + membership for non-tenant calendars
    const sql = `
      SELECT a.*, p.name AS patient_name, p.vorname, p.nachname
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
        JOIN calendars c ON c.id = a.calendar_id
       WHERE a.tenant_id = $1
         AND a.calendar_id = ANY($2)
         ${rangeConds.length ? ' AND ' + rangeConds.join(' AND ') : ''}
         AND (
           $${++i}::boolean = true
           OR c.type = 'tenant'
           OR EXISTS (
             SELECT 1 FROM calendar_members m WHERE m.calendar_id = a.calendar_id AND m.user_id = $${++i}
           )
         )
       ORDER BY a.starts_at ASC, a.id ASC
       LIMIT $${++i}`;
    params.push(isAdmin);
    params.push(userId);
    params.push(limit + 1); // fetch one extra to signal next_cursor
    const { rows } = await req.tenant.db.query(sql, params);
    let next_cursor = null;
    let page = rows;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      next_cursor = `${new Date(last.starts_at).toISOString()}_${last.id}`;
      page = rows.slice(0, limit);
    }
    res.set('Cache-Control', 'no-store, private');
    res.set('Pragma', 'no-cache');
    res.json({ items: page.map(toAppointmentDto), next_cursor });
  } catch (err) {
    console.error('Appointments by-calendars failed:', err?.message || err);
    res.status(500).json({ message: 'Termine konnten nicht geladen werden' });
  }
});
app.get('/api/appointments', maybeAuth, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const q = req.query || {};
    const type = String(q.type || '').toLowerCase();
    const userFilter = q.user_id ? Number(q.user_id) : null;
    const patientFilter = q.patient_id ? Number(q.patient_id) : null;
    // If no legacy filters were provided and no patient filter, ask client to use by-calendars endpoint
    if (!type && !Number.isFinite(userFilter) && !Number.isFinite(patientFilter)) {
      return res.status(400).json({ message: 'Bitte /api/appointments/by-calendars verwenden' });
    }

    const conds = ['a.tenant_id = $1'];
    const params = [req.tenant.id];
    let i = params.length;

    if (Number.isFinite(patientFilter)) {
      conds.push(`a.patient_id = $${++i}`);
      params.push(patientFilter);
    }

    if (type === 'general') {
      // Backward compatibility: treat NULL source as 'general'
      conds.push(`COALESCE(a.source,'general') = 'general'`);
      if (userFilter && Number.isFinite(userFilter)) {
        conds.push(`a.user_id = $${++i}`);
        params.push(userFilter);
      }
    } else if (Number.isFinite(userFilter)) {
      // user calendar: explicit user-source OR general assigned to that user (including legacy via doctor_id)
      const next = ++i; params.push(userFilter);
      conds.push(`( (a.source = 'user' AND a.user_id = $${next})
                   OR (COALESCE(a.source,'general') = 'general' AND a.user_id = $${next})
                   OR (a.user_id IS NULL AND a.doctor_id = $${next}) )`);
    }

    let rows;
    try {
      ({ rows } = await req.tenant.db.query(
        `SELECT a.*,
                p.name AS patient_name,
                p.vorname,
                p.nachname,
                u.name AS doctor_name,
                u.email AS doctor_email
           FROM appointments a
           LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
           LEFT JOIN users u ON u.id = a.doctor_id AND u.tenant_id = a.tenant_id
          WHERE ${conds.join(' AND ')}
          ORDER BY a.starts_at NULLS LAST, a.id ASC`,
        params
      ));
    } catch (e) {
      // Fallback for legacy schema without source/user_id columns
      const fbConds = ['a.tenant_id = $1'];
      const fbParams = [req.tenant.id];
      let j = fbParams.length;
      if (Number.isFinite(userFilter)) { fbConds.push(`a.doctor_id = $${++j}`); fbParams.push(userFilter); }
      if (Number.isFinite(patientFilter)) { fbConds.push(`a.patient_id = $${++j}`); fbParams.push(patientFilter); }
      ({ rows } = await req.tenant.db.query(
        `SELECT a.*,
                p.name AS patient_name,
                p.vorname,
                p.nachname,
                u.name AS doctor_name,
                u.email AS doctor_email
           FROM appointments a
           LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
           LEFT JOIN users u ON u.id = a.doctor_id AND u.tenant_id = a.tenant_id
          WHERE ${fbConds.join(' AND ')}
          ORDER BY a.starts_at NULLS LAST, a.id ASC`,
        fbParams
      ));
    }
    res.set('Cache-Control', 'no-store, private');
    res.set('Pragma', 'no-cache');
    res.json(rows.map(toAppointmentDto));
  } catch (err) {
    console.error('Appointment listing failed:', err);
    res.status(500).json({ message: 'Fehler beim Abrufen der Termine' });
  }
});

app.post('/api/appointments', maybeAuth, requirePermission('appointments.write', 'admin', 'doctor', 'assistant'), async (req, res) => {
  const body = req.body || {};
  const requesterId = Number(req.user?.id) || 0;
  const isAdmin = isAdminAuth(req);
  // DTO whitelist + trims
  const allowedKeys = new Set(['calendar_id','patient_id','starts_at','termin_datum','startzeit','end_time','duration_minutes','duration','reason','beschreibung','status','type','source','user_id','doctor_id','doctorId','doctor_email','doctorEmail']);
  const unknown = Object.keys(body).filter(k => !allowedKeys.has(k));
  if (unknown.length) return res.status(400).json({ message: 'Unbekannte Felder' });
  const patientIdRaw = body.patient_id || body.patientId;
  const patientId = Number(patientIdRaw);
  // patient_id ist optional
  if (patientIdRaw !== undefined && !Number.isFinite(patientId)) {
    return res.status(400).json({ message: 'Ungültige Patienten-ID' });
  }
  let calendarId = Number(body.calendar_id);
  if (!Number.isFinite(calendarId)) {
    // Fallback: use default tenant calendar or create one
    const { rows: calDefaults } = await req.tenant.db.query(
      `SELECT id FROM calendars
         WHERE tenant_id = $1
         ORDER BY (is_default = true) DESC, id ASC
         LIMIT 1`,
      [req.tenant.id]
    );
    if (calDefaults.length) {
      calendarId = calDefaults[0].id;
    } else {
      const { rows: created } = await req.tenant.db.query(
        `INSERT INTO calendars(tenant_id, name, type, is_default)
         VALUES ($1, 'Allgemeiner Kalender', 'tenant', true)
         RETURNING id`,
        [req.tenant.id]
      );
      calendarId = created[0].id;
    }
  }

  let startsAt = body.starts_at || body.start_time || null;
  if (!startsAt && body.termin_datum) {
    startsAt = `${body.termin_datum}T${body.startzeit || '09:00:00'}`;
  }
  if (!startsAt) {
    return res.status(400).json({ message: 'Startzeit erforderlich' });
  }
  const startsDate = new Date(startsAt);
  if (Number.isNaN(startsDate.getTime())) {
    return res.status(400).json({ message: 'Ungültige Startzeit' });
  }

  let duration = Number(body.duration_minutes || body.duration || 30);
  if (!Number.isFinite(duration) || duration <= 0) duration = 30;

  let endDate = null;
  if (body.end_time) {
    const parsed = new Date(body.end_time);
    if (!Number.isNaN(parsed.getTime())) {
      endDate = parsed;
      duration = Math.max(15, Math.round((parsed.getTime() - startsDate.getTime()) / 60000));
    }
  } else {
    endDate = new Date(startsDate.getTime() + duration * 60000);
  }

  let reason = (body.reason || body.termin_name || body.beschreibung || 'Termin').toString().trim();
  if (reason.length > 500) reason = reason.slice(0,500);
  const status = (body.status || 'scheduled').toLowerCase();
  const normalizedStatus = ['scheduled','completed','cancelled'].includes(status) ? status : 'scheduled';
  const source = (body.type || body.source || 'general').toLowerCase() === 'user' ? 'user' : 'general';
  const doctorId = await resolveDoctorId(req.tenant, body.doctor_id || body.doctorId || body.doctorEmail || body.doctor_email, req.user);
  const userId = Number(body.user_id) && Number.isFinite(Number(body.user_id)) ? Number(body.user_id) : null;
  const beschreibung = body.beschreibung ? String(body.beschreibung).trim().slice(0,2000) : null;

  try {
    const access = await canWriteCalendar({
      db: req.tenant.db,
      tenantId: req.tenant.id,
      calendarId,
      userId: requesterId,
      isAdmin
    });
    if (!access.ok) {
      if (access.reason === 'not_found') return res.status(404).json({ message: 'Kalender nicht gefunden' });
      return res.status(403).json({ message: 'Keine Schreibrechte auf diesen Kalender' });
    }
    let rows;
    // Insert with optional patient_id
    ({ rows } = await req.tenant.db.query(
      `INSERT INTO appointments (
         tenant_id, calendar_id, patient_id, doctor_id, user_id, source, starts_at, duration_minutes, reason, status,
         termin_name, beschreibung, termin_datum, startzeit, endzeit
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $9,$11,$12,$13,$14
       )
       RETURNING *`,
      [
        req.tenant.id,
        calendarId,
        Number.isFinite(patientId) ? patientId : null,
        doctorId,
        userId,
        source,
        startsDate,
        duration,
        reason,
        normalizedStatus,
        beschreibung,
        startsDate.toISOString().slice(0, 10),
        startsDate.toISOString().slice(11, 19),
        endDate ? endDate.toISOString().slice(11, 19) : null
      ]
    ));
    const appointment = rows[0];
    await audit(req, 'calendar.appointment.created', { appointmentId: appointment.id, patientId, userId, ...clientMeta(req) });
    res.status(201).json(toAppointmentDto(appointment));
  } catch (err) {
    console.error('Appointment creation failed:', { code: err?.code, constraint: err?.constraint, message: err?.message });
    if (err && err.code === '23505') {
      return res.status(409).json({ message: 'Konflikt: Termin existiert bereits (Kalender/Patient/Zeit).' });
    }
    if (err && err.code === '23503') {
      const msg = String(err?.detail || '').toLowerCase();
      if (msg.includes('patient_id')) return res.status(400).json({ message: 'Patient nicht gefunden.' });
      if (msg.includes('calendar_id')) return res.status(400).json({ message: 'Kalender nicht gefunden.' });
    }
    res.status(500).json({ message: 'Eintrag fehlgeschlagen' });
  }
});

// Update appointment (time move, edits) and keep semantics
app.put('/api/appointments/:id', maybeAuth, requirePermission('appointments.write', 'admin', 'doctor', 'assistant'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige ID' });
  const requesterId = Number(req.user?.id) || 0;
  const isAdmin = isAdminAuth(req);
  const body = req.body || {};
  const allowedKeys = new Set(['calendar_id','starts_at','duration_minutes','reason','beschreibung','status','type','source','user_id','patient_id']);
  const unknown = Object.keys(body).filter(k => !allowedKeys.has(k));
  if (unknown.length) return res.status(400).json({ message: 'Unbekannte Felder' });
  const sourceAccess = await canWriteAppointment({
    db: req.tenant.db,
    tenantId: req.tenant.id,
    appointmentId: id,
    userId: requesterId,
    isAdmin
  });
  if (!sourceAccess.ok) {
    if (sourceAccess.reason === 'not_found') return res.status(404).json({ message: 'Termin nicht gefunden' });
    return res.status(403).json({ message: 'Keine Schreibrechte auf diesen Kalender' });
  }
  const fields = [];
  const params = [req.tenant.id, id];
  let i = params.length;
  if (body.starts_at) { fields.push(`starts_at = $${++i}`); params.push(new Date(body.starts_at)); }
  if (body.duration_minutes) { fields.push(`duration_minutes = $${++i}`); params.push(Number(body.duration_minutes)); }
  if (body.reason !== undefined) { let r = String(body.reason||'').trim(); if (r.length>500) r=r.slice(0,500); fields.push(`reason = $${++i}`); params.push(r || null); }
  if (body.status) { fields.push(`status = $${++i}`); params.push(String(body.status).toLowerCase()); }
  if (body.beschreibung !== undefined || body.description !== undefined) { let b = String(body.beschreibung || body.description || '').trim(); if (b.length>2000) b=b.slice(0,2000); fields.push(`beschreibung = $${++i}`); params.push(b || null); }
  if (body.user_id !== undefined) { fields.push(`user_id = $${++i}`); params.push(Number(body.user_id) || null); }
  if (body.patient_id !== undefined) { fields.push(`patient_id = $${++i}`); params.push(Number(body.patient_id) || null); }
  if (body.source !== undefined || body.type !== undefined) {
    const src = (body.type || body.source || '').toLowerCase();
    if (src === 'general' || src === 'user') { fields.push(`source = $${++i}`); params.push(src); }
  }
  if (body.calendar_id !== undefined) {
    const newCalId = Number(body.calendar_id);
    if (!Number.isFinite(newCalId)) return res.status(400).json({ message: 'Ungültiger calendar_id' });
    const targetAccess = await canWriteCalendar({
      db: req.tenant.db,
      tenantId: req.tenant.id,
      calendarId: newCalId,
      userId: requesterId,
      isAdmin
    });
    if (!targetAccess.ok) {
      if (targetAccess.reason === 'not_found') return res.status(404).json({ message: 'Kalender nicht gefunden' });
      return res.status(403).json({ message: 'Keine Schreibrechte auf diesen Kalender' });
    }
    fields.push(`calendar_id = $${++i}`); params.push(newCalId);
  }
  if (!fields.length) return res.status(400).json({ message: 'Keine Änderungen' });
  try {
    const { rows } = await req.tenant.db.query(
      `UPDATE appointments SET ${fields.join(', ')}
        WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ message: 'Termin nicht gefunden' });
    await audit(req, 'calendar.appointment.updated', { appointmentId: id, ...clientMeta(req) });
    res.json(toAppointmentDto(rows[0]));
  } catch (err) {
    console.error('Appointment update failed:', err);
    res.status(500).json({ message: 'Aktualisierung fehlgeschlagen' });
  }
});

app.delete('/api/appointments/:id', maybeAuth, requirePermission('appointments.write', 'admin', 'doctor'), async (req, res) => {
  try {
    const access = await canWriteAppointment({
      db: req.tenant.db,
      tenantId: req.tenant.id,
      appointmentId: Number(req.params.id),
      userId: Number(req.user?.id) || 0,
      isAdmin: isAdminAuth(req)
    });
    if (!access.ok) {
      if (access.reason === 'not_found') return res.status(404).json({ message: 'Termin nicht gefunden' });
      return res.status(403).json({ message: 'Keine Schreibrechte auf diesen Kalender' });
    }
    const { rows } = await req.tenant.db.query(
      `DELETE FROM appointments
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *`,
      [req.tenant.id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Termin nicht gefunden' });
    await audit(req, 'calendar.appointment.deleted', { appointmentId: req.params.id, ...clientMeta(req) });
    res.status(200).json({ message: 'Termin erfolgreich gelöscht' });
  } catch (err) {
    console.error('Appointment deletion failed:', err);
    res.status(500).json({ message: 'Fehler beim Löschen des Termins' });
  }
});

// Accessible users for calendar switching
app.get('/api/users/accessible', maybeAuth, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const role = String(req.user?.role || req.user?.rolle || '').toLowerCase();
    if (role === 'admin' || role === 'doctor') {
      const { rows } = await req.tenant.db.query(
        `SELECT id, name, vorname, nachname, email, role FROM users WHERE tenant_id = $1 ORDER BY name NULLS LAST, vorname NULLS LAST, id`,
        [req.tenant.id]
      );
      res.json(rows.map(u => ({ id: u.id, name: u.name || [u.vorname, u.nachname].filter(Boolean).join(' ') || u.email, role: u.role })));
    } else {
      res.json([{ id: req.user.id, name: req.user.name || [req.user.vorname, req.user.nachname].filter(Boolean).join(' ') || req.user.email, role: req.user.role }]);
    }
  } catch (err) {
    console.error('Accessible users failed:', err);
    res.status(500).json({ message: 'Nutzerliste konnte nicht geladen werden' });
  }
});

// ── Doctor Directory (Sparte/Dignität) – nur Admin/Assistenz editierbar, Ärzte lesen
app.get('/api/doctors', maybeAuth, requirePermission('appointments.read', 'admin', 'doctor', 'assistant'), async (req, res) => {
  try {
    const { rows } = await req.tenant.db.query(
      `SELECT id, name, vorname, nachname, email, role, metadata, created_at, updated_at
         FROM users
        WHERE tenant_id = $1 AND role = 'doctor'
        ORDER BY name NULLS LAST, vorname NULLS LAST, id`,
      [req.tenant.id]
    );
    const mapped = rows.map((u) => {
      const meta = u.metadata || {};
      return {
        id: u.id,
        name: u.name || [u.vorname, u.nachname].filter(Boolean).join(' ') || u.email,
        vorname: u.vorname || '',
        nachname: u.nachname || '',
        email: u.email || '',
        role: u.role,
        fachrichtung: meta.fachrichtung || '',
        sparte: meta.sparte || '',
        dignitaet: meta.dignitaet || '',
        aktiv: meta.aktiv !== false, // default true
        created_at: u.created_at,
        updated_at: u.updated_at
      };
    });
    res.json(mapped);
  } catch (err) {
    console.error('List doctors failed:', err);
    res.status(500).json({ message: 'Ärzte konnten nicht geladen werden' });
  }
});

app.put('/api/doctors/:id', maybeAuth, requirePermission('users.manage', 'admin', 'assistant'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Ungültige ID' });
    const { rows } = await req.tenant.db.query(
      `SELECT id, role, metadata, name, vorname, nachname, email FROM users WHERE tenant_id = $1 AND id = $2`,
      [req.tenant.id, id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Arzt nicht gefunden' });
    const existing = rows[0];
    if (String(existing.role).toLowerCase() !== 'doctor') return res.status(400).json({ message: 'Nur Arzt-Konten bearbeitbar' });

    const payload = req.body || {};
    const meta = existing.metadata || {};
    const updatedMeta = {
      ...meta,
      fachrichtung: payload.fachrichtung ?? meta.fachrichtung ?? '',
      sparte: payload.sparte ?? meta.sparte ?? '',
      dignitaet: payload.dignitaet ?? meta.dignitaet ?? '',
      aktiv: payload.aktiv !== false
    };
    const newName = payload.name || existing.name;
    const newVorname = payload.vorname ?? existing.vorname;
    const newNachname = payload.nachname ?? existing.nachname;

    const { rows: updated } = await req.tenant.db.query(
      `UPDATE users
          SET name = $3,
              vorname = $4,
              nachname = $5,
              metadata = $6,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      RETURNING id, name, vorname, nachname, email, role, metadata, created_at, updated_at`,
      [req.tenant.id, id, newName, newVorname, newNachname, updatedMeta]
    );
    const u = updated[0];
    const metaOut = u.metadata || {};
    res.json({
      id: u.id,
      name: u.name || [u.vorname, u.nachname].filter(Boolean).join(' ') || u.email,
      vorname: u.vorname || '',
      nachname: u.nachname || '',
      email: u.email || '',
      role: u.role,
      fachrichtung: metaOut.fachrichtung || '',
      sparte: metaOut.sparte || '',
      dignitaet: metaOut.dignitaet || '',
      aktiv: metaOut.aktiv !== false,
      created_at: u.created_at,
      updated_at: u.updated_at
    });
  } catch (err) {
    console.error('Update doctor failed:', err);
    res.status(500).json({ message: 'Arzt konnte nicht aktualisiert werden' });
  }
});

// (no calendars or external calendar integration routes in original)

// ── TARMED (nur noch für Hilfesuche, nicht abrechenbar)
const tarmedPath = path.join(APP_DIR, "tarmed_codes.json");
const tarmedData = fs.existsSync(tarmedPath) ? JSON.parse(fs.readFileSync(tarmedPath, "utf8")) : [];
const byCode = {}; tarmedData.forEach(item => { if (item.code) byCode[item.code] = item; });

// ── TARDOC + ambulante Pauschalen (In-Memory Katalog)
const loadJsonSafe = (file, fallback = []) => {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`Warn: konnte ${file} nicht laden:`, err.message || err);
    return fallback;
  }
};
const SPECIAL_RULES = loadJsonSafe(path.join(__dirname, 'Tardoc', 'special_rules.json'), []);
const HEURISTIC_RULES = loadJsonSafe(path.join(__dirname, 'Tardoc', 'heuristic_rules.json'), []);
const SPECIAL_RULES_BY_CODE = new Map();
SPECIAL_RULES.forEach((r) => {
  const code = String(r.code || '').trim();
  if (!code) return;
  const arr = SPECIAL_RULES_BY_CODE.get(code) || [];
  arr.push(r);
  SPECIAL_RULES_BY_CODE.set(code, arr);
});
const HEURISTIC_RULES_BY_CODE = new Map();
HEURISTIC_RULES.forEach((r) => {
  const code = String(r.code || '').trim();
  if (!code) return;
  const arr = HEURISTIC_RULES_BY_CODE.get(code) || [];
  arr.push(r);
  HEURISTIC_RULES_BY_CODE.set(code, arr);
});

const TARDOC_CATALOG = (() => {
  try {
    const cat = initTariffCatalog(APP_DIR);
    if (cat?.warnings?.length) {
      console.warn('TARDOC catalog loaded with warnings:', cat.warnings.join('; '));
    }
    return cat;
  } catch (err) {
    console.warn('TARDOC catalog could not be loaded:', err?.message || err);
    return { service: [], tardoc_positions: [], pauschalen: [], versions: {}, warnings: [String(err?.message || err)] };
  }
})();
app.locals.tardocCatalog = TARDOC_CATALOG;

// Quick lookup index for TARDOC/Pauschalen
const TARDOC_INDEX = (() => {
  const service = Array.isArray(TARDOC_CATALOG.service) ? TARDOC_CATALOG.service : [];

  // Duplikate im TARDOC-Sheet: bevorzugt die Variante mit echten AL/IPL-Punkten, damit leere Kopien nicht gute Daten überschreiben.
  const tardocMap = new Map();
  (TARDOC_CATALOG.tardoc_positions || []).forEach((p) => {
    const key = String(p.code);
    const current = tardocMap.get(key);
    const hasPoints = Number(p.al_norm || 0) + Number(p.ipl_norm || 0) > 0;
    const currentHasPoints = current && (Number(current.al_norm || 0) + Number(current.ipl_norm || 0) > 0);
    if (!current || (hasPoints && !currentHasPoints)) {
      tardocMap.set(key, p);
    }
  });

  const pauschaleMap = new Map((TARDOC_CATALOG.pauschalen || []).map((p) => [String(p.code), p]));
  const serviceMap = new Map(service.map((s) => [String(s.code), s]));
  const cache = new Map();

  function normalize(code) {
    const key = String(code);
    if (cache.has(key)) return cache.get(key);
    const svc = serviceMap.get(key) || {};
    const tard = tardocMap.get(key);
    const pa = pauschaleMap.get(key);
    if (!svc && !tard && !pa) return null;
    const kind = pa ? 'pauschale' : 'tardoc';
    const al_points = Number(tard?.al_norm || 0);
    const tl_points = Number(tard?.ipl_norm || 0);
    const taxpoints = pa ? Number(pa.taxpoints || 0) : Number(al_points + tl_points);
    const special_rules = SPECIAL_RULES_BY_CODE.get(key) || [];
    const heuristic_rules = HEURISTIC_RULES_BY_CODE.get(key) || [];
    const hasZeroPoints = kind === 'tardoc' ? (Number(al_points + tl_points) === 0) : false;
    const hasZeroTax = kind === 'pauschale' ? taxpoints === 0 : false;
    const special_flags = [];
    if (kind === 'tardoc' && (special_rules.some((r) => r.rule === 'zero_al_ipl') || hasZeroPoints)) {
      special_flags.push('zero_al_ipl');
    }
    if (kind === 'pauschale' && (special_rules.some((r) => r.rule === 'pauschale_zero_tax') || hasZeroTax)) {
      special_flags.push('pauschale_zero_tax');
    }
    if (special_rules.some((r) => r.rule === 'percentage_surcharge')) special_flags.push('percentage_surcharge');
    if (special_rules.some((r) => r.rule === 'pathology_counter')) special_flags.push('pathology_counter');
    const text = (tard?.text || pa?.text || svc.short_text || '').trim();
    const normalized = {
      code: key,
      kind,
      type: svc.type || (pa ? 'P' : 'E'),
      text,
      title: text,
      short_text: svc.short_text || text,
      med_interpretation: svc.med_interpretation || tard?.interpretation || pa?.note || '',
      master_code: svc.master_code || null,
      linked_code: svc.linked_code || null,
      lateralitaet: svc.lateralitaet || null,
      is_time_based: Boolean(svc.is_time_based),
      is_handlung: Boolean(svc.is_handlung),
      is_groupable: svc.is_groupable !== false,
      al_points,
      tl_points,
      taxpoints,
      sparte: tard?.sparte || null,
      qual_dignitaet: tard?.qual_dignitaet || pa?.dignitaeten || null,
      rules_text: tard?.rules_text || '',
      note: pa?.note || '',
      special_rules,
      heuristic_rules,
      special_flags
    };
    cache.set(key, normalized);
    return normalized;
  }

  function search(query, parent_code, kind) {
    const q = String(query || '').trim().toLowerCase();
    const results = [];
    service.forEach((svc) => {
      if (parent_code && String(svc.master_code || '').toLowerCase() !== String(parent_code).toLowerCase()) return;
      const item = normalize(svc.code);
      if (kind && item.kind !== kind) return;
      if (!q) { results.push(item); return; }
      const txt = (item.text || '').toLowerCase();
      if (item.code.toLowerCase().includes(q) || txt.includes(q)) results.push(item);
    });
    // If search was provided but service list misses direct tardoc/pauschale extras, include direct matches too
    if (q) {
      tardocMap.forEach((_val, code) => {
        if (!serviceMap.has(code)) {
          const item = normalize(code);
          if (item.code.toLowerCase().includes(q) || (item.text || '').toLowerCase().includes(q)) results.push(item);
        }
      });
      pauschaleMap.forEach((_val, code) => {
        if (!serviceMap.has(code)) {
          const item = normalize(code);
          if (item.code.toLowerCase().includes(q) || (item.text || '').toLowerCase().includes(q)) results.push(item);
        }
      });
    }
    return results;
  }

  function buildTree(code) {
    const item = normalize(code);
    if (!item) return null;
    const children = service
      .filter((svc) => String(svc.master_code || '') === String(code))
      .map((svc) => buildTree(svc.code))
      .filter(Boolean);
    return { ...item, children };
  }

  return { normalize, search, buildTree };
})();

const TARMED_HELP = (() => {
  try {
    const helper = buildTarmedHelp({ tarmedData, tardocCatalog: TARDOC_CATALOG, baseDir: path.join(APP_DIR, 'Tardoc') });
    if (helper.legiWarnings?.length) console.warn('LegiData mapping warnings:', helper.legiWarnings.join('; '));
    return helper;
  } catch (err) {
    console.warn('TARMED help init failed:', err?.message || err);
    return { search: () => ({ query: '', tarmed_hits: [], suggestions: [], warnings: [String(err?.message || err)] }) };
  }
})();

// Zuschlags-Defaults (Basis/Persistenz) für serverseitige Berechnung
const PERCENT_SURCHARGE_DEFS = {
  'AA.30.0050': { base: 'consultation', baseType: 'al', percentAL: 25 },
  'AA.30.0070': { base: 'consultation', baseType: 'al', percentAL: 50 },
  'AA.30.0090': { base: 'consultation', baseType: 'al', percentAL: 25 },
  'AA.30.0110': { base: 'consultation', baseType: 'al', percentAL: 50 },
  'KF.10.0130': { base: 'chapter', chapterPrefix: 'KF.', baseType: 'al_tl_split', percentAL: 40, percentTL: 20 },
  'MK.25.0120': { base: 'chapter', chapterPrefix: 'MK.', baseType: 'al_tl', percentAL: 30, percentTL: 30 },
  'MP.10.0020': { base: 'chapter', chapterPrefix: 'MP.', baseType: 'tl', percentTL: 51 },
  'PA.00.0060': { base: 'consultation', chapterPrefix: 'PA.', extraPrefixes: ['WA.10'], baseType: 'al_tl', percentAL: 30, percentTL: 30 },
  'VA.00.0030': { base: 'chapter', chapterPrefix: 'VA.', baseType: 'tl', percentTL: 51 }
};
const PERCENT_AMBIGUOUS = new Set(['JE.00.0070', 'JE.00.0080', 'JE.00.0090', 'TG.05.0080', 'TG.05.0300', 'MP.15.0100']);

// Neue Tarif-API (TARDOC/Pauschalen)
app.get("/api/items", maybeAuth, requireRole('admin','arzt','assistenz','abrechnung'), async (req, res) => {
  const { code, parent_code, search, kind } = req.query || {};
  try {
    if (code) {
      const item = TARDOC_INDEX.normalize(code);
      if (!item) return res.status(404).json({ error: "Not found" });
      return res.json([item]);
    }
    const result = TARDOC_INDEX.search(search || '', parent_code || '', kind || '');
    res.json(result);
  } catch (err) {
    console.error('Tariff search failed', err);
    const body = { error: 'Tarif-Suche fehlgeschlagen' };
    if (EXPOSE_INTERNAL_ERRORS) body.detail = safeClientError('Interner Serverfehler', err);
    res.status(500).json(body);
  }
});
app.get("/api/item/:code", maybeAuth, requireRole('admin','arzt','assistenz','abrechnung'), async (req, res) => {
  try {
    const item = TARDOC_INDEX.normalize(req.params.code);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err) {
    const body = { error: 'Tarif-Lookup fehlgeschlagen' };
    if (EXPOSE_INTERNAL_ERRORS) body.detail = safeClientError('Interner Serverfehler', err);
    res.status(500).json(body);
  }
});
app.get("/api/tree/:code", maybeAuth, requireRole('admin','arzt','assistenz','abrechnung'), async (req, res) => {
  try {
    const tree = TARDOC_INDEX.buildTree(req.params.code);
    if (!tree) return res.status(404).json({ error: "Not found" });
    res.json(tree);
  } catch (err) {
    const body = { error: 'Tarif-Baum fehlgeschlagen' };
    if (EXPOSE_INTERNAL_ERRORS) body.detail = safeClientError('Interner Serverfehler', err);
    res.status(500).json(body);
  }
});

// TARMED -> TARDOC/Pauschalen Hilfesuche
app.get("/api/tarmed-help/search", maybeAuth, requireRole('admin','arzt','assistenz','abrechnung'), async (req, res) => {
  const q = String(req.query.q || req.query.search || '').trim();
  if (!q || q.length < 2) return res.json({ query: q, tarmed_hits: [], suggestions: [], warnings: [] });
  try {
    const result = TARMED_HELP.search(q);
    // Explicitly mark as non-binding suggestions to avoid misuse as tariff validation
    result.disclaimer = "Nur Vorschläge basierend auf TARMED-Suche / LegiData. Keine 1:1-Garantie. TARMED ist nicht mehr abrechenbar.";
    res.json(result);
  } catch (err) {
    console.error('TARMED help search failed', err);
    const body = { error: 'Help search failed' };
    if (EXPOSE_INTERNAL_ERRORS) body.detail = safeClientError('Interner Serverfehler', err);
    res.status(500).json(body);
  }
});

// TARDOC/Pauschalen – Claim-Validierung (GeneralInvoice 5.0 Payload)
app.post('/api/tardoc/validate', maybeAuth, requireRole('admin','arzt','assistenz','abrechnung'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const billingSettings = await getBillingSettings(tenantCtx);
    const cloned = JSON.parse(JSON.stringify(req.body || {}));
    const normalized = validateAndNormalizeInvoiceClaim(cloned, { billingSettings });
    res.json({
      ok: true,
      normalized,
      totals: normalized.totals || null,
      warnings: normalized.warnings || [],
      versions: TARDOC_CATALOG?.versions || {}
    });
  } catch (err) {
    const status = err?.status || 400;
    res.status(status).json({ ok: false, error: safeClientError('Ungültiger Request', err) });
  }
});

// ── GeneralInvoice 4.5 – Validierung/Normalisierung (TARDOC/Pauschalen)
function toISODateOnly(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function isSwissIBAN(iban) {
  return typeof iban === 'string' && /^CH\d{2}[A-Z0-9]{17}$/.test(iban.replace(/\s/g,''));
}

// ---- TARDOC Swiss rules helpers ------------------------------------------------
function calcAgeAt(birthdate, refDate) {
  if (!birthdate || !refDate) return NaN;
  const b = new Date(birthdate);
  const r = new Date(refDate);
  if (Number.isNaN(b.getTime()) || Number.isNaN(r.getTime())) return NaN;
  let age = r.getFullYear() - b.getFullYear();
  const m = r.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && r.getDate() < b.getDate())) age -= 1;
  return age;
}
function parseHHMM(val) {
  const m = String(val || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}
const EMERGENCY_PROFILE_BY_CODE = {
  'AA.30.0050': 'd',
  'AA.30.0070': 'e',
  'AA.30.0090': 'd',
  'AA.30.0110': 'e'
};
// Windows in minutes after midnight (local), per weekday (0=So).
const EMERGENCY_WINDOWS = {
  // Notfall D / Tele F: Mo-Fr 19-22, Sa 12-19, So 7-19
  d: [
    { days: new Set([1,2,3,4,5]), start: 19*60, end: 22*60 },
    { days: new Set([6]), start: 12*60, end: 19*60 },
    { days: new Set([0]), start: 7*60, end: 19*60 }
  ],
  // Notfall E / Tele G: Mo-Fr 22-7, Sa/So 19-7
  e: [
    { days: new Set([1,2,3,4,5]), start: 22*60, end: 7*60 }, // cross midnight
    { days: new Set([6]), start: 19*60, end: 7*60 },          // Sat night
    { days: new Set([0]), start: 19*60, end: 7*60 }           // Sun night
  ]
};
function isInEmergencyWindow(code, dateObj, minutes) {
  const profile = EMERGENCY_PROFILE_BY_CODE[code];
  if (!profile) return true; // not an emergency code
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return false;
  if (!Number.isFinite(minutes)) return false;
  const day = dateObj.getDay(); // 0=Sun
  const windows = EMERGENCY_WINDOWS[profile] || [];
  return windows.some((w) => {
    const isCross = w.start > w.end;
    if (!isCross) {
      return w.days.has(day) && minutes >= w.start && minutes < w.end;
    }
    // Cross midnight: late part on current day, early part on following day
    if (w.days.has(day) && minutes >= w.start) return true;
    const prevDay = (day + 6) % 7;
    if (w.days.has(prevDay) && minutes < w.end) return true;
    return false;
  });
}
function requireRecurrenceFlag(svc, invCase) {
  return Boolean(
    svc?.recurrence === true ||
    svc?.is_recurrence === true ||
    invCase?.recurrence === true ||
    invCase?.is_recurrence === true ||
    invCase?.rezidiv === true
  );
}

const MAX_TIME_BASED_QTY = 480; // 8h in Minuten-Einheiten
const MAX_PATH_QTY = 500; // Sicherheitslimit für Pathologie-Zähler
function isPercentSurchargeAllowed(code, ref) {
  if (PERCENT_SURCHARGE_DEFS[code]) return true;
  const rules = ref?.special_rules || [];
  return rules.some((r) => r.rule === 'percentage_surcharge');
}

function validateAndNormalizeInvoiceClaim(claim = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const tenantConfig = options?.tenantConfig || null;
  const billingSettings = options?.billingSettings || tenantConfig?.billing || null;
  const inv = claim.invoice = claim.invoice || {};
  const prov = claim.provider = claim.provider || {};
  const doctor = claim.doctor = claim.doctor || {};
  const pat  = claim.patient = claim.patient || {};
  const setl = claim.settlement = claim.settlement || {};
  const services = claim.services = Array.isArray(claim.services) ? claim.services : [];
  const parseList = (val = '') => String(val || '')
    .split(/[,;\/]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const percentDefs = PERCENT_SURCHARGE_DEFS;
  const percentAmbiguous = PERCENT_AMBIGUOUS;
  const hasPercentRule = (svc) => {
    const rules = (svc?._ref?.special_rules || svc?.special_rules || []);
    return rules.some((r) => r.rule === 'percentage_surcharge');
  };
  const buildSpecialHandling = (svc, ref) => {
    const def = percentDefs[svc.code] || {};
    const percentRule = (ref?.special_rules || []).find((r) => r.rule === 'percentage_surcharge');
    const unitRule = (ref?.special_rules || []).find((r) => r.rule === 'pathology_counter');
    const basePrefixes = [];
    if (def?.chapterPrefix) basePrefixes.push(def.chapterPrefix);
    if (Array.isArray(def?.extraPrefixes)) basePrefixes.push(...def.extraPrefixes);
    const existing = svc.special_handling || {};
    const autoCalcDefault = percentAmbiguous.has(svc.code) ? false : Boolean(def || percentRule);
    return {
      auto_calc: existing.auto_calc ?? autoCalcDefault,
      percent_al: existing.percent_al ?? def?.percentAL ?? percentRule?.percent ?? null,
      percent_tl: existing.percent_tl ?? def?.percentTL ?? percentRule?.percentTL ?? 0,
      base_mode: existing.base_mode || def?.base || (basePrefixes.length ? 'chapter' : (percentRule?.basis === 'sum_konsultation' ? 'consultation' : 'consultation')),
      base_prefixes: Array.from(new Set([...(existing.base_prefixes || []), ...basePrefixes])).filter(Boolean),
      manual_base_al: existing.manual_base_al ?? '',
      manual_base_tl: existing.manual_base_tl ?? '',
      al_override: existing.al_override ?? '',
      tl_override: existing.tl_override ?? '',
      taxpoints_override: existing.taxpoints_override ?? '',
      mark_unclear: (existing.mark_unclear ?? (percentAmbiguous.has(svc.code) || (svc.special_flags || []).includes('pauschale_zero_tax'))),
      unit_label: existing.unit_label || (unitRule?.suggested_unit ? `Anzahl ${unitRule.suggested_unit}` : (unitRule ? 'Anzahl Proben' : '')),
      pauschale_zero_tax: (svc.special_flags || []).includes('pauschale_zero_tax')
    };
  };
  const isPercentSurcharge = (svc) => {
    if (!svc) return false;
    if (svc.special_handling?.auto_calc === false) return false;
    if (percentAmbiguous.has(svc.code)) return false;
    const def = percentDefs[svc.code];
    return Boolean(def || hasPercentRule(svc));
  };
  const collectRequiredSparten = (list) => {
    const set = new Set();
    (list || []).forEach((s) => {
      const ref = TARDOC_INDEX.normalize(s.code);
      const sp = ref?.sparte || '';
      String(sp || '')
        .split(/[,;\/]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => set.add(x));
    });
    return Array.from(set);
  };
  const collectRequiredDignities = (list) => {
    const set = new Set();
    (list || []).forEach((s) => {
      const ref = TARDOC_INDEX.normalize(s.code);
      const dq = ref?.qual_dignitaet || '';
      String(dq || '')
        .split(/[,;\/]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => set.add(x));
    });
    return Array.from(set);
  };
  const applyHeuristicRules = (list) => {
    // Best-effort Anhang C/H: Maximalhäufigkeiten / Nicht-Kumulation pro Code aus heuristic_rules.json
    const qtyByCode = new Map();
    list.forEach((s) => {
      const c = String(s.code || '').trim();
      if (!c) return;
      const q = Number(s.quantity || s.amount || 1) || 1;
      qtyByCode.set(c, (qtyByCode.get(c) || 0) + q);
    });
    const maxSeen = new Set();
    const comboSeen = new Set();
    list.forEach((svc, idx) => {
      const code = String(svc.code || '').trim();
      if (!code) return;
      const rules = HEURISTIC_RULES_BY_CODE.get(code) || [];
      rules.forEach((rule) => {
        if (rule.max && Number(rule.max.value) > 0) {
          const total = qtyByCode.get(code) || 0;
          if (total > Number(rule.max.value) && !maxSeen.has(code)) {
            maxSeen.add(code);
            errors.push(`services[${idx}]: ${code} max ${rule.max.value} pro ${rule.max.scope || 'Sitzung/Fall'} überschritten (Anhang C/H).`);
          }
        }
        const notWith = Array.isArray(rule.nicht_kumulierbar_mit) ? rule.nicht_kumulierbar_mit : [];
        notWith.forEach((conflict) => {
          if (!conflict) return;
          if ((qtyByCode.get(conflict) || 0) > 0 && !comboSeen.has(`${code}|${conflict}`)) {
            comboSeen.add(`${code}|${conflict}`);
            errors.push(`services[${idx}]: ${code} nicht kumulierbar mit ${conflict} (Anhang C/H).`);
          }
        });
        if (rule.nicht_kumulierbar_flag && (qtyByCode.get(code) || 0) > 1 && !comboSeen.has(`${code}|self`)) {
          comboSeen.add(`${code}|self`);
          errors.push(`services[${idx}]: ${code} darf nicht mehrfach kumuliert werden (Anhang C/H).`);
        }
      });
    });
  };
  const effectivePoints = (svc, ref) => {
    const sh = svc.special_handling || {};
    const qty = Number(svc.quantity || svc.amount || 1) || 1;
    const al = Number(sh.al_override !== '' && sh.al_override != null ? sh.al_override : (ref?.al_points ?? 0)) || 0;
    const tl = Number(sh.tl_override !== '' && sh.tl_override != null ? sh.tl_override : (ref?.tl_points ?? 0)) || 0;
    const taxOverride = sh.taxpoints_override;
    const fallbackTp = Number(ref?.taxpoints || 0);
    let taxpoints = null;
    if (taxOverride !== '' && taxOverride != null) {
      taxpoints = Number(taxOverride);
    }
    if (!Number.isFinite(taxpoints)) {
      if (svc.kind === 'pauschale') taxpoints = Number(ref?.taxpoints || 0);
      else if (al || tl) taxpoints = al + tl;
      else taxpoints = fallbackTp;
    }
    return { qty, al, tl, taxpoints };
  };
  const resolveSurchargeBase = (svc, list) => {
    const sh = svc.special_handling || {};
    const def = percentDefs[svc.code] || {};
    const mode = sh.base_mode || def.base || (sh.base_prefixes?.length ? 'chapter' : 'consultation');
    const explicitPrefixes = [...(sh.base_prefixes || []), def.chapterPrefix, ...(def.extraPrefixes || [])].filter(Boolean);
    const prefixes = (() => {
      const set = new Set(explicitPrefixes);
      if (mode === 'consultation') set.add('AA.'); // Konsultations-Zuschläge nur auf AA.* oder explizite Präfixe
      return Array.from(set).filter(Boolean);
    })();
    let baseAl = Number(sh.manual_base_al || 0) || 0;
    let baseTl = Number(sh.manual_base_tl || 0) || 0;
    const used = [];
    if (!(baseAl || baseTl)) {
      (list || []).forEach((other) => {
        if (!other || other === svc) return;
        if (other._isSurcharge) return;
        if ((other.kind || '').toLowerCase() === 'pauschale') return;
        if (mode === 'chapter' && prefixes.length && !prefixes.some((p) => (other.code || '').startsWith(p))) return;
        if (mode === 'consultation' && prefixes.length && !prefixes.some((p) => (other.code || '').startsWith(p))) return;
        const qty = Number(other.quantity || other.amount || 1) || 1;
        baseAl += Number(other.al_points || 0) * qty;
        baseTl += Number(other.tl_points || 0) * qty;
        used.push(other.code);
      });
    }
    return { baseAl, baseTl, used, mode };
  };
  const providerDignities = Array.from(new Set([
    ...parseList(prov.qual_dignitaet || prov.dignity || prov.doctor_dignity || prov.dignitaet || prov.dignity_code),
    ...parseList(doctor.dignity || doctor.qual_dignitaet || doctor.dignity_code || doctor.title)
  ]));
  // Benötigte Sparte/Dignität nur ermitteln (nicht automatisch aus Leistungen setzen)
  const requiredSparten = collectRequiredSparten(services);
  const requiredDignities = collectRequiredDignities(services);
  const providerSparten = Array.from(new Set([
    ...parseList(prov.sparte || prov.department),
    ...parseList(doctor.sparte || doctor.specialty || inv.case?.sparte)
  ]));

  if (!prov.organization) errors.push('provider.organization fehlt');
  if (!prov.gln && !prov.zsr) errors.push('provider.gln oder provider.zsr erforderlich');

  inv.id = inv.id || `INV-${Date.now()}`;
  inv.created_at = toISODateOnly(inv.created_at || Date.now());
  if (!inv.created_at) errors.push('invoice.created_at ungültig');
  inv.billing_mode = (inv.billing_mode || 'TP').toUpperCase();
  if (!['TP','TG'].includes(inv.billing_mode)) errors.push('invoice.billing_mode muss TP oder TG sein');

  if (!pat.first_name) errors.push('patient.first_name fehlt');
  if (!pat.last_name)  errors.push('patient.last_name fehlt');
  if (pat.birthdate) pat.birthdate = toISODateOnly(pat.birthdate);
  let patientIsMinor = false;
  const guardianInfo = normalizeGuardianFromClaim(claim.guardian || pat.guardian || {});
  const referenceService = (services.find((svc) => svc && svc.date) || {}).date;
  const ageRef = referenceService || inv.created_at || Date.now();
  const ageVal = calcAgeAt(pat.birthdate, ageRef);
  if (Number.isFinite(ageVal) && ageVal < 18) patientIsMinor = true;
  if (patientIsMinor) {
    if (!guardianInfo) {
      errors.push('guardian: Verantwortliche Person für minderjährige Patienten erforderlich.');
    } else {
      const guardianMissing = guardianValidationErrors(guardianInfo);
      if (guardianMissing.length) errors.push(`guardian: ${guardianMissing.join(', ')}`);
    }
  } else if (guardianInfo) {
    const guardianMissing = guardianValidationErrors(guardianInfo);
    if (guardianMissing.length) errors.push(`guardian: ${guardianMissing.join(', ')}`);
  }
  if (guardianInfo) {
    claim.guardian = {
      first_name: guardianInfo.firstName,
      last_name: guardianInfo.lastName,
      relationship: guardianInfo.relationship,
      phone: guardianInfo.phone,
      email: guardianInfo.email || null,
      address: guardianInfo.address || null
    };
    pat.guardian = claim.guardian;
  }

  setl.code_system = (setl.code_system || 'TARDOC');
  if (setl.code_system !== 'TARDOC') errors.push('settlement.code_system muss TARDOC sein');
  setl.point_value_chf = Number(setl.point_value_chf || 0);
  const lawForPointValue = normalizeLawKey(inv.case?.type || inv.case?.coverage || setl.case_type || '');
  const cantonForPointValue = String(setl.canton || '').trim().toUpperCase();
  const resolvedPointValue = billingSettings ? resolvePointValueFromSettings({ billingSettings, law: lawForPointValue, canton: cantonForPointValue }) : null;
  const enforcePointValue = Boolean(billingSettings?.enforce_point_value);
  if (resolvedPointValue) {
    if (enforcePointValue || !(setl.point_value_chf > 0)) {
      setl.point_value_chf = resolvedPointValue;
    } else if (Math.abs(setl.point_value_chf - resolvedPointValue) > 0.0001) {
      warnings.push(`settlement.point_value_chf (${setl.point_value_chf}) weicht von Mandanten-Konfiguration (${resolvedPointValue}) ab`);
    }
  }
  if (!(setl.point_value_chf > 0)) errors.push('settlement.point_value_chf > 0 erforderlich (Mandanten-Einstellung fehlt?)');
  if (!setl.tariff_version) {
    const ver = TARDOC_CATALOG?.versions || {};
    setl.tariff_version = `TARDOC ${ver.tardoc || '1.4c'} / Pauschalen ${ver.pauschalen || '1.1c'} / LKAAT ${ver.lkaat || '1.0c'}`;
  }

  if (!services.length) errors.push('services leer');
  let total = 0;
  const normalizedServices = services.map((s, i) => {
    const out = { ...s };
    out._idx = i;
    out.code_system = 'TARDOC';
    const ref = TARDOC_INDEX.normalize(out.code);
    out._ref = ref;
    if (!out.code) errors.push(`services[${i}].code fehlt`);
    if (out.code && byCode[out.code]) errors.push(`services[${i}].code ${out.code} ist ein TARMED-Code und nicht abrechenbar`);
    if (!ref) {
      out.unknown_code = true;
      errors.push(`services[${i}].code ${out.code || '?'} nicht im TARDOC/Pauschalen-Katalog`);
    }
    out.kind = ref?.kind || out.kind || null;
    out.sparte = out.sparte || ref?.sparte || null;
    out.qual_dignitaet = out.qual_dignitaet || ref?.qual_dignitaet || null;
    out.rules_text = out.rules_text || ref?.rules_text || '';
    out.special_rules = ref?.special_rules || out.special_rules || [];
    out.heuristic_rules = ref?.heuristic_rules || out.heuristic_rules || [];
    out.special_flags = ref?.special_flags || out.special_flags || [];
    if (!out.code) errors.push(`services[${i}].code fehlt`);
    out.date = toISODateOnly(out.date || inv.created_at);
    if (!out.date) errors.push(`services[${i}].date ungültig`);
    if (!Number.isInteger(out.quantity)) {
      const q = Number(out.quantity);
      if (!Number.isNaN(q)) out.quantity = q;
    }
    // --- Swiss-specific validations -----------------------------------------
    const svcTime = parseHHMM(out.time || out.service_time || out.time_of_day || out.start_time);
    const svcDateObj = new Date(out.date);
    if (EMERGENCY_PROFILE_BY_CODE[out.code]) {
      if (!Number.isFinite(svcTime)) {
        errors.push(`services[${i}]: Uhrzeit (HH:MM) erforderlich für ${out.code} (Notfall-Zeitfenster prüfen).`);
      } else if (!isInEmergencyWindow(out.code, svcDateObj, svcTime)) {
        errors.push(`services[${i}]: ${out.code} liegt außerhalb der tarifarischen Zeitfenster.`);
      }
    }
    if (out.code === 'MP.10.0020') {
      const age = calcAgeAt(pat.birthdate, out.date);
      if (!Number.isFinite(age)) errors.push(`services[${i}]: Geburtsdatum für ${out.code} (Kinder <7J) erforderlich.`);
      else if (age >= 7) errors.push(`services[${i}]: ${out.code} nur bei Patienten <7J erlaubt (Alter: ${age}).`);
    }
    if (out.code === 'VA.00.0030') {
      const age = calcAgeAt(pat.birthdate, out.date);
      if (!Number.isFinite(age)) errors.push(`services[${i}]: Geburtsdatum für ${out.code} (Kinder <16J) erforderlich.`);
      else if (age >= 16) errors.push(`services[${i}]: ${out.code} nur bei Patienten <16J erlaubt (Alter: ${age}).`);
    }
    if (out.code === 'PA.00.0060') {
      if (!requireRecurrenceFlag(out, inv.case || {})) {
        errors.push(`services[${i}]: ${out.code} (Rezidiv-Zuschlag) nur bei dokumentiertem Rezidiv/Fall-Flag zulässig.`);
      }
    }
    out.quantity = Number(out.quantity || out.amount || 1) || 1;
    if (!(out.quantity > 0)) errors.push(`services[${i}].quantity muss > 0 sein`);
    out.point_value_chf = Number(out.point_value_chf || setl.point_value_chf || 0);
    out.special_handling = buildSpecialHandling(out, ref);
    out._isSurcharge = isPercentSurcharge(out);
    return out;
  });

  // Anhang C/H: Heuristische Limits/Nicht-Kumulationen aus Tardoc/heuristic_rules.json
  applyHeuristicRules(normalizedServices);

  // Pass 1: normale Leistungen/Pauschalen
  normalizedServices
    .filter((s) => !s._isSurcharge)
    .forEach((out) => {
      const i = out._idx;
      const ref = out._ref || {};
      const sh = out.special_handling || {};
      const pts = effectivePoints(out, ref);
      out.al_points = pts.al;
      out.tl_points = pts.tl;
      out.taxpoints = Number.isFinite(pts.taxpoints) ? pts.taxpoints : 0;
      // IMPORTANT: If user provided taxpoints_override (but no explicit AL/TL overrides),
      // ensure amount calculation follows the overridden taxpoints.
      const hasTaxOverride = sh.taxpoints_override !== '' && sh.taxpoints_override != null;
      const hasAlOverride = sh.al_override !== '' && sh.al_override != null;
      const hasTlOverride = sh.tl_override !== '' && sh.tl_override != null;
      if (hasTaxOverride && !(hasAlOverride || hasTlOverride) && out.kind !== 'pauschale') {
        out.al_points = out.taxpoints;
        out.tl_points = 0;
      } else if ((hasAlOverride || hasTlOverride) && hasTaxOverride && out.kind !== 'pauschale') {
        // Prefer explicit AL/TL overrides; keep taxpoints consistent to avoid silent divergence.
        out.taxpoints = Number(out.al_points || 0) + Number(out.tl_points || 0);
        warnings.push(`services[${i}]: ${out.code} hat sowohl AL/IPL-Override als auch Taxpunkte-Override – es gelten AL/IPL (Taxpunkte daraus abgeleitet).`);
      }
      if (out.kind === 'pauschale') {
        out.al_points = out.taxpoints;
        out.tl_points = 0;
        if (out.special_flags.includes('pauschale_zero_tax') && out.taxpoints === 0 && (sh.taxpoints_override === '' || sh.taxpoints_override == null)) {
          errors.push(`services[${i}]: Pauschale ${out.code} hat 0 Taxpunkte – bitte Taxpunkte eingeben.`);
        }
        if (out.quantity > 1) warnings.push(`services[${i}]: Pauschale ${out.code} mehr als 1x abgerechnet (bitte Anhang A1 prüfen)`);
      } else {
        if (out.special_flags.includes('zero_al_ipl') && out.taxpoints === 0 && (sh.taxpoints_override === '' || sh.taxpoints_override == null) && (sh.al_override === '' || sh.tl_override === '')) {
          errors.push(`services[${i}]: AL/IPL = 0 – Taxpunkte ergänzen (Anhang A2).`);
        }
      }
      if (ref?.is_time_based && !(out.quantity > 0)) {
        errors.push(`services[${i}]: Zeitbasierte Leistung benötigt plausible quantity (siehe Anhang C).`);
      } else if (ref?.is_time_based) {
        if (!Number.isInteger(out.quantity)) {
          errors.push(`services[${i}]: Zeitbasierte Leistung erfordert ganzzahlige Minuten/Mengen.`);
        } else if (out.quantity > MAX_TIME_BASED_QTY) {
          errors.push(`services[${i}]: Zeitbasierte Leistung mit unrealistisch hoher Menge (${out.quantity}).`);
        }
      }
      const isPathCounter = (out.special_flags || []).includes('pathology_counter') || (out.special_handling?.unit_label || '').toLowerCase().includes('anzahl');
      if (isPathCounter && !(out.quantity > 0)) {
        errors.push(`services[${i}]: Pathologie/Proben erfordern Menge > 0 (JM.*).`);
      } else if (isPathCounter) {
        if (!Number.isInteger(out.quantity)) {
          errors.push(`services[${i}]: Pathologie/Proben erfordern ganzzahlige Menge.`);
        } else if (out.quantity > MAX_PATH_QTY) {
          errors.push(`services[${i}]: Pathologie/Proben Menge zu hoch (${out.quantity}).`);
        }
      }
      const line = (Number(out.al_points || 0) + Number(out.tl_points || 0)) * out.point_value_chf * out.quantity;
      out.amount_chf = Number.isFinite(line) ? Number(line.toFixed(2)) : 0;
      total += out.amount_chf;

      // Optional fachliche Regeln: Dignität / Sparte / Häufigkeit (Anhang F/G/C best-effort)
      const svcDignities = parseList(out.qual_dignitaet || '');
      if (svcDignities.length) {
        if (!providerDignities.length) {
          errors.push(`services[${i}]: Dignität ${svcDignities.join('/')} gefordert, aber provider/doctor.dignity fehlt (Anhang F).`);
        } else if (!svcDignities.some((d) => providerDignities.includes(d))) {
          errors.push(`services[${i}]: Dignität ${svcDignities.join('/')} gefordert, gefunden ${providerDignities.join('/')} (Anhang F).`);
        }
      }

      const svcSparten = parseList(out.sparte || '');
      if (svcSparten.length) {
        if (!providerSparten.length) {
          errors.push(`services[${i}]: Sparte ${svcSparten.join('/')} gefordert, aber provider/doctor.sparte fehlt (Anhang G).`);
        } else if (!svcSparten.some((spt) => providerSparten.includes(spt))) {
          errors.push(`services[${i}]: Sparte ${svcSparten.join('/')} vs. ${providerSparten.join('/')} (Anhang G).`);
        }
      }

      if (out.quantity > 1) {
        if (/(max(imal)?\s*1|pro\s+(sitzung|konsultation|fall))/i.test(out.rules_text || '')) {
          errors.push(`services[${i}]: quantity ${out.quantity} überschreitet Regel "${out.rules_text}" (Anhang C/H).`);
        }
        if (ref?.is_groupable === false) {
          errors.push(`services[${i}]: quantity ${out.quantity} bei nicht gruppierbarer Leistung nicht zulässig (Anhang C/H).`);
        }
      }
      if ((out.special_flags || []).includes('percentage_surcharge') && !PERCENT_SURCHARGE_DEFS[out.code]) {
        const hasManual = out.special_handling && out.special_handling.taxpoints_override !== '' && out.special_handling.taxpoints_override != null;
        if (!hasManual) {
          errors.push(`services[${i}]: Zuschlag ${out.code} benötigt definierte Prozentbasis oder manuelle Taxpunkte.`);
        }
      }
    });

  // Pass 2: Zuschläge mit Basisberechnung
  normalizedServices
    .filter((s) => s._isSurcharge)
    .forEach((out) => {
      const i = out._idx;
      const ref = out._ref || {};
      const sh = out.special_handling || {};
      if (!isPercentSurchargeAllowed(out.code, ref)) {
        errors.push(`services[${i}]: Zuschlag ${out.code} nicht hinterlegt – bitte fachlich definieren oder manuelle Taxpunkte setzen.`);
        return;
      }
      const pctAL = Number(sh.percent_al ?? percentDefs[out.code]?.percentAL ?? 0) || 0;
      const pctTL = Number(sh.percent_tl ?? percentDefs[out.code]?.percentTL ?? 0) || 0;
      const hasOverride = sh.taxpoints_override !== '' && sh.taxpoints_override != null;
      if (percentAmbiguous.has(out.code) && !hasOverride) {
        errors.push(`services[${i}]: Zuschlag ${out.code} erfordert manuelle Taxpunkte (uneindeutig).`);
        return;
      }
      if (!hasOverride && !(pctAL || pctTL)) {
        errors.push(`services[${i}]: Zuschlag ${out.code} ohne Prozentangabe.`);
        return;
      }
      let taxpoints = null;
      let baseInfo = null;
      if (hasOverride) {
        taxpoints = Number(sh.taxpoints_override);
      } else {
        baseInfo = resolveSurchargeBase(out, normalizedServices);
        if (!(baseInfo.baseAl || baseInfo.baseTl)) {
          errors.push(`services[${i}]: Keine Basis für Zuschlag ${out.code} gefunden – Basis oder Taxpunkte manuell setzen.`);
          return;
        }
        const tpAl = (baseInfo.baseAl * (pctAL / 100));
        const tpTl = (baseInfo.baseTl * (pctTL / 100));
        taxpoints = tpAl + tpTl;
        // Preserve AL/IPL split for downstream export (service_ex unit_mt/unit_tt).
        out.al_points = tpAl;
        out.tl_points = tpTl;
      }
      if (!Number.isFinite(taxpoints) || taxpoints <= 0) {
        errors.push(`services[${i}]: Zuschlag ${out.code} ergibt 0 Taxpunkte – prüfen.`);
        return;
      }
      if (hasOverride) {
        // Manual taxpoints override: cannot infer AL/IPL split, assign to AL.
        out.al_points = taxpoints;
        out.tl_points = 0;
      }
      out.taxpoints = taxpoints;
      out.quantity = Number(out.quantity || out.amount || 1) || 1;
      const line = taxpoints * out.point_value_chf * out.quantity;
      out.amount_chf = Number.isFinite(line) ? Number(line.toFixed(2)) : 0;
      total += out.amount_chf;
      if (baseInfo?.used?.length) {
        warnings.push(`services[${i}]: Zuschlag ${out.code} Basis: ${baseInfo.used.join(', ')}`);
      }
    });

  // Cleanup temp fields
  claim.services = normalizedServices.map((s) => {
    const cleaned = { ...s };
    delete cleaned._ref;
    delete cleaned._idx;
    delete cleaned._isSurcharge;
    return cleaned;
  });
  claim.totals = claim.totals || {};
  const vat = Number(claim.totals.vat_chf || 0);
  claim.totals.net_chf = Number(total.toFixed(2));
  claim.totals.vat_chf = Number(vat.toFixed(2));
  claim.totals.total_chf = Number((total + vat).toFixed(2));
  if (patientIsMinor && guardianInfo) {
    const addr = guardianInfo.address || {};
    const guardianName = [guardianInfo.firstName, guardianInfo.lastName].filter(Boolean).join(' ').trim();
    const streetLine = [addr.street, addr.houseNo].filter(Boolean).join(' ').trim();
    claim.recipient = {
      ...(claim.recipient || {}),
      type: 'guardian',
      name: guardianName || (claim.recipient?.name || ''),
      address: streetLine || claim.recipient?.address || '',
      zip: addr.zip || claim.recipient?.zip || '',
      city: addr.city || claim.recipient?.city || '',
      country: addr.country || claim.recipient?.country || 'CH',
      canton: claim.recipient?.canton || '',
      point_value_chf: setl.point_value_chf,
      phone: guardianInfo.phone || claim.recipient?.phone || null,
      relationship: guardianInfo.relationship || claim.recipient?.relationship || null
    };
    inv.billing_mode = 'TG';
  }

  const pref = inv.payment_ref || null;
  if (pref && String(pref.type).toUpperCase() === 'QRR') {
    if (!prov.iban || !isSwissIBAN(prov.iban)) errors.push('QRR Referenz erfordert gültige CH-IBAN (QR-IBAN empfohlen) in provider.iban');
  }

  if (errors.length) {
    const err = new Error('Ungültige Rechnung: ' + errors.join('; '));
    err.status = 400;
    throw err;
  }
  if (warnings.length) claim.warnings = warnings;
  return claim;
}

// ── Fälle / EDI (unverändert zum Kern, nur zusammengefasst)
function buildGeneralInvoice45XML(claim) {
  const inv = claim.invoice || {};
  const prov = claim.provider || {};
  const pat  = claim.patient || {};
  const rec  = claim.recipient || {};
  const ins  = claim.insurer || null;
  const setl = claim.settlement || {};
  const services = claim.services || [];
  const totals = claim.totals || { total_chf: 0, vat_chf: 0, net_chf: 0 };
  const NS = 'http://www.forum-datenaustausch.ch/invoice/4.5';
  const invoiceId = inv.id || `INV-${Date.now()}`;
  const payRefType = (inv.payment_ref && inv.payment_ref.type) || 'NON';
  const payRefVal  = (inv.payment_ref && inv.payment_ref.value) || '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<generalInvoice xmlns="${NS}" version="4.5">
  <header>
    <sender>
      ${prov.gln ? `<gln>${xmlEscape(prov.gln)}</gln>` : ''}
      ${prov.zsr ? `<zsr>${xmlEscape(prov.zsr)}</zsr>` : ''}
      <name>${xmlEscape(prov.organization || '')}</name>
    </sender>
    ${ins ? `<receiver><name>${xmlEscape(ins.name || 'Versicherer')}</name></receiver>` : `<receiver><name>${xmlEscape(rec.name || 'Empfänger')}</name></receiver>`}
    <date>${xmlEscape(toISODateOnly(inv.created_at || Date.now()))}</date>
    <invoiceId>${xmlEscape(invoiceId)}</invoiceId>
    <currency>CHF</currency>
    <billingMode>${xmlEscape(inv.billing_mode || 'TP')}</billingMode>
  </header>
  <provider>
    ${prov.gln ? `<gln>${xmlEscape(prov.gln)}</gln>` : ''}
    ${prov.zsr ? `<zsr>${xmlEscape(prov.zsr)}</zsr>` : ''}
    <company>${xmlEscape(prov.organization || '')}</company>
    <address>
      <street>${xmlEscape(prov.address?.street || '')}</street>
      <houseNo>${xmlEscape(prov.address?.houseNo || '')}</houseNo>
      <zip>${xmlEscape(prov.address?.zip || '')}</zip>
      <city>${xmlEscape(prov.address?.city || '')}</city>
      <country>CH</country>
    </address>
    ${prov.iban ? `<iban>${xmlEscape(prov.iban.replace(/\s/g,''))}</iban>` : ''}
    ${prov.contact?.email ? `<email>${xmlEscape(prov.contact.email)}</email>` : ''}
    ${prov.contact?.phone ? `<phone>${xmlEscape(prov.contact.phone)}</phone>` : ''}
  </provider>
  <patient>
    <firstName>${xmlEscape(pat.first_name || '')}</firstName>
    <lastName>${xmlEscape(pat.last_name || '')}</lastName>
    ${pat.birthdate ? `<birthdate>${xmlEscape(pat.birthdate)}</birthdate>` : ''}
    ${pat.ahv ? `<ahv>${xmlEscape(pat.ahv)}</ahv>` : ''}
    ${pat.insured_id ? `<insuredId>${xmlEscape(pat.insured_id)}</insuredId>` : ''}
    <address>
      <street>${xmlEscape(pat.address?.street || '')}</street>
      <houseNo>${xmlEscape(pat.address?.houseNo || '')}</houseNo>
      <zip>${xmlEscape(pat.address?.zip || '')}</zip>
      <city>${xmlEscape(pat.address?.city || '')}</city>
      <country>CH</country>
    </address>
  </patient>
  ${ins ? `
  <insurer>
    <name>${xmlEscape(ins.name || '')}</name>
    ${ins.insured_id ? `<insuredId>${xmlEscape(ins.insured_id)}</insuredId>` : ''}
    ${ins.address ? `<addressLine>${xmlEscape(ins.address)}</addressLine>` : ''}
  </insurer>` : ''}
  <case>
    ${inv.case?.type ? `<type>${xmlEscape(inv.case.type)}</type>` : ''}
    ${inv.case?.diagnosis ? `<diagnosis>${xmlEscape(inv.case.diagnosis)}</diagnosis>` : ''}
    ${inv.case?.referrer ? `<referrer>${xmlEscape(inv.case.referrer)}</referrer>` : ''}
    ${inv.case?.accident ? `
    <accident>
      ${inv.case.accident.type ? `<type>${xmlEscape(inv.case.accident.type)}</type>` : ''}
      ${inv.case.accident.number ? `<number>${xmlEscape(inv.case.accident.number)}</number>` : ''}
      ${inv.case.accident.date ? `<date>${xmlEscape(inv.case.accident.date)}</date>` : ''}
    </accident>` : ''}
    ${inv.case?.remark ? `<remark>${xmlEscape(inv.case.remark)}</remark>` : ''}
  </case>
  <settlement>
    ${setl.canton ? `<canton>${xmlEscape(setl.canton)}</canton>` : ''}
    <pointValueCHF>${Number(setl.point_value_chf || 1).toFixed(2)}</pointValueCHF>
    <tariffSystem>${xmlEscape(setl.code_system || 'TARDOC')}</tariffSystem>
    ${setl.tariff_version ? `<tariffVersion>${xmlEscape(setl.tariff_version)}</tariffVersion>` : ''}
  </settlement>
  <services>
    ${(services||[]).map(s => `
    <service>
      <date>${xmlEscape(toISODateOnly(s.date || inv.created_at))}</date>
      <codeSystem>${xmlEscape(s.code_system || 'TARDOC')}</codeSystem>
      <code>${xmlEscape(s.code || '')}</code>
      ${s.text ? `<text>${xmlEscape(s.text)}</text>` : ''}
      <alPoints>${Number(s.al_points || 0).toFixed(2)}</alPoints>
      <tlPoints>${Number(s.tl_points || 0).toFixed(2)}</tlPoints>
      <quantity>${Number(s.quantity || 1)}</quantity>
      <pointValueCHF>${Number(s.point_value_chf || 0).toFixed(2)}</pointValueCHF>
      <amountCHF>${Number(s.amount_chf || 0).toFixed(2)}</amountCHF>
      ${s.note ? `<note>${xmlEscape(s.note)}</note>` : ''}
    </service>`).join('')}
  </services>
  <totals>
    <netCHF>${Number(totals.net_chf || totals.total_chf || 0).toFixed(2)}</netCHF>
    <vatCHF>${Number(totals.vat_chf || 0).toFixed(2)}</vatCHF>
    <totalCHF>${Number(totals.total_chf || 0).toFixed(2)}</totalCHF>
    ${inv.due_date ? `<dueDate>${xmlEscape(inv.due_date)}</dueDate>` : ''}
    ${inv.payment_terms ? `<paymentTerms>${xmlEscape(inv.payment_terms)}</paymentTerms>` : ''}
  </totals>
  <payment>
    ${prov.iban ? `<iban>${xmlEscape(prov.iban.replace(/\s/g,''))}</iban>` : ''}
    <reference type="${xmlEscape(payRefType)}">${xmlEscape(payRefVal)}</reference>
  </payment>
</generalInvoice>`;
}

// ── GeneralInvoice 5.0 – aligned to requestType/service_ex mandatory fields
function buildGeneralInvoice50XML(claim) {
  return buildGeneralInvoice50RequestXML(claim, {
    language: 'de',
    modus: 'production',
  });
}

// Fälle API (Create/Read/Update/Delete + PDF/JSON/XML + EDI) – gleich wie vorher
const uploadPdf = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const dir = req.tenant.paths.pdfDir;
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const sanitized = `${req.params.id}.pdf`;
      cb(null, sanitized);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ── Invoices API
// Insurance list for dropdowns (full list per tenant)
async function listInsurancesHandler(req, res) {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const { q = '', active = 'true', limit = 2000, ean = '' } = req.query || {};
    const params = [tenantCtx.id];
    let sql = `SELECT id, name, short_name, address, zip, city, canton, ean, zsr_code, bfs_code, phone, email, billing_contact, kvnr, active
                 FROM insurances WHERE tenant_id = $1`;
    if (String(active).toLowerCase() !== 'all') {
      params.push(String(active).toLowerCase() === 'true');
      sql += ` AND active = $${params.length}`;
    }
    if (ean) {
      params.push(String(ean).trim());
      sql += ` AND ean = $${params.length}`;
    }
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      sql += ` AND (lower(name) LIKE $${params.length} OR lower(short_name) LIKE $${params.length})`;
    }
    params.push(Math.min(Number(limit) || 2000, 5000));
    sql += ` ORDER BY name ASC LIMIT $${params.length}`;
    const r = await tenantCtx.db.query(sql, params);
    // Cache control for 12h
    res.set('Cache-Control', 'public, max-age=43200, stale-while-revalidate=3600');
    res.json(r.rows);
  } catch (err) {
    console.error('List insurances failed:', err?.message || err);
    res.status(500).json({ message: 'Krankenkassen konnten nicht geladen werden' });
  }
}

app.get('/api/insurances', maybeAuth, requireRole('admin','doctor','assistant','abrechnung','arzt','billing'), listInsurancesHandler);
// German alias for clients expecting "/api/krankenkassen"
app.get('/api/krankenkassen', maybeAuth, requireRole('admin','doctor','assistant','abrechnung','arzt','billing'), listInsurancesHandler);

// Minimal alias endpoint for generic insurance list (per-tenant `insurance` table)
app.get('/api/insurance', maybeAuth, requireRole('admin','abrechnung','arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    // Ensure table exists (idempotent)
    await tenantCtx.db.query(`
      CREATE TABLE IF NOT EXISTS insurance (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(64) DEFAULT NULL,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(64) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    const { rows } = await tenantCtx.db.query(
      'SELECT id, name, code FROM insurance ORDER BY name ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('List insurance failed:', err.message || err);
    res.status(500).json({ message: 'Insurance list failed' });
  }
});

if (BILLING_SERVICE_URL) {
  const billingProxy = createProxyMiddleware({
    target: BILLING_SERVICE_URL,
    changeOrigin: true,
    xfwd: true,
    onProxyReq: (proxyReq, req) => {
      if (BILLING_SERVICE_TOKEN) proxyReq.setHeader('x-billing-service-token', BILLING_SERVICE_TOKEN);
      if (req.tenant?.id) proxyReq.setHeader('x-tenant-id', req.tenant.id);
      if (req.user?.id) proxyReq.setHeader('x-user-id', String(req.user.id));
      if (req.user?.role || req.user?.rolle) proxyReq.setHeader('x-role', String(req.user.role || req.user.rolle));
      // express.json() consumes request streams; forward JSON body explicitly for proxied write calls.
      if (['POST', 'PUT', 'PATCH'].includes(String(req.method || '').toUpperCase()) && req.body && typeof req.body === 'object') {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    }
  });

  app.use('/api/invoices', maybeAuth, requirePermission('invoices.write', 'admin', 'abrechnung', 'arzt'), billingProxy);
}
app.get('/api/invoices', maybeAuth, requirePermission('invoices.read', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const status = req.query?.status ? String(req.query.status).trim() : null;
    const limit = req.query?.limit ? Math.min(Number(req.query.limit) || 100, 500) : 100;
    const rows = await listInvoices(tenantCtx, { status, limit });
    const dto = rows.map(invoiceToDto);
    res.json(dto);
  } catch (err) {
    console.error('Invoice list failed:', err);
    res.status(500).json({ message: 'Rechnungen konnten nicht geladen werden' });
  }
});

app.get('/api/invoices/:id', maybeAuth, requirePermission('invoices.read', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const invoice = await getInvoiceRecord(tenantCtx, req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Rechnung nicht gefunden' });
    res.json(invoiceToDto(invoice));
  } catch (err) {
    console.error('Invoice fetch failed:', err);
    res.status(500).json({ message: 'Rechnung konnte nicht geladen werden' });
  }
});

app.post('/api/invoices', maybeAuth, requirePermission('invoices.write', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const billingSettings = await getBillingSettings(tenantCtx);
    // Immer validieren und normalisieren vor dem Speichern (schweizer GeneralInvoice 5.0)
    const normalized = validateAndNormalizeInvoiceClaim(JSON.parse(JSON.stringify(req.body || {})), { billingSettings });
    const record = await saveInvoiceRecord({
      tenantCtx,
      claim: normalized,
      userId: req.user?.id || req.user?.username || null,
      appDir: APP_DIR,
      validateXML: ENABLE_XSD_VALIDATION,
      xsdPath: INVOICE_XSD_PATH
    });
    await audit(req, 'invoice.saved', {
      tenant: tenantCtx.id,
      invoiceId: record?.id,
      userId: req.user?.id || req.user?.username || null
    });
    res.status(201).json(invoiceToDto(record));
  } catch (err) {
    const message = err?.message || 'Rechnung konnte nicht gespeichert werden';
    const status = /nicht gefunden|fehlt|ungültig/i.test(message) ? 400 : 500;
    console.error('Invoice save failed:', err);
    res.status(status).json({ message });
  }
});

app.put('/api/invoices/:id', maybeAuth, requirePermission('invoices.write', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const billingSettings = await getBillingSettings(tenantCtx);
    const claim = req.body ? JSON.parse(JSON.stringify(req.body)) : {};
    if (!claim.invoice) claim.invoice = {};
    claim.invoice.id = req.params.id;
    const normalized = validateAndNormalizeInvoiceClaim(claim, { billingSettings });
    const record = await saveInvoiceRecord({
      tenantCtx,
      claim: normalized,
      userId: req.user?.id || req.user?.username || null,
      appDir: APP_DIR,
      validateXML: ENABLE_XSD_VALIDATION,
      xsdPath: INVOICE_XSD_PATH
    });
    await audit(req, 'invoice.updated', {
      tenant: tenantCtx.id,
      invoiceId: record?.id,
      userId: req.user?.id || req.user?.username || null
    });
    res.json(invoiceToDto(record));
  } catch (err) {
    const message = err?.message || 'Rechnung konnte nicht aktualisiert werden';
    const status = /nicht gefunden|fehlt|ungültig/i.test(message) ? 400 : 500;
    console.error('Invoice update failed:', err);
    res.status(status).json({ message });
  }
});

app.get('/api/invoices/:id/pdf', maybeAuth, requirePermission('invoices.read', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const invoice = await getInvoiceRecord(tenantCtx, req.params.id);
    if (!invoice || !invoice.storage_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    if (!fs.existsSync(invoice.storage_path)) return res.status(404).json({ message: 'Datei nicht vorhanden' });
    await audit(req, 'invoice.pdf.download', {
      tenant: tenantCtx.id,
      invoiceId: invoice.id,
      userId: req.user?.id || req.user?.username || null
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(invoice.storage_path).pipe(res);
  } catch (err) {
    console.error('Invoice PDF download failed:', err);
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});

app.get('/api/invoices/:id/pdf/view', maybeAuth, requirePermission('invoices.read', 'admin', 'abrechnung', 'arzt'), async (req, res) => {
  try {
    const tenantCtx = await ensureRequestTenant(req);
    const invoice = await getInvoiceRecord(tenantCtx, req.params.id);
    if (!invoice || !invoice.storage_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    if (!fs.existsSync(invoice.storage_path)) return res.status(404).json({ message: 'Datei nicht vorhanden' });
    await audit(req, 'invoice.pdf.view', {
      tenant: tenantCtx.id,
      invoiceId: invoice.id,
      userId: req.user?.id || req.user?.username || null
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(invoice.storage_path).pipe(res);
  } catch (err) {
    console.error('Invoice PDF inline failed:', err);
    res.status(500).json({ message: 'PDF konnte nicht angezeigt werden' });
  }
});

app.get('/api/faelle', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const { q = '', status = '' } = req.query || {};
  const arr = loadFaelle(req.tenant);
  const qq = String(q).toLowerCase();
  const out = arr.filter((it) => {
    if (status && (it.status || 'neu') !== status) return false;
    if (!qq) return true;
    const hay = [
      it.rechnungsId, it.id, it?.patient?.vorname, it?.patient?.nachname,
      it?.fall?.fallart || it?.invoice?.case?.type, it?.empfaenger?.name || it?.recipient?.name
    ].join(' ').toLowerCase();
    return hay.includes(qq);
  });
  out.sort((a,b) => new Date(b.erstelltAm || b.invoice?.created_at || 0) - new Date(a.erstelltAm || a.invoice?.created_at || 0));
  res.json(out);
});
app.post('/api/faelle', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const payload = req.body || {};
  let normalized = null;
  try {
    normalized = validateAndNormalizeInvoiceClaim(JSON.parse(JSON.stringify(payload)));
  } catch (err) {
    const statusCode = err?.status || 400;
    return res.status(statusCode).json({ error: safeClientError('Ungültiger Claim', err) });
  }

  const base = normalized || payload;
  const genId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  const invoiceId = base?.invoice?.id || base.rechnungsId || base.id || genId;
  const neu = {
    ...base,
    invoice: { ...(base.invoice || {}), id: invoiceId },
    id: base.id || base.rechnungsId || invoiceId || genId,
    rechnungsId: base.rechnungsId || invoiceId,
    erstelltAm: base.erstelltAm || base?.invoice?.created_at || nowIso(),
    status: base.status || 'neu'
  };
  const arr = loadFaelle(req.tenant); arr.push(neu); saveFaelle(req.tenant, arr);
  res.status(201).json(neu);
});
app.get('/api/faelle/:id', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const it = findFall(loadFaelle(req.tenant), req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it);
});
app.put('/api/faelle/:id', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const arr = loadFaelle(req.tenant);
  const idx = arr.findIndex(x => x.id === req.params.id || x.rechnungsId === req.params.id || x.invoice?.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const merged = { ...arr[idx], ...req.body, id: arr[idx].id || arr[idx].rechnungsId || arr[idx].invoice?.id };
  arr[idx] = merged; saveFaelle(req.tenant, arr); res.json(merged);
});
app.delete('/api/faelle/:id', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const arr = loadFaelle(req.tenant);
  const idx = arr.findIndex(x => x.id === req.params.id || x.rechnungsId === req.params.id || x.invoice?.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const [removed] = arr.splice(idx, 1);
  saveFaelle(req.tenant, arr);

  const idSet = new Set(
    [req.params.id, removed?.id, removed?.rechnungsId, removed?.invoice?.id]
      .map(v => (v == null ? null : String(v).trim()))
      .filter(Boolean)
  );
  for (const id of idSet) {
    try { fs.rmSync(path.join(req.tenant.paths.pdfDir, `${id}.pdf`), { force: true }); } catch {}
    try { fs.rmSync(path.join(req.tenant.paths.jsonDir, `${id}.json`), { force: true }); } catch {}
    try { fs.rmSync(path.join(req.tenant.paths.xmlDir, `${id}.xml`), { force: true }); } catch {}
    try {
      const ackFiles = fs.readdirSync(req.tenant.paths.ackDir).filter(name => name.startsWith(`${id}_`));
      ackFiles.forEach(name => {
        try { fs.rmSync(path.join(req.tenant.paths.ackDir, name), { force: true }); } catch {}
      });
    } catch {}
  }

  audit(req, 'claim_deleted', { id: req.params.id, user: req.user?.id || req.user?.username });
  res.status(204).end();
});
app.post('/api/faelle/:id/pdf', maybeAuth, requireRole('admin','abrechnung'), uploadPdf.single('file'), (req, res) => {
  const arr = loadFaelle(req.tenant);
  const it = findFall(arr, req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  it.pdf = `/api/faelle/${it.id || it.rechnungsId}/pdf`;
  saveFaelle(req.tenant, arr);
  res.json({ ok: true, pdf: it.pdf });
});
app.get('/api/faelle/:id/pdf', maybeAuth, requireRole('admin','abrechnung','arzt'), async (req, res) => {
  try {
    const arr = loadFaelle(req.tenant);
    const idx = arr.findIndex(x => x.id === req.params.id || x.rechnungsId === req.params.id || x.invoice?.id === req.params.id);
    if (idx < 0) return res.status(404).end();
    const filepath = await ensureClaimPdf(req.tenant, arr, idx, req.params.id);
    const claim = arr[idx];
    audit(req, 'claim.pdf_served', {
      claimId: req.params.id,
      invoiceId: claim?.invoice?.id || claim?.id || null,
      tenant: req.tenant?.id,
      userId: req.user?.id || req.user?.username
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filepath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'PDF konnte nicht generiert werden' });
  }
});
app.post('/api/faelle/:id/json', maybeAuth, requireRole('admin','abrechnung','arzt'), async (req, res) => {
  try {
    const arr = loadFaelle(req.tenant);
    const it = findFall(arr, req.params.id);
    if (!it) return res.status(404).json({ error: 'not found' });
    const filePath = path.join(req.tenant.paths.jsonDir, `${req.params.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(req.body || {}, null, 2), 'utf8');
    it.json = `/api/faelle/${req.params.id}/json`;
    saveFaelle(req.tenant, arr);
    res.json({ ok: true, json: it.json });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeClientError('JSON konnte nicht gespeichert werden', e) });
  }
});
app.get('/api/faelle/:id/json', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  try {
    const arr = loadFaelle(req.tenant);
    const idx = arr.findIndex(x => x.id === req.params.id || x.rechnungsId === req.params.id || x.invoice?.id === req.params.id);
    if (idx < 0) return res.status(404).end();
    const filepath = ensureClaimJson(req.tenant, arr, idx, req.params.id);
    const claim = arr[idx];
    audit(req, 'claim.json_served', {
      claimId: req.params.id,
      invoiceId: claim?.invoice?.id || claim?.id || null,
      tenant: req.tenant?.id,
      userId: req.user?.id || req.user?.username
    });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.sendFile(filepath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'JSON konnte nicht bereitgestellt werden' });
  }
});
app.post('/api/faelle/:id/xml', maybeAuth, requireRole('admin','abrechnung'), async (req, res) => {
  try {
    const claim = req.body;
    if (!claim || !claim.invoice || !claim.provider) return res.status(400).json({ error: 'Ungültiger Claim' });
    const billingSettings = await getBillingSettings(req.tenant);
    const normalized = validateAndNormalizeInvoiceClaim(claim, { billingSettings });
    const xml = buildGeneralInvoice50XML(normalized);
    let validation = { ok: true, available: XMLLINT_AVAILABLE && Boolean(INVOICE_XSD_PATH), error: null };
    if (ENABLE_XSD_VALIDATION && INVOICE_XSD_PATH) {
      const r = await validateXMLWithXSD(xml, INVOICE_XSD_PATH);
      validation = r;
      if (!r.ok) {
        console.warn(`XSD-Validation failed for ${req.params.id}:`, r.error);
      }
    }
    const filePath = path.join(req.tenant.paths.xmlDir, `${req.params.id}.xml`);
    fs.writeFileSync(filePath, xml, 'utf8');

    const arr = loadFaelle(req.tenant);
    const it = findFall(arr, req.params.id);
    if (it) {
      it.xml = `/api/faelle/${req.params.id}/xml`;
      it.status = it.status || 'neu';
      // Totals spiegeln, falls vorhanden
      try { it.totals = normalized.totals; } catch {}
      saveFaelle(req.tenant, arr);
    }
    res.json({ ok: validation.ok, xml: `/api/faelle/${req.params.id}/xml`, xsd_validation: validation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeClientError('XML konnte nicht erstellt werden', e) });
  }
});
app.get('/api/faelle/:id/xml', maybeAuth, requireRole('admin','abrechnung','arzt'), async (req, res) => {
  try {
    const arr = loadFaelle(req.tenant);
    const idx = arr.findIndex(x => x.id === req.params.id || x.rechnungsId === req.params.id || x.invoice?.id === req.params.id);
    if (idx < 0) return res.status(404).end();
    const { filepath, validation } = await ensureClaimXml(req.tenant, arr, idx, req.params.id);
    if (req.query.meta === '1') {
      return res.json({
        xml: `/api/faelle/${req.params.id}/xml`,
        xsd_validation: validation
      });
    }
    if (!filepath || !fs.existsSync(filepath)) return res.status(404).end();
    const claim = arr[idx];
    audit(req, 'claim.xml_served', {
      claimId: req.params.id,
      invoiceId: claim?.invoice?.id || claim?.id || null,
      tenant: req.tenant?.id,
      userId: req.user?.id || req.user?.username
    });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.sendFile(filepath);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'XML konnte nicht bereitgestellt werden' });
  }
});

const sendLimiter = rateLimit({ windowMs: 5*60*1000, limit: 120, standardHeaders: true, legacyHeaders: false });
app.post('/api/faelle/:id/edi/send', maybeAuth, requireRole('admin','abrechnung'), sendLimiter, async (req, res) => {
  try {
    const xmlPath = path.join(req.tenant.paths.xmlDir, `${req.params.id}.xml`);
    if (!fs.existsSync(xmlPath)) return res.status(404).json({ error: 'XML nicht gefunden' });

    const form = new FormData();
    form.append('file', fs.createReadStream(xmlPath), { filename: `${req.params.id}.xml`, contentType: 'application/xml' });
    if (req.body && req.body.metadata) form.append('metadata', JSON.stringify(req.body.metadata));

    const API   = process.env.MEDIDATABOX_API_URL;
    const TOKEN = process.env.MEDIDATABOX_TOKEN || '';
    if (!API) return res.status(500).json({ error: 'MEDIDATABOX_API_URL not set' });

    const allowExternal = String(process.env.ALLOW_EXTERNAL_CALLS || 'false').toLowerCase() === 'true';
    if (!allowExternal) {
      return res.status(403).json({ error: 'External HTTP blocked by policy (set ALLOW_EXTERNAL_CALLS=true for EDI).' });
    }

    const resp = await global.fetch(API, {
      method: 'POST',
      headers: { ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...form.getHeaders?.() },
      body: form
    });
    const text = await resp.text();

    const arr = loadFaelle(req.tenant);
    const it = findFall(arr, req.params.id);
    if (it) {
      it.status = resp.ok ? 'sent' : 'send_error';
      it.lastDispatch = nowIso();
      it.dispatchMessage = text.slice(0, 4000);
      saveFaelle(req.tenant, arr);
    }
    if (!resp.ok) return res.status(resp.status).send(text);
    res.send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeClientError('EDI Versand fehlgeschlagen', e) });
  }
});

const uploadAck = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const dir = req.tenant.paths.ackDir;
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const sanitized = file.originalname.replace(/[^\w.\-+]/g, '_');
      cb(null, `${req.params.id}_${Date.now()}_${sanitized}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});
app.post('/api/faelle/:id/edi/ack', maybeAuth, requireRole('admin','abrechnung'), uploadAck.single('file'), (req, res) => {
  const arr = loadFaelle(req.tenant); const it = findFall(arr, req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  it.status = 'ack'; it.ackAt = nowIso(); it.ackFile = req.file ? path.basename(req.file.path) : null; saveFaelle(req.tenant, arr);
  res.json({ ok: true, status: it.status });
});
app.post('/api/faelle/:id/edi/rej', maybeAuth, requireRole('admin','abrechnung'), uploadAck.single('file'), (req, res) => {
  const arr = loadFaelle(req.tenant); const it = findFall(arr, req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  it.status = 'rejected'; it.rejAt = nowIso(); it.rejFile = req.file ? path.basename(req.file.path) : null; it.rejReason = (req.body && req.body.reason) || 'Unspecified'; saveFaelle(req.tenant, arr);
  res.json({ ok: true, status: it.status });
});
app.get('/api/faelle/:id/edi/status', maybeAuth, requireRole('admin','abrechnung','arzt'), (req, res) => {
  const it = findFall(loadFaelle(req.tenant), req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json({ status: it.status || 'neu', ackAt: it.ackAt, rejAt: it.rejAt, message: it.dispatchMessage, rejReason: it.rejReason });
});


async function resolvePatientHandler(req, res) {
  const {
    id,
    vorname = '',
    nachname = '',
    adresse = '',
    versichertennummer = '',
    insurance_number = ''
  } = req.query || {};
  const tenantId = req.tenant.id;
  try {
    // Shortcut: direkte ID-Abfrage zulassen, um 500-Fehler bei id-Only-Calls zu vermeiden
    if (id != null && String(id).trim().length) {
      const { rows } = await req.tenant.db.query(
        `SELECT * FROM patients WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, String(id).trim()]
      );
      if (rows.length) return res.json(toPatientDto(rows[0]));
      return res.status(404).json({ message: 'Patient nicht gefunden' });
    }
    const insuranceCandidate = (insurance_number || versichertennummer || '').trim();
    if (insuranceCandidate) {
      const { rows } = await req.tenant.db.query(
        `SELECT *
           FROM patients
          WHERE tenant_id = $1
            AND (insurance_number = $2 OR versichertennummer = $2)
          LIMIT 1`,
        [tenantId, insuranceCandidate]
      );
      if (rows.length) return res.json(toPatientDto(rows[0]));
    }

    const first = String(vorname || '').trim();
    const last = String(nachname || '').trim();
    if (first && last) {
      const { rows: exactRows } = await req.tenant.db.query(
        `SELECT *
           FROM patients
          WHERE tenant_id = $1
            AND lower(coalesce(vorname, '')) = lower($2)
            AND lower(coalesce(nachname, '')) = lower($3)
          LIMIT 1`,
        [tenantId, first, last]
      );
      if (exactRows.length) return res.json(toPatientDto(exactRows[0]));

      const likeAdr = adresse ? `%${adresse.trim()}%` : null;
      const { rows: fuzzyRows } = await req.tenant.db.query(
        `SELECT p.*,
                (
                  CASE WHEN lower(coalesce(p.vorname,'')) LIKE lower($2) THEN 1 ELSE 0 END +
                  CASE WHEN lower(coalesce(p.nachname,'')) LIKE lower($3) THEN 1 ELSE 0 END +
                  CASE WHEN $4 IS NOT NULL AND (p.adresse ILIKE $4 OR p.ort ILIKE $4 OR (p.address::text ILIKE $4)) THEN 1 ELSE 0 END
                ) AS score
           FROM patients p
          WHERE p.tenant_id = $1
            AND (p.vorname ILIKE $2 OR p.nachname ILIKE $3 OR p.name ILIKE $5)
          ORDER BY score DESC
          LIMIT 1`,
        [tenantId, `%${first}%`, `%${last}%`, likeAdr, `%${first} ${last}%`]
      );
      if (fuzzyRows.length) return res.json(toPatientDto(fuzzyRows[0]));
    }

    return res.status(404).json({ message: 'Kein passender Patient gefunden' });
  } catch (err) {
    console.error('resolve error:', err);
    return res.status(500).json({ message: 'Fehler bei der Patientensuche' });
  }
}

app.get('/api/patients/resolve', maybeAuth, requirePermission('patients.read', 'admin', 'doctor', 'assistant', 'billing'), resolvePatientHandler);

// Internal-only deterministic meds retrieval (must NOT be exposed via nginx)
try {
  const { retrieveMedsContext } = require('./lib/medsRetrieve');
  const internalSecret = String(process.env.SHARED_INTERNAL_SECRET || '');
  const safeEq = (a, b) => {
    const aa = Buffer.from(String(a || ''), 'utf8');
    const bb = Buffer.from(String(b || ''), 'utf8');
    if (aa.length !== bb.length) return false;
    try { return crypto.timingSafeEqual(aa, bb); } catch { return false; }
  };
  const requireInternalSecret = (req, res, next) => {
    if (!internalSecret) return res.status(503).json({ message: 'Internal secret not configured' });
    const provided = req.headers['x-internal-secret'];
    if (!safeEq(provided, internalSecret)) return res.status(403).json({ message: 'Forbidden' });
    next();
  };

  app.post('/internal/meds/retrieve', requireInternalSecret, async (req, res) => {
    try {
      const tenantId = resolveTenantIdFromRequest(req);
      if (!tenantId) return res.status(400).json({ message: 'Mandant fehlt' });
      await ensureRequestTenant(req, tenantId);

      const { question, maxItems, maxEvidencePerItem, selectedId } = req.body || {};
      const q = String(question || '').trim();
      if (!q) return res.status(400).json({ message: 'Leere Anfrage' });

      const data = await retrieveMedsContext({
        question: q,
        selectedId,
        maxItems,
        maxEvidencePerItem,
      });
      return res.json(data);
    } catch (err) {
      try { console.error('[internal/meds/retrieve] error:', err?.message || err); } catch {}
      return res.status(500).json({ message: 'Interner Serverfehler' });
    }
  });
} catch (e) {
  console.warn('Internal meds retrieval route konnte nicht geladen werden:', e?.message || e);
}

// PATCH: mount modular routes (non-core)
try {
  // TODO: consolidate routes
  const { medsRouter } = require('./server/routes/meds');
  const { medsChatRouter, medsChatHandler } = require('./server/routes/medsChat');
  // Medications search/details
  app.use('/api/meds', maybeAuth, requireRole('admin','doctor','assistant','billing'), (req, res, next) => {
    // Ensure tenant context attached for router
    if (!req.tenant) {
      return attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId())
        .then(() => next()).catch(() => res.status(400).json({ message: 'Mandant fehlt' }));
    }
    next();
  }, medsRouter);
  // Medications chat (more restrictive roles)
  app.use('/api/meds', authenticateToken, requireRole('admin','doctor','assistant'), (req, res, next) => {
    if (!req.tenant) {
      return attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId())
        .then(() => next()).catch(() => res.status(400).json({ message: 'Mandant fehlt' }));
    }
    next();
  }, medsChatRouter);

  // New canonical endpoint: POST /api/meds-chat (not under /api/meds/*)
  app.post('/api/meds-chat', authenticateToken, requireRole('admin','doctor','assistant'), (req, res, next) => {
    if (!req.tenant) {
      return attachTenantContext(req, resolveTenantIdFromRequest(req) || tenantManager.getDefaultTenantId())
        .then(() => next()).catch(() => res.status(400).json({ message: 'Mandant fehlt' }));
    }
    next();
  }, medsChatHandler);
} catch (e) {
  console.warn('Modulare Routen konnten nicht geladen werden:', e?.message || e);
}

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// SPA-Fallback für React-Routen (z. B. /medikamente, /kalender)
const SPA_ROUTES = ['/medikamente', '/kalender', '/aufgaben', '/faelle', '/waitingroom', '/medi-remidi'];
const sendIndexIfBuilt = (req, res, next) => {
  if (!hasFrontendBuild) return res.status(503).send('Frontend-Build fehlt (npm run build im frontend/)');
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(FRONTEND_BUILD_DIR, 'index.html'));
};
SPA_ROUTES.forEach((route) => {
  app.get(route, sendIndexIfBuilt);
});

if (hasFrontendBuild) {
  app.get('*', (req, res, next) => {
    const p = req.path || '';
    if (p.startsWith('/api') || p.startsWith('/uploads') || p.startsWith('/assets') || p.startsWith('/patient-files')) {
      return next();
    }
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(FRONTEND_BUILD_DIR, 'index.html'));
  });
}

// Start
// Zentrale Fehlerbehandlung (keine Details leaken)
// Muss nach den Routen stehen
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  try { console.error('Unhandled error:', err?.message || err); } catch {}
  res.status(500).json({ message: 'Interner Serverfehler' });
});


// AI status for frontend (LAN-only, no outbound calls from app)
app.get('/api/ai/status', async (_req, res) => {
  try {
    const gateway = await fetch(`${AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2500) })
      .then((r) => (r.ok ? r.json().catch(() => ({ ok: true })) : { ok: false }))
      .catch(() => ({ ok: false }));
    res.json({
      ok: !!gateway?.ok,
      gateway: { ok: !!gateway?.ok, openaiConfigured: !!gateway?.openaiConfigured, model: gateway?.model || null },
    });
  } catch {
    res.json({ ok: false, gateway: { ok: false } });
  }
});


async function startServer() {
  app.listen(PORT, host, () => {
    console.log(`Server läuft auf http://${host}:${PORT} (Auth ${REQUIRE_AUTH ? 'aktiv' : 'inaktiv'})`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Serverstart fehlgeschlagen (Mandanten-Bootstrap):', err);
    process.exit(1);
  });
}

// Export für Tests (kein Serverstart beim Import)
module.exports = { app, startServer, validateAndNormalizeInvoiceClaim };
