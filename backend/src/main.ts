// Must be first: entity column decorators are evaluated as soon as AppModule is
// imported, and some of them pick a type per database driver — so the .env has
// to be loaded before that happens, earlier than Nest's own ConfigModule runs.
import './config/env';

// Must come before any DB connection or Date is created: pins the process to UTC.
import './config/timezone';

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOAD_ROOT } from './uploads/uploads.constants';
import { assertProductionConfig } from './config/startup-checks';

/**
 * Origins allowed to call the API.
 *
 * `CORS_ORIGINS` is a comma-separated list of the dashboard origins, e.g.
 * "https://ecs.example.com,https://admin.ecs.example.com". Reflecting whatever
 * origin asks — the old behaviour — is fine on a laptop and wrong on the public
 * internet: combined with credentials it lets any site call the API as a
 * signed-in user.
 */
function resolveCorsOrigin(configService: ConfigService): any {
  const configured = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (configured.length > 0) {
    return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      // Same-origin and server-to-server requests send no Origin header.
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, '');
      if (configured.includes(normalized) || configured.includes('*')) return callback(null, true);
      return callback(null, false);
    };
  }

  // Development convenience only; startup checks refuse this in production.
  return configService.get('app.nodeEnv') === 'production' ? false : true;
}

/**
 * Bootstrap the NestJS application
 * Configures global pipes, CORS, and starts the server
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Stop here rather than starting misconfigured — see config/startup-checks.ts.
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Behind a load balancer the platform terminates the connection, so a
    // crash must not take pending requests with it.
    bufferLogs: false,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  // Trust the proxy in front of the app so req.ip is the real client and not
  // the balancer — per-caller rate limiting depends on telling callers apart.
  if (configService.get<boolean>('rateLimit.trustProxy', false)) {
    app.set('trust proxy', true);
    logger.log('Trusting X-Forwarded-For from the upstream proxy');
  }

  app.enableCors({
    origin: resolveCorsOrigin(configService),
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      forbidNonWhitelisted: true, // Throw error for extra properties
      transform: true, // Auto-transform payloads to DTO types
    }),
  );

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // Development-only fallback for chat attachments. In a deployment these live
  // in Supabase Storage and are served from there, so nothing is read off this
  // container's disk.
  app.useStaticAssets(UPLOAD_ROOT, { prefix: '/uploads' });

  // Finish in-flight requests before the process exits on SIGTERM, which is how
  // every container platform asks an instance to stop.
  app.enableShutdownHooks();

  // 0.0.0.0, not localhost: a container's port has to be reachable from outside
  // it. HOST can override — Railway's private networking is IPv6-only, so a
  // service reached over `*.railway.internal` needs HOST=::  instead.
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`
  🚀 Emergency Coordination System - Backend
  ==========================================
  📍 Listening on: ${host}:${port}
  📍 API base:     /api
  📍 Health:       /api/health  ·  Readiness: /api/health/ready
  📍 Environment:  ${configService.get('app.nodeEnv')}
  ==========================================
  `);
}

bootstrap().catch(error => {
  // A configuration failure must be loud and must not leave a half-started process.
  new Logger('Bootstrap').error(error?.message ?? error);
  process.exit(1);
});
