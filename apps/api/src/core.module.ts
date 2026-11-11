import {
  Global,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  Inject,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { createPrismaClient, type DbClient } from '@app/db';
import { ENV, type Env } from './config/env';
import { AuditService } from './common/audit.service';
import { DB } from './common/db';
import { EventsService } from './common/events.service';
import { createRedisHandle, REDIS, type RedisHandle } from './common/redis';
import { TokenService } from './common/tokens.service';
import { CredentialsService } from './auth/credentials.service';
import { CustomerGuard, PlatformAdminGuard, StaffGuard } from './auth/guards';
import { SessionResolver } from './auth/session-resolver.service';
import { QrTokenService } from './qr/qr-token.service';
import { StorageService } from './storage/storage.service';

const SHARED = [
  AuditService,
  EventsService,
  TokenService,
  SessionResolver,
  CredentialsService,
  StaffGuard,
  CustomerGuard,
  PlatformAdminGuard,
  QrTokenService,
  StorageService,
];

/** Process-wide singletons: config, database, Redis, tokens, audit, realtime emitter. */
@Global()
@Module({})
export class CoreModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    @Inject(REDIS) private readonly redis: RedisHandle,
  ) {}

  static forRoot(env: Env): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        JwtModule.register({ secret: env.SESSION_SECRET, signOptions: { algorithm: 'HS256' } }),
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: DB, useFactory: () => createPrismaClient({ url: env.DATABASE_URL }) },
        { provide: REDIS, useFactory: () => createRedisHandle(env.REDIS_URL) },
        ...SHARED,
      ],
      exports: [ENV, DB, REDIS, JwtModule, ...SHARED],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
    await this.redis.close();
  }
}
