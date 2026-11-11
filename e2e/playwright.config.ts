import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Critical-path end-to-end test. Runs the built API and both PWAs (vite preview) against a
 * dedicated database that global-setup recreates, migrates and seeds.
 * Requires `pnpm build` first. Services: Postgres (E2E_DATABASE_URL) and Redis (E2E_REDIS_URL).
 * Set E2E_BASE_* to run against an already deployed environment (e.g. staging) instead.
 */
const ROOT = path.resolve(__dirname, '..');
export const E2E = {
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgresql://qr:qr@127.0.0.1:5432/qr_e2e',
  redisUrl: process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14',
  apiPort: 3010,
  customerPort: 4173,
  staffPort: 4174,
};
const remote = Boolean(process.env.E2E_BASE_STAFF_URL);
export const URLS = {
  api: process.env.E2E_BASE_API_URL ?? `http://localhost:${E2E.apiPort}`,
  customer: process.env.E2E_BASE_CUSTOMER_URL ?? `http://localhost:${E2E.customerPort}`,
  staff: process.env.E2E_BASE_STAFF_URL ?? `http://localhost:${E2E.staffPort}`,
};

const apiEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: String(E2E.apiPort),
  DATABASE_URL: E2E.databaseUrl,
  DIRECT_DATABASE_URL: E2E.databaseUrl,
  REDIS_URL: E2E.redisUrl,
  REDIS_KEY_PREFIX: `e2e:${Date.now()}`,
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghij',
  QR_TOKEN_SECRET: 'e2e-qr-token-secret-0123456789abcdefghij',
  API_PUBLIC_URL: URLS.customer,
  CUSTOMER_APP_URL: URLS.customer,
  STAFF_APP_URL: URLS.staff,
  PAYMENTS_PROVIDER: 'mock',
  PAYSTACK_SECRET_KEY: 'sk_test_e2e_mock_webhook_secret',
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: path.join(ROOT, '.data/e2e-storage'),
  LOG_LEVEL: 'warn',
  RATE_LIMIT_PER_MINUTE: '100000',
  AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  PUBLIC_RATE_LIMIT_PER_MINUTE: '10000',
};

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: remote ? undefined : './global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: remote
    ? undefined
    : [
        {
          command: 'node apps/api/dist/main.js',
          cwd: ROOT,
          url: `http://localhost:${E2E.apiPort}/healthz`,
          env: apiEnv,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `pnpm --filter @app/customer exec vite preview --port ${E2E.customerPort} --strictPort`,
          cwd: ROOT,
          url: URLS.customer,
          env: { API_PROXY_TARGET: `http://localhost:${E2E.apiPort}` },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `pnpm --filter @app/staff exec vite preview --port ${E2E.staffPort} --strictPort`,
          cwd: ROOT,
          url: URLS.staff,
          env: { API_PROXY_TARGET: `http://localhost:${E2E.apiPort}` },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
