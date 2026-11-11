import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { inject } from 'vitest';
import { PrismaClient, tenancy } from '@app/db';
import { createTestDatabase } from '@app/db/testing';
import { DEMO, seed } from '@app/db/seed';
import { createApp } from '../src/bootstrap';
import { loadEnv, type Env } from '../src/config/env';
import { DB } from '../src/common/db';
import type { DbClient } from '@app/db';

export { DEMO };

export interface TestContext {
  app: INestApplication;
  env: Env;
  /** Unscoped client for assertions and fixtures. */
  raw: PrismaClient;
  db: DbClient;
  venueId: string;
  http: () => ReturnType<typeof request>;
  agent: () => ReturnType<typeof request.agent>;
  close: () => Promise<void>;
}

export function testEnv(databaseUrl: string, overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: inject('redisUrl'),
    REDIS_KEY_PREFIX: `test:${randomUUID()}`,
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    QR_TOKEN_SECRET: 'test-qr-secret-0123456789abcdef-xyz',
    PAYMENTS_PROVIDER: 'mock',
    PAYSTACK_SECRET_KEY: 'sk_test_mock_secret_for_signatures',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'qr-storage-')),
    ENABLE_SCHEDULER: 'false',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_PER_MINUTE: '100000',
    AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    PUBLIC_RATE_LIMIT_PER_MINUTE: '100000',
    API_PUBLIC_URL: 'http://localhost:3999',
    ...overrides,
  });
}

/** Boots the real Nest app against a fresh database seeded with the demo venue. */
export async function createTestContext(
  opts: { env?: Record<string, string>; seed?: boolean } = {},
): Promise<TestContext> {
  const database = await createTestDatabase(inject('pgAdminUrl'), inject('pgTemplateDb'));
  const raw = new PrismaClient({ datasourceUrl: database.url, log: ['error'] });
  let venueId = '';
  if (opts.seed !== false) venueId = (await seed(raw)).venueId;
  const env = testEnv(database.url, opts.env);
  const app = await createApp(env, { logger: false });
  await app.init();
  const server = app.getHttpServer() as Parameters<typeof request>[0];
  return {
    app,
    env,
    raw,
    db: app.get<DbClient>(DB),
    venueId,
    http: () => request(server),
    agent: () => request.agent(server),
    async close() {
      await app.close();
      await raw.$disconnect();
      await database.drop();
    },
  };
}

export const idem = () => ({ 'Idempotency-Key': randomUUID() });

type Agent = ReturnType<typeof request.agent>;

export async function loginOwner(ctx: TestContext): Promise<Agent> {
  const agent = ctx.agent();
  await agent
    .post('/v1/auth/login')
    .send({ email: DEMO.owner.email, password: DEMO.owner.password })
    .expect(200);
  return agent;
}

export async function loginManager(ctx: TestContext): Promise<Agent> {
  const agent = ctx.agent();
  await agent
    .post('/v1/auth/login')
    .send({ email: DEMO.manager.email, password: DEMO.manager.password })
    .expect(200);
  return agent;
}

export async function staffByRole(
  ctx: TestContext,
  role: 'OWNER' | 'MANAGER' | 'WAITER' | 'STATION',
  venueId = ctx.venueId,
) {
  return ctx.raw.staffMember.findFirstOrThrow({ where: { venueId, role } });
}

/** A device enabled by the owner, with a PIN session for the given role. */
export async function pinAgent(
  ctx: TestContext,
  role: 'WAITER' | 'STATION' | 'MANAGER' | 'OWNER',
): Promise<Agent> {
  const agent = await loginOwner(ctx);
  await agent
    .post('/v1/auth/device')
    .send({ name: `${role} device` })
    .expect(201);
  const staff = await staffByRole(ctx, role);
  const pins = {
    OWNER: DEMO.owner.pin,
    MANAGER: DEMO.manager.pin,
    WAITER: DEMO.waiter.pin,
    STATION: DEMO.station.pin,
  };
  await agent.post('/v1/auth/pin-login').send({ staffId: staff.id, pin: pins[role] }).expect(200);
  return agent;
}

export function inVenue<T>(venueId: string, fn: () => Promise<T>): Promise<T> {
  return tenancy.runForVenue(venueId, fn);
}
