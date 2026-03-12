'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tenantManager = require('../tenant');

// --- Privacy helpers
const RESERVED_PAYLOAD_KEYS = new Set([
  'level','message','userId','user_id','username','userName','ip','ip_address','ipAddress','ua','userAgent','correlationId','correlation_id','tenantId','tenant_id','event','payload'
]);
const SENSITIVE_KEYS = new Set(['password','password_hash','token','accessToken','refreshToken','authorization','authHeader','plainPassword','email','phone']);

const replacer = (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack, name: v.name } : (typeof v === 'bigint' ? v.toString() : v));
const sanitizePayload = (details) => {
  if (!details || typeof details !== 'object') return null;
  const payload = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    if (RESERVED_PAYLOAD_KEYS.has(k)) continue;
    if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
    payload[k] = v;
  }
  if (!Object.keys(payload).length) return null;
  try { return JSON.stringify(payload, replacer); } catch (e) { return JSON.stringify({ type:'serialization_error', error: e.message }); }
};
const hmac = (val, salt) => (!val ? '' : crypto.createHmac('sha256', String(salt)).update(String(val)).digest('hex'));

// --- Column detection cache
const COLUMN_CACHE = new Map(); // key: tenant id, value: { hasEvent, hasAction, hasIp, hasIpAddress, hasUsernameHash, hasIpHash }
async function detectColumns(tenantCtx) {
  const key = tenantCtx.id;
  if (COLUMN_CACHE.has(key)) return COLUMN_CACHE.get(key);
  // Default to legacy 'action' schema to avoid NOT NULL violations on 'action'
  const out = { hasEvent: false, hasAction: true, hasIp: false, hasIpAddress: false, hasUsernameHash: false, hasIpHash: false };
  try {
    const { rows } = await tenantCtx.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_logs'`);
    const set = new Set(rows.map(r => r.column_name));
    out.hasEvent = set.has('event');
    out.hasAction = set.has('action');
    out.hasIp = set.has('ip');
    out.hasIpAddress = set.has('ip_address');
    out.hasUsernameHash = set.has('username_hash');
    out.hasIpHash = set.has('ip_hash');
  } catch {}
  COLUMN_CACHE.set(key, out);
  return out;
}

