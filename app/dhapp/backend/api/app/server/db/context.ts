// server/db/context.ts
import { Pool, PoolClient } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.DB_URL || '';
const sslEnabled = /^(true|1|yes|require)$/i.test(
  String(process.env.DB_SSL || process.env.PG_SSL || process.env.DB_SSLMODE || process.env.PGSSLMODE || '')
);
export const pool = new Pool({
  connectionString: connectionString || undefined,
  host: connectionString ? undefined : (process.env.DB_HOST || process.env.PGHOST || '127.0.0.1'),
  port: connectionString ? undefined : Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  database: connectionString ? undefined : (process.env.DB_NAME || process.env.PGDATABASE || 'postgres'),
  user: connectionString ? undefined : (process.env.DB_USER || process.env.PGUSER || 'postgres'),
  password: connectionString ? undefined : (process.env.DB_PASSWORD || process.env.PGPASSWORD || ''),
  max: Number(process.env.PGPOOL_MAX || 10),
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

export type DbRunner<R> = (client: PoolClient) => Promise<R>;

export async function withDb<R>(
  tenantId: string | null | undefined,
  userId: number | null | undefined,
  run: DbRunner<R>
): Promise<R> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [tenantId ?? '']);
    await client.query('SET LOCAL app.user_id   = $1', [userId ?? null]);
    const res = await run(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function toBigintArrayParam(ids?: (string|number)[]) {
  if (!ids || ids.length === 0) return null;
  return ids.map(v => BigInt(v as any));
}
