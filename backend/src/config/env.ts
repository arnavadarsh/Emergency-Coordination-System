/**
 * Environment loading, done before anything else in the process.
 *
 * `ConfigModule.forRoot()` reads .env too, but it does so while AppModule's
 * decorator metadata is being built — which is *after* every entity file has
 * already been imported and its column decorators evaluated. Entities that pick
 * a column type per driver (see common/column-types.ts) therefore need the
 * variables in place earlier than Nest provides them, so main.ts imports this
 * module first.
 */
import { config } from 'dotenv';

config();

/** Whether this process is pointed at the local SQLite database. */
export const isSqlite = (): boolean => process.env.USE_SQLITE === 'true';

/**
 * Whether to write demo hospitals and ambulances into the database at boot.
 *
 * On by default outside production, because an empty database cannot dispatch
 * anything and local work would stall immediately. Off by default in production:
 * a deployment must not quietly put demo rows into the project's real Supabase
 * data. Set SEED_DEMO_DATA=true to opt in on a live test environment.
 */
export const shouldSeedDemoData = (): boolean => {
  if (process.env.SEED_DEMO_DATA !== undefined) return process.env.SEED_DEMO_DATA === 'true';
  return (process.env.NODE_ENV || 'development') !== 'production';
};
