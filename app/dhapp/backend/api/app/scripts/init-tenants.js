'use strict';

/**
 * Runtime tenant bootstrapper.
 * - Reads DEFAULT_TENANTS (comma-separated) to determine desired tenants.
 * - Delegates database creation, migrations, and storage prep to lib/tenant.
 * - Emits human-readable status to keep Docker logs informative.
 *
 * This script is idempotent and safe to run on every container start.
 */

const fs = require('fs');
const path = require('path');

const tenantManager = require('../lib/tenant');
const { describeTenantStorage } = require('../lib/storage');

const DEFAULT_TENANTS = String(process.env.DEFAULT_TENANTS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

const log = (...args) => console.log('[init-tenants]', ...args);
const warn = (...args) => console.warn('[init-tenants]', ...args);
const error = (...args) => console.error('[init-tenants]', ...args);

async function ensureTenantRegistered(tenantId) {
  try {
    return tenantManager.getTenant(tenantId);
  } catch {
    return null;
  }
}

async function ensureFilesystem(storageDescriptor) {
  Object.values(storageDescriptor).forEach((value) => {
    if (!value) return;
    if (typeof value === 'string') {
      const target = path.extname(value) ? path.dirname(value) : value;
      fs.mkdirSync(target, { recursive: true, mode: 0o750 });
    } else if (typeof value === 'object' && !Buffer.isBuffer(value)) {
      ensureFilesystem(value);
    }
  });
}

async function bootstrapTenant(tenantId) {
  const ctx = await tenantManager.ensureTenantReady(tenantId);
  const storage = describeTenantStorage(ctx);
  await ensureFilesystem(storage);

  log(
    `Tenant "${tenantId}" ready`,
    JSON.stringify({
      database: ctx.config.db.database,
      storageRoot: storage.root,
    })
  );
}

async function main() {
  if (process.env.SKIP_TENANT_INIT === 'true') {
    log('SKIP_TENANT_INIT=true — skipping tenant bootstrap (Flyway manages schema)');
    process.exit(0);
  }

  tenantManager.reloadTenants();

  const configuredTenants = tenantManager.listTenants().map((t) => t.id);
  const targetTenants = DEFAULT_TENANTS.length ? DEFAULT_TENANTS : configuredTenants;

  if (!targetTenants.length) {
    warn('No tenants defined (DEFAULT_TENANTS empty and config has none). Nothing to do.');
    return;
  }

  const missingInConfig = targetTenants.filter((tenantId) => !configuredTenants.includes(tenantId));
  if (missingInConfig.length) {
    warn(
      'Tenants present in DEFAULT_TENANTS but missing from config file:',
      missingInConfig.join(', ')
    );
  }

  for (const tenantId of targetTenants) {
    if (!(await ensureTenantRegistered(tenantId))) {
      warn(`Skipping "${tenantId}" – not present in tenants.json`);
      continue;
    }
    try {
      await bootstrapTenant(tenantId);
    } catch (err) {
      error(`Failed to bootstrap tenant "${tenantId}":`, err.message || err);
      throw err;
    }
  }
}

main()
  .then(() => {
    log('All requested tenants initialised.');
    tenantManager.closeAllPools().catch(() => {});
  })
  .catch((err) => {
    error('Initialisation aborted:', err?.stack || err);
    tenantManager.closeAllPools().catch(() => {});
    process.exit(1);
  });
