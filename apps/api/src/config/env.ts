import { z } from 'zod';

/** All configuration comes from environment variables, validated once at boot. */

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const intWithDefault = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const url = z.url();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    PORT: intWithDefault(3000, 1, 65535),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: bool(false),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: optionalString,
    /** Namespaces rate-limit keys so environments can share one Redis database. */
    REDIS_KEY_PREFIX: optionalString,

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    QR_TOKEN_SECRET: z.string().min(32, 'QR_TOKEN_SECRET must be at least 32 characters'),

    API_PUBLIC_URL: url.default('http://localhost:3000'),
    CUSTOMER_APP_URL: url.default('http://localhost:5173'),
    STAFF_APP_URL: url.default('http://localhost:5174'),
    /** Extra allowed CORS origins, comma separated (the two app URLs are always allowed). */
    CORS_ORIGINS: optionalString,
    COOKIE_DOMAIN: optionalString,
    COOKIE_SECURE: optionalString,

    PAYMENTS_PROVIDER: z.enum(['paystack', 'mock']).optional(),
    PAYSTACK_SECRET_KEY: optionalString,
    PAYSTACK_BASE_URL: url.default('https://api.paystack.co'),
    /** Optional second key accepted for webhook signatures (key rotation / dashboard signing secret). */
    PAYSTACK_WEBHOOK_SECRET: optionalString,
    /** Who pays Paystack's fees on venue transactions: the venue sub-account or the platform account. */
    PAYSTACK_FEE_BEARER: z.enum(['subaccount', 'account']).default('subaccount'),
    /** Platform commission on each venue sub-account (percentage_charge). Subscriptions are billed outside the app. */
    PAYSTACK_SUBACCOUNT_PERCENTAGE: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? 0 : Number(v)))
      .pipe(z.number().min(0).max(100)),
    PAYMENT_RESERVATION_MINUTES: intWithDefault(15, 1, 240),
    RECONCILE_AFTER_MINUTES: intWithDefault(3, 1, 120),
    PAYMENT_ABANDON_MINUTES: intWithDefault(60, 5, 1440),
    PREPAY_ORDER_EXPIRY_MINUTES: intWithDefault(30, 5, 1440),
    ENABLE_SCHEDULER: bool(true),
    /** Staging end-to-end environment only: allow the mock provider with NODE_ENV=production. */
    ALLOW_MOCK_PAYMENTS: bool(false),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: bool(false),
    /** Public base URL for objects under the bucket's public/ prefix (R2 public bucket / custom domain). */
    PUBLIC_ASSET_BASE_URL: optionalString,

    RATE_LIMIT_PER_MINUTE: intWithDefault(300, 10, 100_000),
    AUTH_RATE_LIMIT_PER_MINUTE: intWithDefault(10, 1, 100_000),
    PUBLIC_RATE_LIMIT_PER_MINUTE: intWithDefault(120, 1, 100_000),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of [
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'PUBLIC_ASSET_BASE_URL',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
      }
    }
    if (env.PAYMENTS_PROVIDER === 'paystack' && !env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYSTACK_SECRET_KEY'],
        message: 'Required when PAYMENTS_PROVIDER=paystack',
      });
    }
    const wantsMock =
      env.PAYMENTS_PROVIDER === 'mock' || (!env.PAYMENTS_PROVIDER && !env.PAYSTACK_SECRET_KEY);
    if (wantsMock && env.APP_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_PROVIDER'],
        message: 'The mock payment provider cannot run in production',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (wantsMock && !(env.APP_ENV === 'staging' && env.ALLOW_MOCK_PAYMENTS)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENTS_PROVIDER'],
          message:
            'The mock payment provider needs APP_ENV=staging and ALLOW_MOCK_PAYMENTS=true (end-to-end test environment only)',
        });
      }
      if (env.STORAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_DRIVER'],
          message: 'Use s3 storage in production',
        });
      }
      if (env.APP_ENV === 'production' && env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYSTACK_SECRET_KEY'],
          message: 'Production must use a live Paystack key',
        });
      }
    }
  })
  .transform((env) => {
    const paymentsProvider =
      env.PAYMENTS_PROVIDER ?? (env.PAYSTACK_SECRET_KEY ? 'paystack' : 'mock');
    const cookieSecure =
      env.COOKIE_SECURE === undefined
        ? env.NODE_ENV === 'production'
        : env.COOKIE_SECURE === 'true';
    const corsOrigins = [
      env.CUSTOMER_APP_URL,
      env.STAFF_APP_URL,
      ...(env.CORS_ORIGINS?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? []),
    ].map((o) => o.replace(/\/$/, ''));
    return {
      ...env,
      paymentsProvider,
      redisKeyPrefix: env.REDIS_KEY_PREFIX ?? `qr:${env.APP_ENV}`,
      cookieSecure,
      corsOrigins: [...new Set(corsOrigins)],
      /** Mock checkout + local storage routes: local/test, or an opted-in staging E2E environment. Never production. */
      devRoutesEnabled:
        env.APP_ENV !== 'production' && (env.NODE_ENV !== 'production' || env.ALLOW_MOCK_PAYMENTS),
    };
  });

export type Env = z.output<typeof envSchema>;

export class EnvValidationError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty values (`KEY=` in .env files) as unset so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
