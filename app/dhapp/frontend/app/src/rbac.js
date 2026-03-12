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

export function normalizeRole(role) {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_ALIAS[key] || key || 'mpa';
}

export function permissionListForUser(user) {
  const explicit = Array.isArray(user?.permissions)
    ? user.permissions.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (explicit.length > 0) return Array.from(new Set(explicit));
  const role = normalizeRole(user?.role || user?.rolle);
  return ROLE_PERMISSION_MATRIX[role] ? [...ROLE_PERMISSION_MATRIX[role]] : [];
}

export function hasPermission(user, permission) {
  const key = String(permission || '').trim().toLowerCase();
  if (!key) return false;
  const role = normalizeRole(user?.role || user?.rolle);
  if (role === 'admin') return true;
  return permissionListForUser(user).includes(key);
}

export function hasAnyPermission(user, permissions = []) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  return list.some((entry) => hasPermission(user, entry));
}

