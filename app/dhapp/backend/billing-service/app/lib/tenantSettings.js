'use strict';

const ensureObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

async function loadTenantSettingsJson(tenantCtx, { prefer = 'settings' } = {}) {
  const tenantId = tenantCtx?.id;
  if (!tenantId) throw new Error('tenantCtx.id fehlt');

  const trySelect = async (column) => {
    const { rows } = await tenantCtx.db.query(
      `SELECT ${column} AS json
         FROM tenant_settings
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );
    const json = rows.length ? ensureObject(rows[0]?.json) : {};
    return { column, json };
  };

  try {
    if (prefer === 'metadata') return await trySelect('metadata');
    return await trySelect('settings');
  } catch (err) {
    if (err?.code === '42P01') {
      return { column: null, json: {} };
    }
    if (err?.code === '42703') {
      // Column doesn't exist → fallback to the other column
      if (prefer === 'metadata') {
        return await trySelect('settings');
      }
      return await trySelect('metadata');
    }
    throw err;
  }
}

async function saveTenantSettingsJson(tenantCtx, json, { prefer = 'settings' } = {}) {
  const tenantId = tenantCtx?.id;
  if (!tenantId) throw new Error('tenantCtx.id fehlt');
  const value = ensureObject(json);

  const tryUpsert = async (column) => {
    await tenantCtx.db.query(
      `INSERT INTO tenant_settings (tenant_id, ${column}, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = now()`,
      [tenantId, value]
    );
    return { column, json: value };
  };

  try {
    if (prefer === 'metadata') return await tryUpsert('metadata');
    return await tryUpsert('settings');
  } catch (err) {
    if (err?.code === '42P01') {
      throw new Error('tenant_settings Tabelle fehlt (Migration ausführen).');
    }
    if (err?.code === '42703') {
      if (prefer === 'metadata') return await tryUpsert('settings');
      return await tryUpsert('metadata');
    }
    throw err;
  }
}

module.exports = {
  loadTenantSettingsJson,
  saveTenantSettingsJson
};

