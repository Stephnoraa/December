import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

/** Redis is optional locally: without REDIS_URL the API uses in-memory adapters (single instance). */
export interface RedisHandle {
  client: Redis | null;
  /** Creates an extra connection (Socket.IO pub/sub needs dedicated ones). */
  duplicate(): Redis | null;
  close(): Promise<void>;
}

export function createRedisHandle(url: string | undefined): RedisHandle {
  if (!url) {
    return { client: null, duplicate: () => null, close: async () => undefined };
  }
  const extra: Redis[] = [];
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return {
    client,
    duplicate() {
      const c = client.duplicate();
      extra.push(c);
      return c;
    },
    async close() {
      await Promise.allSettled([client.quit(), ...extra.map((c) => c.quit())]);
    },
  };
}
