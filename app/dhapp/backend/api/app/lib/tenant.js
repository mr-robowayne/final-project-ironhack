'use strict';

const fs = require('fs');
const path = require('path');
const { Pool, Client } = require('pg');
const {
  readDatabaseConfig,
  readTenantProvisioningConfig,
  asBool,
  first,
} = require('./config/env');

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TENANT_ID = String(process.env.DEFAULT_TENANT_ID || 'dhpatientsync').trim();
const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const ALLOW_INSECURE_DB_SSL = asBool(process.env.ALLOW_INSECURE_DB_SSL, false);
const REQUIRE_DB_TLS_IN_PROD = asBool(process.env.REQUIRE_DB_TLS_IN_PROD, true);
const MIGRATION_SEED_DEMO_DATA = asBool(process.env.MIGRATION_SEED_DEMO_DATA, !isProd);
const SKIP_LEGACY_COMPAT_MIGRATIONS = asBool(process.env.SKIP_LEGACY_COMPAT_MIGRATIONS, false);

const MIGRATIONS_DIR = path.join(APP_ROOT, 'migrations');
const BASE_SCHEMA_PATH = path.join(APP_ROOT, 'db', 'schema.sql');
const MIGRATION_TABLE = 'schema_migrations';

const poolCache = new Map();
const pathCache = new Map();
const bootstrapPromises = new Map();

let cachedConfig = null;
let migrationFilesCache = null;
let shutdownHookRegistered = false;
let baseSchemaCache = null;
const baseDbConfig = readDatabaseConfig();
const sharedDbName = first(process.env.DB_NAME, process.env.PGDATABASE, 'patientsync');
const SHOULD_CREATE_DATABASES = asBool(process.env.TENANT_PROVISIONING_CREATE_DATABASES, false);

const configPathFromEnv = () => {
  const raw = process.env.TENANT_CONFIG_PATH;
  if (!raw) return path.join(APP_ROOT, 'config', 'tenants.json');
  return path.isAbsolute(raw) ? raw : path.join(APP_ROOT, raw);
};

const maybeResolveEnvPlaceholder = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('$env:')) return value;
  const envName = trimmed.slice(5);
  return process.env[envName] || '';
};

const quoteIdent = (val) => `"${String(val).replace(/"/g, '""')}"`;

function sanitizeTenantSqlSuffix(tenantId) {
  const normalized = String(tenantId || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return normalized.replace(/^_+|_+$/g, '') || 'default';
}

function sanitizeSchemaName(value, fallbackTenantId) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized && /^[a-z_][a-z0-9_]*$/.test(normalized)) return normalized;
  return `tenant_${sanitizeTenantSqlSuffix(fallbackTenantId)}`;
}

const storageTemplateFromEnv = () => {
  const raw = maybeResolveEnvPlaceholder(
    process.env.TENANT_STORAGE_BASE_PATH || process.env.TENANT_STORAGE_ROOT
  );
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  return path.join(APP_ROOT, raw);
};

const adminConfigFromEnv = () => {
  return readTenantProvisioningConfig();
};

const adminConfigCache = adminConfigFromEnv();

