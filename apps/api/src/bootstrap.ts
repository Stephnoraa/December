import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { tenantContextMiddleware } from './common/tenant.middleware';
import { REDIS, type RedisHandle } from './common/redis';
import { RealtimeAdapter } from './realtime/realtime.adapter';
import { RATE_LIMITS_KEY, type RateLimits } from './common/rate-limits';

/** Builds the configured Nest application (used by main.ts and by integration tests). */
export async function createApp(
  env: Env,
  opts: { logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    rawBody: true,
    bufferLogs: opts.logger !== false,
    logger: opts.logger === false ? false : undefined,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  if (env.TRUST_PROXY) app.set('trust proxy', true);
  app.getHttpAdapter().getInstance().locals[RATE_LIMITS_KEY] = {
    auth: env.AUTH_RATE_LIMIT_PER_MINUTE,
    public: env.PUBLIC_RATE_LIMIT_PER_MINUTE,
  } satisfies RateLimits;
  app.disable('x-powered-by');
  app.use(tenantContextMiddleware);
  app.use(
    helmet({
      // The API serves JSON (and PDFs/images in dev); the PWAs set their own CSP.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
    maxAge: 600,
  });
  if (env.STORAGE_DRIVER === 'local') {
    const { StorageService } = await import('./storage/storage.service');
    app.use(
      '/assets',
      express.static(app.get(StorageService).localRoot(), { maxAge: '1h', fallthrough: false }),
    );
  }
  app.useWebSocketAdapter(new RealtimeAdapter(app, env, app.get<RedisHandle>(REDIS)));
  app.enableShutdownHooks();
  return app;
}
