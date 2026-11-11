import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost/db',
  SESSION_SECRET: 'x'.repeat(32),
  QR_TOKEN_SECRET: 'y'.repeat(32),
};
const prodStorage = {
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  PUBLIC_ASSET_BASE_URL: 'https://media.example.ng',
};

describe('environment validation', () => {
  it('applies defaults and treats empty values as unset', () => {
    const env = loadEnv({ ...base, PORT: '', PAYMENTS_PROVIDER: '' });
    expect(env.PORT).toBe(3000);
    expect(env.paymentsProvider).toBe('mock');
    expect(env.devRoutesEnabled).toBe(true);
    expect(env.cookieSecure).toBe(false);
    expect(env.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('reports every missing or weak secret', () => {
    expect(() => loadEnv({ DATABASE_URL: 'x', SESSION_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
    try {
      loadEnv({ DATABASE_URL: 'x', SESSION_SECRET: 'short' });
    } catch (e) {
      expect(String(e)).toMatch(/SESSION_SECRET/);
      expect(String(e)).toMatch(/QR_TOKEN_SECRET/);
    }
  });

  it('uses Paystack when a key is set and refuses the mock in production', () => {
    expect(loadEnv({ ...base, PAYSTACK_SECRET_KEY: 'sk_test_1' }).paymentsProvider).toBe(
      'paystack',
    );
    expect(() =>
      loadEnv({ ...base, ...prodStorage, NODE_ENV: 'production', APP_ENV: 'production' }),
    ).toThrow(/mock payment provider/);
    expect(() =>
      loadEnv({ ...base, ...prodStorage, NODE_ENV: 'production', APP_ENV: 'staging' }),
    ).toThrow(/ALLOW_MOCK_PAYMENTS/);
    const e2e = loadEnv({
      ...base,
      ...prodStorage,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      ALLOW_MOCK_PAYMENTS: 'true',
    });
    expect(e2e.paymentsProvider).toBe('mock');
    expect(e2e.devRoutesEnabled).toBe(true);
    expect(() =>
      loadEnv({
        ...base,
        ...prodStorage,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        ALLOW_MOCK_PAYMENTS: 'true',
      }),
    ).toThrow(/mock payment provider/);
  });

  it('requires live keys and S3 storage in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        ...prodStorage,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        PAYSTACK_SECRET_KEY: 'sk_test_1',
      }),
    ).toThrow(/live Paystack key/);
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        PAYSTACK_SECRET_KEY: 'sk_live_1',
        STORAGE_DRIVER: 'local',
      }),
    ).toThrow(/s3/);
    const prod = loadEnv({
      ...base,
      ...prodStorage,
      NODE_ENV: 'production',
      APP_ENV: 'production',
      PAYSTACK_SECRET_KEY: 'sk_live_1',
    });
    expect(prod).toMatchObject({
      paymentsProvider: 'paystack',
      devRoutesEnabled: false,
      cookieSecure: true,
      redisKeyPrefix: 'qr:production',
    });
  });
});
