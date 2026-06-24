import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

/**
 * Bootstrap the NestJS application
 * Configures global pipes, CORS, and starts the server
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Raise the JSON/body limit so chat image & voice-note attachments
  // (base64 data URLs) aren't rejected by the 100kb default.
  const { json, urlencoded } = await import('express');
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));

  // Get configuration service
  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  // Enable CORS for frontend applications
  app.enableCors({
    origin: true, // Configure properly in production
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

  // Start server
  await app.listen(port);

  console.log(`
  🚀 Emergency Coordination System - Backend
  ==========================================
  📍 Server running on: http://localhost:${port}
  📍 API available at: http://localhost:${port}/api
  📍 Environment: ${configService.get('app.nodeEnv')}
  ==========================================
  `);
}

bootstrap();
