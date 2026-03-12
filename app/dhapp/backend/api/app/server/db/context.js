// server/db/context.js (CommonJS)
const { Pool } = require('pg');
const { readDatabaseConfig } = require('../../lib/config/env');

const dbConfig = readDatabaseConfig();
const pool = new Pool({
  ...dbConfig,
  max: Number(process.env.PGPOOL_MAX || 10),
});

/**
 * Runs a function with a dedicated DB client.
 * Backward-compatible signature:
 *   - withDb(tenantId, userId, run, { transaction })
 *   - withDb(run, { transaction })  // no GUCs
 * transaction: 'none' | 'auto' | 'manual'
 * options.readOnly: boolean — if true and transaction='auto', sets transaction READ ONLY
 *   - none: no BEGIN/COMMIT, set session GUCs and RESET after
 *   - auto: wraps fn in BEGIN/COMMIT and uses SET LOCAL for GUCs
 *   - manual: no tx mgmt; caller controls; session GUCs set+RESET
 */
async function withDb(a, b, c, d) {
  let tenantId, userId, run, options;
  if (typeof a === 'function') {
    // new-style: withDb(run, options?)
    run = a;
    options = b || {};
  } else {
    // old-style: withDb(tenantId, userId, run, options?)
    tenantId = a;
    userId = b;
    run = c;
    options = d || {};
  }

  const transaction = options.transaction || 'auto';
  const readOnly = Boolean(options.readOnly);
  const client = await pool.connect();
  let startedTx = false;
  let gucsSet = false;

  const quote = (v) => String(v).replace(/'/g, "''");

  try {
    if (transaction === 'auto') {
      await client.query('BEGIN');
      startedTx = true;
      if (readOnly) {
        try { await client.query('SET TRANSACTION READ ONLY'); } catch (_) { /* ignore */ }
      }
    }

    // Set GUCs for tenant/user context when provided
    if (tenantId !== undefined || userId !== undefined) {
      if (transaction === 'auto') {
        // SET LOCAL only valid inside txn
        try {
          if (tenantId != null && tenantId !== '') {
            await client.query(`SET LOCAL app.tenant_id = '${quote(tenantId)}'`);
          } else {
            await client.query('RESET LOCAL app.tenant_id');
          }
        } catch (_) { /* ignore for compatibility */ }
        try {
          if (Number.isFinite(userId)) {
            await client.query(`SET LOCAL app.user_id = '${quote(userId)}'`);
          } else {
            await client.query('RESET LOCAL app.user_id');
          }
        } catch (_) { /* ignore for compatibility */ }
      } else {
        // Use session-level SET and ensure RESET in finally
        try {
          if (tenantId != null && tenantId !== '') {
            await client.query(`SET app.tenant_id = '${quote(tenantId)}'`);
          } else {
            await client.query('RESET app.tenant_id');
          }
          if (Number.isFinite(userId)) {
            await client.query(`SET app.user_id = '${quote(userId)}'`);
          } else {
            await client.query('RESET app.user_id');
          }
          gucsSet = true;
        } catch (_) { /* ignore for compatibility */ }
      }
    }

    const result = await run(client);

    if (startedTx) {
      await client.query('COMMIT');
    }
    return result;
  } catch (err) {
    if (startedTx) {
      try { await client.query('ROLLBACK'); } catch (rollbackErr) {
        console.error('[DB] ROLLBACK failed:', rollbackErr);
      }
    }
    throw err;
  } finally {
    // Reset session-level GUCs if set without transaction
    if (gucsSet && !startedTx) {
      try { await client.query('RESET app.tenant_id'); } catch (_) {}
      try { await client.query('RESET app.user_id'); } catch (_) {}
    }
    client.release();
  }
}

function toBigintArrayParam(ids) {
  if (!ids || ids.length === 0) return null;
  return ids.map((v) => BigInt(v));
}

// Safety nets
pool.on('error', (err) => {
  console.error('[pg-pool] idle client error', err);
});

process.on('SIGTERM', async () => {
  try { await pool.end(); } catch (_) {}
  process.exit(0);
});
// Convenience helper to mirror API expected by some routes
withDb.transaction = async (fn) => withDb(fn, { transaction: 'auto' });
withDb.readonly = async (...args) => {
  // supports withDb.readonly(run) or withDb.readonly(tenantId, userId, run)
  if (typeof args[0] === 'function') {
    return withDb(args[0], { transaction: 'auto', readOnly: true });
  }
  const [tenantId, userId, run] = args;
  return withDb(tenantId, userId, run, { transaction: 'auto', readOnly: true });
};

module.exports = { pool, withDb, toBigintArrayParam };
