/**
 * Environment for the end-to-end suite, set before any application module is
 * imported (entity column types are chosen at import time, from USE_SQLITE).
 *
 * Every value is set explicitly, so a developer's backend/.env — which may
 * point at a real database or real third-party keys — is never used:
 * config/env.ts loads .env without overriding variables already set here.
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  USE_SQLITE: 'true',
  SQLITE_DB_PATH: ':memory:',
  DATABASE_URL: '',
  DB_HOST: '',
  JWT_SECRET: 'e2e-only-secret-not-used-anywhere-else-0123456789',
  JWT_EXPIRES_IN: '1h',
  CORS_ORIGINS: 'http://localhost:3001',
  SEED_DEMO_DATA: 'true',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@e2e.test',
  BOOTSTRAP_ADMIN_PASSWORD: 'e2e-admin-password',
  DISPATCH_RETRY_INTERVAL_MS: '0',
  DB_KEEPALIVE_INTERVAL_HOURS: '0',
  // The suite signs in many accounts from one address within a minute.
  AUTH_LOGIN_PER_MINUTE: '1000',
  AUTH_REGISTER_PER_HOUR: '1000',
  GEMINI_API_KEY: '',
  GOOGLE_MAPS_API_KEY: '',
  SMS_PROVIDER: '',
  TWILIO_ACCOUNT_SID: '',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
});

// Same as main.ts: the process runs in UTC.
import '../src/config/timezone';
