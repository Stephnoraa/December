/**
 * Test database helpers (used by integration tests in this package and in apps/api).
 *
 * Global setup (once per test run):
 *  - If TEST_DATABASE_URL is set (a Postgres server URL whose user can CREATE DATABASE),
 *    it is used directly. Otherwise a throwaway Postgres container is started with
 *    Testcontainers (requires Docker).
 *  - Migrations are applied once to a template database.
 * Each test file then gets its own fresh database cloned from the template, so tests never
 * need to delete audit rows (which the triggers forbid).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';

export interface TestPostgres {
  adminUrl: string;
  templateDb: string;
  stop: () => Promise<void>;
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function adminQuery(adminUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const PRISMA_DIR = path.resolve(__dirname, '..', 'prisma');

export function migrateDatabase(url: string): void {
  const prismaBin = require.resolve('prisma/build/index.js', {
    paths: [path.resolve(__dirname, '..')],
  });
  execFileSync(
    process.execPath,
    [prismaBin, 'migrate', 'deploy', '--schema', path.join(PRISMA_DIR, 'schema.prisma')],
    {
      env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
}

export async function startTestPostgres(): Promise<TestPostgres> {
  let adminUrl = process.env.TEST_DATABASE_URL;
  let stopContainer: (() => Promise<void>) | undefined;
  if (!adminUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:17-alpine').start();
    adminUrl = withDatabase(container.getConnectionUri(), 'postgres');
    stopContainer = async () => {
      await container.stop();
    };
  }
  const templateDb = `qr_tpl_${randomBytes(4).toString('hex')}`;
  await adminQuery(adminUrl, `CREATE DATABASE "${templateDb}"`);
  migrateDatabase(withDatabase(adminUrl, templateDb));
  const url = adminUrl;
  return {
    adminUrl: url,
    templateDb,
    stop: async () => {
      await adminQuery(url, `DROP DATABASE IF EXISTS "${templateDb}" WITH (FORCE)`).catch(
        () => undefined,
      );
      await stopContainer?.();
    },
  };
}

/** Creates a fresh, migrated database for one test file and returns its URL. */
export async function createTestDatabase(adminUrl: string, templateDb: string) {
  const name = `qr_test_${randomBytes(6).toString('hex')}`;
  await adminQuery(adminUrl, `CREATE DATABASE "${name}" TEMPLATE "${templateDb}"`);
  return {
    url: withDatabase(adminUrl, name),
    drop: () => adminQuery(adminUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  };
}
