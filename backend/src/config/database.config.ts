import { registerAs } from '@nestjs/config';

/**
 * Database connection.
 *
 * All persistent data lives in the project's Supabase Postgres instance. Supabase
 * hands out a single connection string, so DATABASE_URL is the preferred input
 * and the discrete DB_* variables remain as a fallback for local Postgres.
 *
 * Use the **session pooler / transaction pooler** URI from Supabase for a
 * deployed app (port 6543) rather than the direct connection (5432): a container
 * that restarts or scales out will otherwise exhaust the direct connection limit.
 */
export default registerAs('database', () => {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

  return {
    /** Full connection string; when set it wins over the discrete fields. */
    url,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'ecs_db',

    /**
     * Supabase terminates TLS with a certificate chain Node does not ship, so
     * verification is off by default — the connection is still encrypted. Set
     * DB_SSL_REJECT_UNAUTHORIZED=true once you supply a CA bundle.
     */
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },

    /** Run pending migrations at startup. Recommended for a single-instance deploy. */
    migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
  };
});
