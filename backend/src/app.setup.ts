import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOAD_ROOT } from './uploads/uploads.constants';
import { corsOriginOption } from './config/cors';
import { OriginCheckedIoAdapter } from './realtime/socket-io.adapter';

/**
 * Everything that turns a bare Nest application into this API: proxy trust,
 * CORS, the origin-checked socket adapter, request validation, the /api
 * prefix and the development uploads folder.
 *
 * main.ts and the end-to-end tests both call this, so the tests exercise the
 * exact pipeline production runs rather than a copy that could drift from it.
 */
export function configureApp(app: NestExpressApplication): void {
  const configService = app.get(ConfigService);

  // Trust the proxy in front of the app so req.ip is the real client and not
  // the balancer — per-caller rate limiting depends on telling callers apart.
  if (configService.get<boolean>('rateLimit.trustProxy', false)) {
    app.set('trust proxy', true);
    new Logger('Bootstrap').log('Trusting X-Forwarded-For from the upstream proxy');
  }

  // Reflecting whatever origin asks is fine on a laptop and wrong on the public
  // internet: combined with credentials it lets any site call the API as a
  // signed-in user. The socket gets the same list — see config/cors.ts.
  app.enableCors({
    origin: corsOriginOption(),
    credentials: true,
  });
  app.useWebSocketAdapter(new OriginCheckedIoAdapter(app));

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
}
