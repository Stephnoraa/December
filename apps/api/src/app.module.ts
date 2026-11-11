import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from './config/env';
import { CoreModule } from './core.module';
import { AllExceptionsFilter } from './common/error.filter';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { REDIS, type RedisHandle } from './common/redis';
import { RedisThrottlerStorage } from './common/throttler-redis.storage';
import { HealthController } from './health/health.controller';
import { AuthController, PlatformAuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { FEATURE_MODULES } from './features';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    const imports: (DynamicModule | Type)[] = [
      CoreModule.forRoot(env),
      LoggerModule.forRoot({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
          // Cloud Logging reads "severity".
          formatters: { level: (label) => ({ severity: label.toUpperCase(), level: label }) },
        },
      }),
      ThrottlerModule.forRootAsync({
        inject: [REDIS],
        useFactory: (redis: RedisHandle) => ({
          throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
          storage: redis.client ? new RedisThrottlerStorage(redis.client) : undefined,
        }),
      }),
      ...FEATURE_MODULES,
    ];
    if (env.ENABLE_SCHEDULER) imports.push(ScheduleModule.forRoot());
    return {
      module: AppModule,
      imports,
      controllers: [HealthController, AuthController, PlatformAuthController],
      providers: [
        AuthService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
