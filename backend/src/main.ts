// Must be first: entity column decorators are evaluated as soon as AppModule is
// imported, and some of them pick a type per database driver — so the .env has
// to be loaded before that happens, earlier than Nest's own ConfigModule runs.
import './config/env';

// Must come before any DB connection or Date is created: pins the process to UTC.
import './config/timezone';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { assertProductionConfig } from './config/startup-checks';
import { configureApp } from './app.setup';

/**
 * Bootstrap the NestJS application
 * Configures global pipes, CORS, and starts the server
 */
async function bootstrap() {
  // Stop here rather than starting misconfigured — see config/startup-checks.ts.
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Behind a load balancer the platform terminates the connection, so a
    // crash must not take pending requests with it.
    bufferLogs: false,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  configureApp(app);

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
