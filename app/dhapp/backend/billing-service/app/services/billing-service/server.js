'use strict';

const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const tenantManager = require('../../lib/tenant');
const {
  validateSessionToken,
} = require('../../lib/auth/sessionTokens');
const {
  listInvoices,
  getInvoiceRecord,
  saveInvoiceRecord,
} = require('../../lib/invoices/service');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

const isProd = String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase() === 'production';
const PORT = Number(process.env.BILLING_PORT || process.env.PORT || 8090);
const host = String(process.env.BIND_PUBLIC || 'true').toLowerCase() === 'true' ? '0.0.0.0' : '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME';
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || 'session').trim() || 'session';
const BILLING_SERVICE_TOKEN = String(process.env.BILLING_SERVICE_TOKEN || '');
const ENABLE_XSD_VALIDATION = String(process.env.ENABLE_XSD_VALIDATION || 'true').toLowerCase() === 'true';
const INVOICE_XSD_PATH = process.env.INVOICE_XSD_PATH || '';
const SCHEMA_IDENT_RE = /^[a-z_][a-z0-9_]*$/;

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'CHANGE_ME')) {
  console.error('FATAL: JWT_SECRET must be set for billing-service in production.');
  process.exit(1);
}

app.use(cookieParser(JWT_SECRET));

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

async function findTenantAuthUserByLegacyId(tenantCtx, legacyUserId) {
  const userId = Number(legacyUserId);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const schema = quoteSchemaIdent(tenantCtx?.schemaName || `tenant_${tenantCtx?.id}`, tenantCtx?.id);
  const { rows } = await tenantCtx.db.query(
    `SELECT u.user_id,
            u.legacy_user_id,
            u.email,
            u.display_name,
            u.is_active,
            u.deleted_at,
            r.name AS role_name
       FROM ${schema}.users u
       LEFT JOIN ${schema}.roles r ON r.role_id = u.role_id
      WHERE u.legacy_user_id = $1
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function roleAllowed(role, allowed = []) {
  const map = {
    arzt: 'doctor',
    'ärztin': 'doctor',
    doctor: 'doctor',
    assistenz: 'assistant',
    assistant: 'assistant',
    abrechnung: 'billing',
    billing: 'billing',
    admin: 'admin',
  };
  const normalized = map[String(role || '').toLowerCase()] || String(role || '').toLowerCase();
  if (normalized === 'admin') return true;
  return allowed.includes(normalized);
}

function invoiceToDto(row = {}) {
  return {
    tenant_id: row.tenant_id,
    id: row.id,
    patient_id: row.patient_id,
    doctor_id: row.doctor_id,
    status: row.status,
    total: row.total,
    currency: row.currency,
    payload: row.payload,
    created_by: row.created_by,
    created_by_user_id: row.created_by_user_id,
    storage_path: row.storage_path,
    tenant_storage_path: row.tenant_storage_path,
    filesize: row.filesize,
    pdf_checksum: row.pdf_checksum,
    pdf_generated_at: row.pdf_generated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    due_date: row.due_date,
  };
}

function readBearer(req) {
  return String(req.headers.authorization || '').split(' ')[1] || '';
}

async function authenticate(req, res, next) {
  try {
    const internalToken = String(req.headers['x-billing-service-token'] || '');
    if (BILLING_SERVICE_TOKEN && internalToken && internalToken === BILLING_SERVICE_TOKEN) {
      const tenantId = String(req.headers['x-tenant-id'] || '').trim();
      if (!tenantId) return res.status(400).json({ message: 'Mandant fehlt' });
      req.tenant = await tenantManager.getTenantContext(tenantId);
      req.user = {
        id: Number(req.headers['x-user-id']) || null,
        role: String(req.headers['x-role'] || 'billing').toLowerCase(),
      };
      return next();
    }

    const token = readBearer(req) || req.signedCookies?.[SESSION_COOKIE_NAME] || req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return res.status(401).json({ message: 'Kein Token' });

    const payload = jwt.verify(token, JWT_SECRET);
    const tenantId = payload.tenant || payload.mandant || tenantManager.getDefaultTenantId();
    const tenantCtx = await tenantManager.getTenantContext(tenantId);

    const sessionCheck = await validateSessionToken({ tenantCtx, payload, token });
    if (!sessionCheck.ok) return res.status(401).json({ message: 'Sitzung abgelaufen oder ungültig' });

    const tenantAuthUser = await findTenantAuthUserByLegacyId(tenantCtx, payload.id);
    if (!tenantAuthUser || !tenantAuthUser.is_active) {
      return res.status(401).json({ message: 'Benutzer nicht gefunden' });
    }

    const legacyRole = mapTenantRoleToLegacyRole(tenantAuthUser.role_name);
    const { rows } = await tenantCtx.db.query(
      `SELECT id, tenant_id, role, rolle, email, username, name, vorname, nachname
         FROM users
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [tenantCtx.id, Number(tenantAuthUser.legacy_user_id)]
    );

    const legacyUser = rows[0] || {
      id: Number(tenantAuthUser.legacy_user_id),
      tenant_id: tenantCtx.id,
      email: tenantAuthUser.email || null,
      username: String(tenantAuthUser.email || '').split('@')[0] || null,
      name: tenantAuthUser.display_name || tenantAuthUser.email || 'User',
      vorname: null,
      nachname: null,
      role: legacyRole,
      rolle: tenantAuthUser.role_name || legacyRole,
    };
    legacyUser.role = legacyRole;
    legacyUser.rolle = tenantAuthUser.role_name || legacyUser.rolle || legacyRole;

    req.tenant = tenantCtx;
    req.user = legacyUser;
    req.authTokenPayload = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Nicht autorisiert' });
  }
}

