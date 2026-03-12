'use strict';

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
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'require', 'required'].includes(normalized);
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readSslConfig() {
  const explicit = first(process.env.DB_SSL, process.env.PG_SSL);
  const sslMode = first(process.env.DB_SSLMODE, process.env.PGSSLMODE).toLowerCase();
  const enabled = asBool(explicit, false) || sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full';
  if (!enabled) return undefined;
  const rejectUnauthorized = asBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, false) || sslMode === 'verify-ca' || sslMode === 'verify-full';
  return { rejectUnauthorized };
}

function readDatabaseConfig() {
  const connectionString = first(process.env.DATABASE_URL, process.env.DB_URL);
  const ssl = readSslConfig();
  if (connectionString) {
    return {
      connectionString,
      ssl,
    };
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

function readTenantProvisioningConfig() {
  const connectionString = first(
    process.env.TENANT_PROVISIONING_URL,
    process.env.PROVISIONING_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.DB_URL
  );
  if (connectionString) {
    return {
      connectionString,
      ssl: readSslConfig(),
    };
  }

  const sslMode = first(process.env.TENANT_PROVISIONING_SSLMODE, process.env.DB_SSLMODE, process.env.PGSSLMODE).toLowerCase();
  const ssl = sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full'
    ? { rejectUnauthorized: sslMode !== 'require' }
    : readSslConfig();

  return {
    host: first(process.env.TENANT_PROVISIONING_HOST, process.env.DB_HOST, process.env.PGHOST, '127.0.0.1'),
    port: asNumber(first(process.env.TENANT_PROVISIONING_PORT, process.env.DB_PORT, process.env.PGPORT, '5432'), 5432),
    user: first(process.env.TENANT_PROVISIONING_USER, process.env.DB_USER, process.env.PGUSER, 'postgres'),
    password: first(process.env.TENANT_PROVISIONING_PASSWORD, process.env.DB_PASSWORD, process.env.PGPASSWORD),
    database: first(process.env.TENANT_PROVISIONING_DATABASE, process.env.DB_NAME, process.env.PGDATABASE, 'postgres'),
    ssl,
  };
}

module.exports = {
  first,
  asBool,
  asNumber,
  readDatabaseConfig,
  readTenantProvisioningConfig,
  readSslConfig,
};
