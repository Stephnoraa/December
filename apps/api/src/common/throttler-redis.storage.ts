import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Fixed-window rate-limit counters in Redis, shared by every API instance.
 * One INCR + PEXPIRE (+ PTTL) per request keeps Upstash command usage low.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `${this.prefix}:rl:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }
    const results = await this.redis.multi().incr(hitKey).pttl(hitKey).exec();
    const totalHits = Number(results?.[0]?.[1] ?? 1);
    let pttl = Number(results?.[1]?.[1] ?? -1);
    if (pttl < 0) {
      await this.redis.pexpire(hitKey, ttl);
      pttl = ttl;
    }
    if (totalHits > limit) {
      const duration = blockDuration > 0 ? blockDuration : pttl;
      await this.redis.set(blockKey, '1', 'PX', duration);
      return {
        totalHits,
        timeToExpire: Math.ceil(pttl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(duration / 1000),
      };
    }
    return {
      totalHits,
      timeToExpire: Math.ceil(pttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
