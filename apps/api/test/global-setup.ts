import type { TestProject } from 'vitest/node';
import { startTestPostgres } from '@app/db/testing';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
    pgTemplateDb: string;
    redisUrl: string;
  }
}

/**
 * Starts Postgres and Redis for the integration tests. Uses TEST_DATABASE_URL / TEST_REDIS_URL
 * when set (e.g. native services), otherwise Testcontainers (Docker).
 */
export default async function setup(project: TestProject) {
  const pg = await startTestPostgres();
  let redisUrl = process.env.TEST_REDIS_URL;
  let stopRedis: (() => Promise<unknown>) | undefined;
  if (!redisUrl) {
    const { RedisContainer } = await import('@testcontainers/redis');
    const container = await new RedisContainer('redis:7-alpine').start();
    redisUrl = container.getConnectionUrl();
    stopRedis = () => container.stop();
  }
  project.provide('pgAdminUrl', pg.adminUrl);
  project.provide('pgTemplateDb', pg.templateDb);
  project.provide('redisUrl', redisUrl);
  return async () => {
    await pg.stop();
    await stopRedis?.();
  };
}
