'use strict';

const ROLE_ALIAS = Object.freeze({
  admin: 'admin',
  arzt: 'arzt',
  'ärztin': 'arzt',
  doctor: 'arzt',
  mpa: 'mpa',
  assistenz: 'mpa',
  assistant: 'mpa',
  abrechnung: 'billing',
  billing: 'billing',
});

const ROLE_PERMISSION_MATRIX = Object.freeze({
  admin: [
    'patients.read', 'patients.write', 'patients.delete', 'patients.export',
    'appointments.read', 'appointments.write',
    'invoices.read', 'invoices.write',
    'billing.read', 'billing.write',
    'medidata.send',
    'tasks.read', 'tasks.write',
    'users.manage', 'audit.read',
  ],
  arzt: [
    'patients.read', 'patients.write', 'patients.export',
    'appointments.read', 'appointments.write',
    'medidata.send',
    'tasks.read', 'tasks.write',
  ],
  mpa: [
    'patients.read', 'patients.write',
    'appointments.read', 'appointments.write',
    'tasks.read', 'tasks.write',
  ],
  billing: [
    'invoices.read', 'invoices.write',
    'billing.read', 'billing.write',
    'tasks.read',
  ],
});

const FALLBACK_DB_ERRORS = new Set(['42P01', '42703', '42883']);
const SCHEMA_NAME_RE = /^[a-z_][a-z0-9_]*$/;

function quoteIdent(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function normalizeRoleName(role) {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_ALIAS[key] || key || 'mpa';
}

function sanitizeSchemaName(schemaName, fallbackTenantId = 'default') {
  const raw = String(schemaName || '').trim().toLowerCase();
  if (SCHEMA_NAME_RE.test(raw)) return raw;
  const suffix = String(fallbackTenantId || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
  return `tenant_${suffix}`;
}

function parsePermission(permission) {
  const raw = String(permission || '').trim().toLowerCase();
  const [resource, action] = raw.split('.', 2);
  if (!resource || !action) return null;
  return { resource, action, key: `${resource}.${action}` };
}

function fallbackPermissionSetForRole(role) {
  const normalized = normalizeRoleName(role);
  return new Set(ROLE_PERMISSION_MATRIX[normalized] || []);
}

function rowsToPermissionSet(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const resource = String(row?.resource || '').trim().toLowerCase();
    const action = String(row?.action || '').trim().toLowerCase();
    if (!resource || !action) continue;
    set.add(`${resource}.${action}`);
  }
  return set;
}

async function resolvePermissionSetForRole({ db, schemaName, tenantId, role }) {
  const normalizedRole = normalizeRoleName(role);
  const fallback = fallbackPermissionSetForRole(normalizedRole);
  if (!db) return fallback;

  const schema = sanitizeSchemaName(schemaName, tenantId);
  if (!SCHEMA_NAME_RE.test(schema)) return fallback;

  const qSchema = quoteIdent(schema);
  const sql = `
    SELECT p.resource, p.action
      FROM ${qSchema}.roles r
      JOIN ${qSchema}.role_permissions rp ON rp.role_id = r.role_id
      JOIN ${qSchema}.permissions p ON p.permission_id = rp.permission_id
     WHERE lower(r.name) = $1
       AND r.deleted_at IS NULL
  `;

  try {
    const { rows } = await db.query(sql, [normalizedRole]);
    const dbSet = rowsToPermissionSet(rows);
    if (dbSet.size > 0) return dbSet;
    return fallback;
  } catch (err) {
    if (FALLBACK_DB_ERRORS.has(String(err?.code || ''))) {
      return fallback;
    }
    throw err;
  }
}

function hasPermission(permissionSet, permission) {
  const parsed = parsePermission(permission);
  if (!parsed) return false;
  if (!permissionSet) return false;
  if (permissionSet instanceof Set) return permissionSet.has(parsed.key);
  if (Array.isArray(permissionSet)) return permissionSet.includes(parsed.key);
  return false;
}

function toSortedPermissionArray(permissionSet) {
  if (!permissionSet) return [];
  const out = permissionSet instanceof Set ? Array.from(permissionSet) : [].concat(permissionSet);
  return out
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

module.exports = {
  normalizeRoleName,
  sanitizeSchemaName,
  parsePermission,
  fallbackPermissionSetForRole,
  resolvePermissionSetForRole,
  hasPermission,
  toSortedPermissionArray,
};