function normalizeTenantEntry(entry, fallbackId) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Ungültiger Mandanten-Eintrag in der Konfiguration.');
  }
  const id = String(entry.id || fallbackId || '').trim();
  if (!id) throw new Error('Mandanten-Konfiguration benötigt eine ID.');

  const db = entry.db || {};
  const tenantConnectionString = maybeResolveEnvPlaceholder(db.connectionString || db.url);
  const hasTenantDbOverrides = ['user', 'host', 'database', 'password', 'port'].some((key) => db[key] !== undefined && db[key] !== null && String(db[key]).trim() !== '');
  const resolvedDb = tenantConnectionString
    ? { connectionString: tenantConnectionString }
    : (!hasTenantDbOverrides && baseDbConfig.connectionString
      ? { connectionString: baseDbConfig.connectionString }
      : {
      user: maybeResolveEnvPlaceholder(db.user) || baseDbConfig.user || process.env.PGUSER || 'postgres',
      host: maybeResolveEnvPlaceholder(db.host) || baseDbConfig.host || process.env.PGHOST || 'localhost',
      database: maybeResolveEnvPlaceholder(db.database) || baseDbConfig.database || sharedDbName,
      password: maybeResolveEnvPlaceholder(db.password) ?? baseDbConfig.password ?? process.env.PGPASSWORD ?? '',
      port: Number(maybeResolveEnvPlaceholder(db.port) || baseDbConfig.port || process.env.PGPORT || 5432),
    });
  const sslMode = (maybeResolveEnvPlaceholder(db.sslmode) || process.env.PGSSLMODE || '').toLowerCase();
  if (db.ssl) {
    resolvedDb.ssl = db.ssl;
  } else if (baseDbConfig.ssl) {
    resolvedDb.ssl = baseDbConfig.ssl;
  } else if (sslMode === 'require') {
    const rejectUnauthorized = asBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, isProd);
    resolvedDb.ssl = { rejectUnauthorized };
  } else if (sslMode === 'verify-ca' || sslMode === 'verify-full') {
    resolvedDb.ssl = { rejectUnauthorized: true };
  }

  // Production hardening for transport encryption to RDS/DB.
  if (isProd && REQUIRE_DB_TLS_IN_PROD && !resolvedDb.ssl && !ALLOW_INSECURE_DB_SSL) {
    throw new Error(
      `Mandant ${id}: DB TLS ist in Produktion erforderlich (setze DB_SSL/DB_SSLMODE oder ALLOW_INSECURE_DB_SSL=true).`
    );
  }
  if (
    isProd &&
    resolvedDb.ssl &&
    resolvedDb.ssl.rejectUnauthorized === false &&
    !ALLOW_INSECURE_DB_SSL
  ) {
    throw new Error(
      `Mandant ${id}: Unsichere DB-SSL-Konfiguration in Produktion (rejectUnauthorized=false).`
    );
  }

  const rawStorage = maybeResolveEnvPlaceholder(entry.storageRoot);
  const envTemplate = storageTemplateFromEnv();
  let storageRoot;
  if (rawStorage) {
    storageRoot = path.isAbsolute(rawStorage)
      ? rawStorage
      : path.join(APP_ROOT, rawStorage);
  } else if (envTemplate) {
    storageRoot = path.join(envTemplate, id);
  } else {
    storageRoot = path.join(APP_ROOT, 'storage', id);
  }

  const displayName = String(entry.displayName || entry.name || id);
  const meta = entry.meta ? JSON.parse(JSON.stringify(entry.meta)) : {};
  const schemaName = sanitizeSchemaName(
    maybeResolveEnvPlaceholder(entry.schemaName || entry.schema_name || entry.schema),
    id
  );
  const planRaw = String(maybeResolveEnvPlaceholder(entry.plan) || '').trim().toLowerCase();
  const countryRaw = String(maybeResolveEnvPlaceholder(entry.country) || '').trim().toUpperCase();
  const dataResidency = String(
    maybeResolveEnvPlaceholder(entry.dataResidency || entry.data_residency) || 'eu-central-2'
  ).trim();

  return {
    id,
    displayName,
    db: resolvedDb,
    storageRoot,
    schemaName,
    plan: ['basic', 'pro', 'enterprise'].includes(planRaw) ? planRaw : 'basic',
    country: ['CH', 'DE', 'AT'].includes(countryRaw) ? countryRaw : 'CH',
    dataResidency: dataResidency || 'eu-central-2',
    meta,
  };
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const configPath = configPathFromEnv();
  let rawConfig = null;
  if (fs.existsSync(configPath)) {
    try {
      rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Konfigurationsdatei ${configPath} konnte nicht gelesen werden: ${err.message}`);
    }
  } else {
    rawConfig = {
      defaultTenant: DEFAULT_TENANT_ID,
      tenants: {
        [DEFAULT_TENANT_ID]: {
          id: DEFAULT_TENANT_ID,
          displayName: DEFAULT_TENANT_ID,
          db: {
            user: process.env.PGUSER || 'eladmin',
            host: process.env.PGHOST || 'localhost',
            database: process.env.DB_NAME || process.env.PGDATABASE || sharedDbName,
            password: process.env.PGPASSWORD || '',
            port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
            sslmode: process.env.DB_SSLMODE || process.env.PGSSLMODE || undefined,
          },
          storageRoot: process.env.TENANT_STORAGE_BASE_PATH || process.env.TENANT_STORAGE_ROOT || path.join('storage', DEFAULT_TENANT_ID),
        },
      },
    };
  }

  const tenantsRaw = rawConfig.tenants;
  const tenantsMap = new Map();

  if (Array.isArray(tenantsRaw)) {
    tenantsRaw.forEach((entry) => {
      const normalized = normalizeTenantEntry(entry);
      tenantsMap.set(normalized.id, normalized);
    });
  } else if (tenantsRaw && typeof tenantsRaw === 'object') {
    Object.entries(tenantsRaw).forEach(([key, entry]) => {
      const normalized = normalizeTenantEntry(entry, key);
      tenantsMap.set(normalized.id, normalized);
    });
  } else {
    const normalized = normalizeTenantEntry(rawConfig, rawConfig.id || DEFAULT_TENANT_ID);
    tenantsMap.set(normalized.id, normalized);
  }

  if (tenantsMap.size === 0) {
    const fallback = normalizeTenantEntry({}, DEFAULT_TENANT_ID);
    tenantsMap.set(fallback.id, fallback);
  }

  const defaultTenant = String(rawConfig.defaultTenant || DEFAULT_TENANT_ID).trim();
  const resolvedDefault = tenantsMap.has(defaultTenant)
    ? defaultTenant
    : Array.from(tenantsMap.keys())[0];

  cachedConfig = {
    configPath,
    defaultTenant: resolvedDefault,
    tenants: tenantsMap,
  };

  return cachedConfig;
}

function reloadTenants() {
  cachedConfig = null;
  return loadConfig();
}

function listTenants() {
  return Array.from(loadConfig().tenants.values());
}

function getTenant(tenantId) {
  const id = String(tenantId || '').trim();
  const cfg = loadConfig();
  if (!id) throw new Error('Mandanten-ID fehlt.');
  const tenant = cfg.tenants.get(id);
  if (!tenant) throw new Error(`Unbekannter Mandant: ${id}`);
  return tenant;
}

function getDefaultTenantId() {
  return loadConfig().defaultTenant;
}

function resolveTenantId(inputId) {
  const cfg = loadConfig();
  if (!inputId) return cfg.defaultTenant;
  const id = String(inputId).trim();
  // If tenant is in static config, return directly.
  if (cfg.tenants.has(id)) return id;
  // Accept any valid-format tenant ID — existence is verified against the DB
  // in ensureTenantReady() via tenant_registry. This allows DB-driven tenants
  // without requiring a hardcoded entry in tenants.json.
  if (/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) return id;
  throw new Error(`Ungültige Mandanten-ID: ${id}`);
}

function getBootstrappedTenantIds() {
  return Array.from(bootstrapPromises.keys());
}

function ensureTenantPaths(tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) throw new Error('Mandanten-ID fehlt.');
  if (pathCache.has(id)) return pathCache.get(id);

  const tenant = getTenant(id);
  const baseDir = path.isAbsolute(tenant.storageRoot)
    ? tenant.storageRoot
    : path.join(APP_ROOT, tenant.storageRoot);

  const dataDir = path.join(baseDir, 'data');
  const dataPatientsDir = path.join(dataDir, 'patients');
  const dataInvoicesDir = path.join(dataDir, 'invoices');

  const documentsDir = path.join(baseDir, 'documents');
  const pdfDir = path.join(documentsDir, 'pdfs');
  const jsonDir = path.join(documentsDir, 'json');
  const xmlDir = path.join(documentsDir, 'xml');
  const ackDir = path.join(documentsDir, 'ack');

  const uploadsDir = path.join(baseDir, 'uploads');
  const tmpDir = path.join(baseDir, 'tmp');
  const patientFilesDir = path.join(baseDir, 'patient-files');

  const logsDir = path.join(baseDir, 'logs');

  [
    baseDir, dataDir, dataPatientsDir, dataInvoicesDir,
    documentsDir, pdfDir, jsonDir, xmlDir, ackDir,
    uploadsDir, tmpDir, patientFilesDir, logsDir,
  ].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  });

  const faelleJsonPath = path.join(dataDir, 'faelle.json');
  if (!fs.existsSync(faelleJsonPath)) {
    fs.writeFileSync(faelleJsonPath, '[]', 'utf8');
  }

  const auditLogPath = path.join(logsDir, 'audit.log');

  const paths = {
    baseDir,
    dataDir,
    dataPatientsDir,
    dataInvoicesDir,
    documentsDir,
    uploadsDir,
    pdfDir,
    jsonDir,
    xmlDir,
    ackDir,
    tmpDir,
    patientFilesDir,
    logsDir,
    faelleJsonPath,
    auditLogPath,
  };

  pathCache.set(id, paths);
  return paths;
}

async function ensureTenantDatabase(tenant) {
  if (!SHOULD_CREATE_DATABASES) return;
  if (tenant?.db?.connectionString) return;
  if (!tenant?.db?.database) return;
  const adminConfig = adminConfigCache || {
    host: tenant.db.host,
    port: tenant.db.port,
    user: tenant.db.user,
    password: tenant.db.password,
    database: 'postgres',
    ssl: tenant.db.ssl,
  };
  const client = new Client(adminConfig);
  await client.connect();
  try {
    const dbName = tenant.db.database;
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount > 0) return;

    const ownerClause = tenant.db.user ? ` OWNER ${quoteIdent(tenant.db.user)}` : '';
    try {
      await client.query(`CREATE DATABASE ${quoteIdent(dbName)}${ownerClause}`);
    } catch (err) {
      if (err.code === '42704' && ownerClause) {
        await client.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
      } else if (err.code !== '42P04') {
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function ensureTenantScopedTables(tenantId, pool) {
  const suffix = sanitizeTenantSqlSuffix(tenantId);
  const bootstrapTable = quoteIdent(`tenant_${suffix}_bootstrap`);
  const storageTable = quoteIdent(`tenant_${suffix}_storage_objects`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${bootstrapTable} (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      initialized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${storageTable} (
      id BIGSERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      object_type TEXT NOT NULL DEFAULT 'file',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(`uq_tenant_${suffix}_storage_objects`)}
      ON ${storageTable} (tenant_id, object_key)
  `);
  await pool.query(
    `INSERT INTO ${bootstrapTable} (tenant_id, notes)
     SELECT $1, 'tenant bootstrap completed'
     WHERE NOT EXISTS (SELECT 1 FROM ${bootstrapTable} WHERE tenant_id = $1)`,
    [tenantId]
  );
}