// --- File rotation (tenant-local)
function rotateIfNeeded(filePath, maxBytes = 5*1024*1024, keep = 7) {
  try { const st = fs.statSync(filePath); if (st.size < maxBytes) return; } catch { return; }
  for (let i = keep - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`; const dst = `${filePath}.${i+1}`; if (fs.existsSync(src)) { try { fs.renameSync(src, dst); } catch {} }
  }
  try { fs.renameSync(filePath, `${filePath}.1`); } catch {}
}
function appendTenantFile(tenantCtx, line) {
  try {
    const dir = tenantCtx.paths.logsDir; fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    const p = path.join(dir, 'audit.log'); rotateIfNeeded(p); fs.appendFileSync(p, line + '\n', { mode: 0o640 });
  } catch {}
}

async function resolveTenantContext(context, details) {
  if (context && typeof context === 'object' && context.tenant?.id && context.tenant?.db) return { tenantId: context.tenant.id, tenantCtx: context.tenant };
  if (context && typeof context === 'object' && context.id && context.db) return { tenantId: context.id, tenantCtx: context };
  const candidate = (typeof context === 'string' && context.trim()) || (details && (details.tenantId || details.tenant_id));
  if (!candidate) return null;
  try { const id = tenantManager.resolveTenantId(candidate); const tenantCtx = await tenantManager.getTenantContext(id); return { tenantId: tenantCtx.id, tenantCtx }; } catch { return null; }
}

async function logEvent(context, event, details = {}) {
  if (!event) throw new Error('Audit-Event benötigt einen Namen.');
  const resolved = await resolveTenantContext(context, details); if (!resolved) return; const { tenantCtx } = resolved;

  const level = String(details.level || 'info').toLowerCase();
  const message = details.message ? String(details.message) : null;
  const userId = details.userId ?? details.user_id ?? null;
  const username = details.username ?? details.userName ?? '';
  const ipRaw = details.ip || details.ip_address || details.ipAddress || '';
  const userAgent = details.ua || details.userAgent || null;
  const correlationId = details.correlationId || details.correlation_id || null;
  const payloadJson = sanitizePayload(details);
  const salt = process.env.AUDIT_SALT || process.env.JWT_SECRET || 'audit-salt';
  const usernameHash = hmac(username, salt);
  const ipHash = hmac(ipRaw, salt);

  // Build column set based on table
  const cols = await detectColumns(tenantCtx);

  // Prepare two variants: event-schema and action-schema
  const buildEventVariant = () => {
    const fields = ['tenant_id','event','level','message','user_id'];
    const values = [tenantCtx.id, event, level, message, userId];
    if (cols.hasAction) { fields.push('action'); values.push(event); }
    if (cols.hasUsernameHash) { fields.push('username_hash'); values.push(usernameHash || null); }
    if (cols.hasIpHash) { fields.push('ip_hash'); values.push(ipHash || null); }
    fields.push('user_agent'); values.push(userAgent || null);
    fields.push('correlation_id'); values.push(correlationId || null);
    fields.push('payload'); values.push(payloadJson);
    return { sql: `INSERT INTO tenant_logs (${fields.join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')})`, params: values };
  };
  const buildActionVariant = () => {
    const fields = ['tenant_id','action','level','message','user_id'];
    const values = [tenantCtx.id, event, level, message, userId];
    if (cols.hasEvent) { fields.push('event'); values.push(event); }
    if (cols.hasUsernameHash) { fields.push('username_hash'); values.push(usernameHash || null); }
    if (cols.hasIpHash) { fields.push('ip_hash'); values.push(ipHash || null); }
    fields.push('user_agent'); values.push(userAgent || null);
    fields.push('correlation_id'); values.push(correlationId || null);
    fields.push('payload'); values.push(payloadJson);
    return { sql: `INSERT INTO tenant_logs (${fields.join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')})`, params: values };
  };

  const tryInsert = async (variant, markCols) => {
    try {
      await tenantCtx.db.query(variant.sql, variant.params);
      if (markCols) { COLUMN_CACHE.set(tenantCtx.id, markCols); }
      return true;
    } catch (e) {
      return e;
    }
  };

  // Decide primary/secondary based on detected columns
  let primary = null, secondary = null, primaryCols = null, secondaryCols = null;
  if (cols.hasEvent) {
    primary = buildEventVariant(); primaryCols = { ...cols, hasEvent: true, hasAction: cols.hasAction };
    secondary = buildActionVariant(); secondaryCols = { ...cols, hasEvent: false, hasAction: true };
  } else {
    primary = buildActionVariant(); primaryCols = { ...cols, hasEvent: false, hasAction: true };
    secondary = buildEventVariant(); secondaryCols = { ...cols, hasEvent: true, hasAction: cols.hasAction };
  }

  // Try primary; on certain errors, fallback to secondary
  let res = await tryInsert(primary, primaryCols);
  if (res !== true) {
    const msg = String(res?.message || '');
    const code = res?.code;
    const shouldFallback = code === '23502' /* not_null_violation */ || code === '42703' /* undefined_column */ || /column .* does not exist/i.test(msg) || /null value in column "action"/.test(msg);
    if (shouldFallback) {
      await tryInsert(secondary, secondaryCols);
    }
    // swallow errors otherwise to avoid breaking the request path
  }

  // Append tenant-local file (pseudonymised)
  const line = JSON.stringify({ ts: new Date().toISOString(), tenant: tenantCtx.id, event, level, message, user_id: userId || undefined, username_hash: usernameHash || undefined, ip_hash: ipHash || undefined, ua: userAgent || undefined, corr: correlationId || undefined });
  appendTenantFile(tenantCtx, line);
}

module.exports = { logEvent, auditLog: logEvent };
