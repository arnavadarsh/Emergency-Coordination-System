import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load environment variables for migrations
config();

/**
 * TypeORM DataSource for the migration CLI.
 *
 * Resolved from __dirname so the same file works before and after compilation:
 * `.ts` when run through ts-node locally, `.js` from dist inside the deployed
 * image. Hard-coded `src/**` globs would have made the compiled build find no
 * entities and no migrations.
 *
 * DATABASE_URL (the Supabase connection string) wins over the discrete DB_*
 * variables, matching how the application connects.
 */
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';

export default new DataSource({
  type: 'postgres',
  ...(url
    ? { url }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_DATABASE || 'ecs_db',
      }),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false, // Always use migrations in production
  logging: process.env.NODE_ENV === 'development',
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },
  extra: { connectionTimeoutMillis: 15000 },
});