async function ensureTenantRegistryEntry(tenant, paths, pool) {
  const schemaName = sanitizeSchemaName(tenant.schemaName, tenant.id);
  const plan = ['basic', 'pro', 'enterprise'].includes(String(tenant.plan || '').toLowerCase())
    ? String(tenant.plan).toLowerCase()
    : 'basic';
  const country = ['CH', 'DE', 'AT'].includes(String(tenant.country || '').toUpperCase())
    ? String(tenant.country).toUpperCase()
    : 'CH';
  const dataResidency = String(tenant.dataResidency || 'eu-central-2').trim() || 'eu-central-2';

  try {
    await pool.query(
      `SELECT public.provision_tenant_schema($1, $2, $3, $4, $5)`,
      [tenant.id, schemaName, plan, country, dataResidency]
    );
  } catch (err) {
    if (String(err?.code || '') !== '42883') {
      throw err;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenant_registry (
         tenant_id, display_name, status, storage_root, schema_name, plan, country, data_residency, deleted_at
       )
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, NULL)
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'active',
         storage_root = EXCLUDED.storage_root,
         schema_name = EXCLUDED.schema_name,
         plan = EXCLUDED.plan,
         country = EXCLUDED.country,
         data_residency = EXCLUDED.data_residency,
         deleted_at = NULL,
         updated_at = now()
       RETURNING tenant_id, tenant_uuid, schema_name, plan, country, data_residency, status, deleted_at`,
      [tenant.id, tenant.displayName || tenant.id, paths.baseDir, schemaName, plan, country, dataResidency]
    );
    return result.rows[0] || null;
  } catch (err) {
    // Backward compatible fallback for environments where migration 250 is not applied yet.
    if (!['42703', '42P01'].includes(String(err?.code || ''))) {
      throw err;
    }
    await pool.query(
      `INSERT INTO tenant_registry (tenant_id, display_name, status, storage_root)
       VALUES ($1, $2, 'active', $3)
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         status = 'active',
         storage_root = EXCLUDED.storage_root,
         updated_at = now()`,
      [tenant.id, tenant.displayName || tenant.id, paths.baseDir]
    );
    return {
      tenant_id: tenant.id,
      tenant_uuid: null,
      schema_name: schemaName,
      plan,
      country,
      data_residency: dataResidency,
      status: 'active',
      deleted_at: null,
    };
  }
}

async function syncTenantAuthUsers(tenantId, schemaName, pool) {
  try {
    await pool.query(
      `SELECT public.sync_tenant_users_from_legacy($1, $2)`,
      [tenantId, schemaName || null]
    );
  } catch (err) {
    // Backward compatible for databases where migration 270 is not applied yet.
    if (String(err?.code || '') !== '42883') {
      throw err;
    }
  }
}

function loadMigrationFiles() {
  if (migrationFilesCache) return migrationFilesCache;
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    migrationFilesCache = [];
    return migrationFilesCache;
  }
  migrationFilesCache = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      id: name,
      path: path.join(MIGRATIONS_DIR, name),
    }));
  return migrationFilesCache;
}

function loadBaseSchemaSql() {
  if (baseSchemaCache !== null) return baseSchemaCache;
  if (!fs.existsSync(BASE_SCHEMA_PATH)) {
    baseSchemaCache = '';
    return baseSchemaCache;
  }
  baseSchemaCache = fs.readFileSync(BASE_SCHEMA_PATH, 'utf8');
  return baseSchemaCache;
}

async function applyBaseSchemaIfMissing(pool) {
  const schemaSql = loadBaseSchemaSql();
  if (!schemaSql) return;
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'users'
      ) AS present
    `);
    if (rows[0]?.present) return;

    await client.query('BEGIN');
    try {
      await client.query(schemaSql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Basisschema konnte nicht angewendet werden: ${err.message}`);
    }
  } finally {
    client.release();
  }
}

async function runMigrationsForTenant(tenantId, pool) {
  const migrations = loadMigrationFiles();
  // Skip fragile legacy migration(s) that conflict with aligned schema
  const SKIP_MIGRATIONS = new Set([
    '20250211-001_create_tenant_settings.sql',
  ]);
  if (SKIP_LEGACY_COMPAT_MIGRATIONS) {
    for (const legacyId of [
      '20250210-000_compat_users_rolle.sql',
      '20250210-001_compat_users_tenant_id.sql',
      '20250210-002_compat_users_tenant_default.sql',
      '20250210-003_compat_users_name_nullable.sql',
      '20250210-004_compat_users_role_nullable.sql',
      '20250210-005_compat_users_insert_defaults.sql',
      '20250210-006_compat_view_patienten.sql',
      '20250210-007_force_drop_not_null_users.sql',
      '20250210-008_preseed_users_min.sql',
      '20250210-009_compat_patients_tenant_insert.sql',
    ]) {
      SKIP_MIGRATIONS.add(legacyId);
    }
  }
  // Never run demo user seed automatically in hardened/prod setups.
  if (isProd || !MIGRATION_SEED_DEMO_DATA) {
    SKIP_MIGRATIONS.add('20250210-008_preseed_users_min.sql');
  }
  if (!migrations.length) return;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const appliedRows = await client.query(`SELECT id FROM ${MIGRATION_TABLE}`);
    const appliedSet = new Set(appliedRows.rows.map((row) => row.id));

    for (const migration of migrations) {
      if (SKIP_MIGRATIONS.has(migration.id)) {
        console.warn(`[migrations] Skipping ${migration.id} for tenant ${tenantId}`);
        // Mark as applied so we don't retry later
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (id) VALUES ($1) ON CONFLICT DO NOTHING`, [migration.id]);
        continue;
      }
      if (appliedSet.has(migration.id)) continue;
      const sql = fs.readFileSync(migration.path, 'utf8');
      await client.query('BEGIN');
      try {
        const envValue = isProd ? 'production' : 'development';
        const seedValue = MIGRATION_SEED_DEMO_DATA ? 'on' : 'off';
        await client.query(`SET LOCAL app.env = '${envValue}'`);
        await client.query(`SET LOCAL app.seed_demo_data = '${seedValue}'`);
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (id) VALUES ($1)`, [migration.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.id} fehlgeschlagen für Mandant ${tenantId}: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

function registerShutdownHook() {
  if (shutdownHookRegistered) return;
  shutdownHookRegistered = true;
  process.once('exit', () => {
    for (const pool of poolCache.values()) {
      try { pool.end(); } catch {}
    }
  });
}

async function ensureTenantReady(tenantId) {
  const id = resolveTenantId(tenantId);
  if (bootstrapPromises.has(id)) return bootstrapPromises.get(id);

  const promise = (async () => {
    // Try static config first; fall back to shared DB config for tenants
    // that exist only in tenant_registry (DB-driven, no entry in tenants.json).
    let tenant;
    try {
      tenant = getTenant(id);
    } catch {
      tenant = normalizeTenantEntry({ id, displayName: id }, id);
    }
    const paths = ensureTenantPaths(id);
    await ensureTenantDatabase(tenant);
    let pool = poolCache.get(id);
    if (!pool) {
      pool = new Pool(tenant.db);
      poolCache.set(id, pool);
      registerShutdownHook();
    }
    await applyBaseSchemaIfMissing(pool);
    await runMigrationsForTenant(id, pool);
    await ensureTenantScopedTables(id, pool);
    const registry = await ensureTenantRegistryEntry(tenant, paths, pool);
    const schemaName = sanitizeSchemaName(registry?.schema_name || tenant.schemaName, id);
    await syncTenantAuthUsers(id, schemaName, pool);
    const plan = String(registry?.plan || tenant.plan || 'basic').toLowerCase();
    const country = String(registry?.country || tenant.country || 'CH').toUpperCase();
    const dataResidency = String(
      registry?.data_residency || tenant.dataResidency || 'eu-central-2'
    );
    return {
      id: tenant.id,
      displayName: tenant.displayName,
      config: tenant,
      meta: tenant.meta || {},
      tenantUuid: registry?.tenant_uuid || null,
      schemaName,
      plan: ['basic', 'pro', 'enterprise'].includes(plan) ? plan : 'basic',
      country: ['CH', 'DE', 'AT'].includes(country) ? country : 'CH',
      dataResidency: dataResidency || 'eu-central-2',
      db: pool,
      paths,
    };
  })();

  bootstrapPromises.set(id, promise);
  try {
    const ctx = await promise;
    return ctx;
  } catch (err) {
    poolCache.delete(id);
    bootstrapPromises.delete(id);
    throw err;
  }
}

async function getTenantPool(tenantId) {
  const ctx = await ensureTenantReady(tenantId);
  return ctx.db;
}

async function getTenantContext(tenantId) {
  return ensureTenantReady(tenantId);
}

async function bootstrapAllTenants() {
  const tenants = listTenants();
  for (const tenant of tenants) {
    await ensureTenantReady(tenant.id);
  }
}

async function closeAllPools() {
  const pools = Array.from(poolCache.values());
  await Promise.allSettled(pools.map((pool) => pool.end()));
  poolCache.clear();
  bootstrapPromises.clear();
}

module.exports = {
  listTenants,
  getTenant,
  getTenantPool,
  getTenantContext,
  ensureTenantPaths,
  getDefaultTenantId,
  resolveTenantId,
  getBootstrappedTenantIds,
  ensureTenantReady,
  bootstrapAllTenants,
  closeAllPools,
  reloadTenants,
};
