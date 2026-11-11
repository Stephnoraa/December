import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { tenancy, type DbClient } from '@app/db';
import { InjectDb } from '../common/db';
import { REDIS, type RedisHandle } from '../common/redis';

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    @InjectDb() private readonly db: DbClient,
    @Inject(REDIS) private readonly redis: RedisHandle,
  ) {}

  /** Liveness: the process is up. */
  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  /** Readiness: database (and Redis when configured) reachable. */
  @Get('readyz')
  async readyz() {
    const checks: Record<string, 'ok' | 'down' | 'disabled'> = {
      database: 'down',
      redis: 'disabled',
    };
    try {
      await tenancy.runAsSystem(() => this.db.$queryRaw`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    if (this.redis.client) {
      try {
        await this.redis.client.ping();
        checks.redis = 'ok';
      } catch {
        checks.redis = 'down';
      }
    }
    if (Object.values(checks).includes('down'))
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    return { status: 'ready', checks };
  }
}