function requireBillingRole(req, res, next) {
  const role = req.user?.role || req.user?.rolle;
  if (!roleAllowed(role, ['billing', 'doctor'])) {
    return res.status(403).json({ message: 'Nicht berechtigt' });
  }
  return next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'billing-service', ts: Date.now() });
});

app.get('/api/invoices', authenticate, requireBillingRole, async (req, res) => {
  try {
    const status = req.query?.status ? String(req.query.status).trim() : null;
    const limit = req.query?.limit ? Math.min(Number(req.query.limit) || 100, 500) : 100;
    const rows = await listInvoices(req.tenant, { status, limit });
    res.json(rows.map(invoiceToDto));
  } catch (err) {
    console.error('billing-service list invoices failed:', err?.message || err);
    res.status(500).json({ message: 'Rechnungen konnten nicht geladen werden' });
  }
});

app.get('/api/invoices/:id', authenticate, requireBillingRole, async (req, res) => {
  try {
    const invoice = await getInvoiceRecord(req.tenant, req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Rechnung nicht gefunden' });
    res.json(invoiceToDto(invoice));
  } catch (err) {
    console.error('billing-service get invoice failed:', err?.message || err);
    res.status(500).json({ message: 'Rechnung konnte nicht geladen werden' });
  }
});

app.post('/api/invoices', authenticate, requireBillingRole, async (req, res) => {
  try {
    const claim = req.body ? JSON.parse(JSON.stringify(req.body)) : {};
    const record = await saveInvoiceRecord({
      tenantCtx: req.tenant,
      claim,
      userId: req.user?.id || req.user?.username || null,
      appDir: process.cwd(),
      validateXML: ENABLE_XSD_VALIDATION,
      xsdPath: INVOICE_XSD_PATH,
    });
    res.status(201).json(invoiceToDto(record));
  } catch (err) {
    const message = err?.message || 'Rechnung konnte nicht gespeichert werden';
    const status = /nicht gefunden|fehlt|ungültig/i.test(message) ? 400 : 500;
    console.error('billing-service create invoice failed:', err?.message || err);
    res.status(status).json({ message });
  }
});

app.put('/api/invoices/:id', authenticate, requireBillingRole, async (req, res) => {
  try {
    const claim = req.body ? JSON.parse(JSON.stringify(req.body)) : {};
    if (!claim.invoice) claim.invoice = {};
    claim.invoice.id = req.params.id;
    const record = await saveInvoiceRecord({
      tenantCtx: req.tenant,
      claim,
      userId: req.user?.id || req.user?.username || null,
      appDir: process.cwd(),
      validateXML: ENABLE_XSD_VALIDATION,
      xsdPath: INVOICE_XSD_PATH,
    });
    res.json(invoiceToDto(record));
  } catch (err) {
    const message = err?.message || 'Rechnung konnte nicht aktualisiert werden';
    const status = /nicht gefunden|fehlt|ungültig/i.test(message) ? 400 : 500;
    console.error('billing-service update invoice failed:', err?.message || err);
    res.status(status).json({ message });
  }
});

app.get('/api/invoices/:id/pdf', authenticate, requireBillingRole, async (req, res) => {
  try {
    const invoice = await getInvoiceRecord(req.tenant, req.params.id);
    if (!invoice || !invoice.storage_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    if (!fs.existsSync(invoice.storage_path)) return res.status(404).json({ message: 'Datei nicht vorhanden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.id}.pdf"`);
    fs.createReadStream(invoice.storage_path).pipe(res);
  } catch (err) {
    console.error('billing-service invoice pdf failed:', err?.message || err);
    res.status(500).json({ message: 'PDF konnte nicht bereitgestellt werden' });
  }
});

app.get('/api/invoices/:id/pdf/view', authenticate, requireBillingRole, async (req, res) => {
  try {
    const invoice = await getInvoiceRecord(req.tenant, req.params.id);
    if (!invoice || !invoice.storage_path) return res.status(404).json({ message: 'PDF nicht vorhanden' });
    if (!fs.existsSync(invoice.storage_path)) return res.status(404).json({ message: 'Datei nicht vorhanden' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.id}.pdf"`);
    fs.createReadStream(invoice.storage_path).pipe(res);
  } catch (err) {
    console.error('billing-service invoice pdf view failed:', err?.message || err);
    res.status(500).json({ message: 'PDF konnte nicht angezeigt werden' });
  }
});

app.listen(PORT, host, async () => {
  try {
    await tenantManager.bootstrapAllTenants();
  } catch (err) {
    console.error('billing-service tenant bootstrap warning:', err?.message || err);
  }
  console.log(`[billing-service] listening on http://${host}:${PORT}`);
});

module.exports = { app };
