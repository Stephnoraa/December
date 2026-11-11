import 'reflect-metadata';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from './config/env';
import { createApp } from './bootstrap';

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    loadDotenv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
  }
  const env = loadEnv();
  const app = await createApp(env);
  await app.listen(env.PORT, '0.0.0.0');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
