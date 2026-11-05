import { INestApplication } from '@nestjs/common';
import { env } from './config/env';

export function configureApp(app: INestApplication) {
  const origins = env().CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true, allowedHeaders: ['authorization', 'content-type', 'x-tenant-id', 'idempotency-key'] });
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.enableShutdownHooks();
}
