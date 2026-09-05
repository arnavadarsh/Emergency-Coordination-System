import { registerAs } from '@nestjs/config';

/**
 * Supabase project settings.
 *
 * Everything the system stores lives in this one project: rows in its Postgres
 * database, and uploaded chat images in its Storage bucket. Nothing is persisted
 * anywhere else — no local disk, no third-party store — so a deployed instance
 * is stateless and can be restarted or replaced without losing data.
 */
export default registerAs('supabase', () => ({
  /** e.g. https://abcdefgh.supabase.co */
  url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),

  /**
   * Service role key. Server-side only — it bypasses row-level security, so it
   * must never be given to a browser or committed to the repository.
   */
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  storage: {
    /** Bucket holding chat attachments. Create it as a public bucket. */
    bucket: process.env.SUPABASE_STORAGE_BUCKET || 'chat-attachments',
    /** Folder inside the bucket. */
    prefix: process.env.SUPABASE_STORAGE_PREFIX || 'chat',
    uploadTimeoutMs: parseInt(process.env.SUPABASE_STORAGE_TIMEOUT_MS || '15000', 10),
  },
}));
