import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const e = env();
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  if (e.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Park2All API').setVersion('1.0').addBearerAuth().addApiKey({ type: 'apiKey', in: 'header', name: 'x-tenant-id' }, 'tenant').build());
    SwaggerModule.setup('docs', app, doc);
  }
  if (e.NODE_ENV === 'production' && e.ALLOW_SANDBOX_PROVIDERS) {
    app.get(Logger).warn('ALLOW_SANDBOX_PROVIDERS=true: console OTP and sandbox payments are active. Staging only.');
  }
  app.enableShutdownHooks();
  await app.listen(e.PORT, e.HOST);
}
bootstrap();
