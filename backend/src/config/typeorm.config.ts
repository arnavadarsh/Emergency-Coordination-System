import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';

// Load environment variables for migrations
config();

const configService = new ConfigService();

/**
 * TypeORM DataSource configuration for migrations
 * Used by TypeORM CLI for generating and running migrations
 */
export default new DataSource({
  type: 'postgres',
  host: configService.get('DB_HOST', 'localhost'),
  port: configService.get('DB_PORT', 5432),
  username: configService.get('DB_USERNAME', 'postgres'),
  password: configService.get('DB_PASSWORD', 'postgres'),
  database: configService.get('DB_DATABASE', 'ecs_db'),
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  synchronize: false, // Always use migrations in production
  logging: configService.get('NODE_ENV') === 'development',
});
