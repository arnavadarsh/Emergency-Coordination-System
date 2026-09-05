import { Logger } from '@nestjs/common';
import { isSqlite } from './env';

/**
 * Refuse to start a production process that is configured to lose data or leak
 * access. Each of these has a safe local default that is actively unsafe in a
 * deployment, which is exactly the kind of setting that reaches production
 * unnoticed — so the process stops rather than starting up wrong.
 */

const INSECURE_JWT_DEFAULT = 'your-super-secret-jwt-key-change-this-in-production';

export function assertProductionConfig(): void {
  const logger = new Logger('StartupChecks');
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';

  const problems: string[] = [];
  const warnings: string[] = [];

  // ── Persistence: the Supabase project is the only place data may live ──────
  if (isSqlite()) {
    problems.push(
      'USE_SQLITE=true — local SQLite is for development only, and its data disappears with the container. ' +
        'Unset it so the app uses the Supabase Postgres database.',
    );
  }

  const hasConnectionString = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
  const hasDiscreteDbConfig = Boolean(process.env.DB_HOST && process.env.DB_PASSWORD);
  if (!hasConnectionString && !hasDiscreteDbConfig) {
    problems.push('No database configured — set DATABASE_URL to the Supabase connection string.');
  }

  // ── Uploads: chat images belong in Supabase Storage, not container disk ────
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required so chat attachments are stored in Supabase Storage. ' +
        'Without them uploads would be written to the container filesystem and lost on restart.',
    );
  }

  // ── Access ────────────────────────────────────────────────────────────────
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === INSECURE_JWT_DEFAULT) {
    problems.push('JWT_SECRET is unset or still the shipped default — anyone could mint a valid token.');
  } else if (process.env.JWT_SECRET.length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters; use a long random value.');
  }

  if (!process.env.CORS_ORIGINS) {
    problems.push(
      'CORS_ORIGINS is unset. In production the API must name the exact dashboard origins it accepts, ' +
        'rather than reflecting whatever origin asks.',
    );
  }

  // ── Things that work but will behave oddly ────────────────────────────────
  if (!process.env.PUBLIC_TRACKING_BASE_URL || process.env.PUBLIC_TRACKING_BASE_URL.includes('localhost')) {
    warnings.push(
      'PUBLIC_TRACKING_BASE_URL still points at localhost — tracking links texted to emergency contacts ' +
        'will not open on their phones.',
    );
  }

  if ((process.env.SMS_PROVIDER || 'log') === 'log') {
    warnings.push('SMS_PROVIDER=log — emergency contacts will NOT receive real messages; alerts only reach the log.');
  }

  if (process.env.SEED_DEMO_DATA === 'true') {
    warnings.push('SEED_DEMO_DATA=true — demo hospitals and ambulances will be written to the database on boot.');
  }

  warnings.forEach(warning => logger.warn(warning));

  if (problems.length === 0) return;

  if (!isProduction) {
    problems.forEach(problem => logger.warn(`[would fail in production] ${problem}`));
    return;
  }

  problems.forEach(problem => logger.error(problem));
  throw new Error(
    `Refusing to start in production with ${problems.length} unsafe setting(s) — see the errors above.`,
  );
}
