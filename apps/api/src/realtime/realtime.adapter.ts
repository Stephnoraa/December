import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../config/env';
import type { RedisHandle } from '../common/redis';

/**
 * Socket.IO server with the Redis adapter when REDIS_URL is set, so events emitted on one
 * Cloud Run instance reach sockets connected to any other. Without Redis: single instance.
 * Docs: https://socket.io/docs/v4/redis-adapter/
 */
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
    private readonly redis: RedisHandle,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: { origin: this.env.corsOrigins, credentials: true },
      // Clients reconnect and refetch; keep heartbeats modest for mobile data.
      pingInterval: 25_000,
      pingTimeout: 20_000,
    }) as Server;
    const pub = this.redis.duplicate();
    const sub = this.redis.duplicate();
    if (pub && sub) server.adapter(createAdapter(pub, sub));
    return server;
  }
}
