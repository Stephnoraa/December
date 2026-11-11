#!/usr/bin/env node
// Runs the Prisma CLI against this package's schema, wherever the package is installed
// (dev workspace or the production image). Usage: qr-prisma migrate deploy | qr-prisma generate
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pkgDir = path.resolve(__dirname, '..');
const cli = require.resolve('prisma/build/index.js', { paths: [pkgDir] });
const schema = path.join(pkgDir, 'prisma', 'schema.prisma');
const args = process.argv.slice(2);
const env = { ...process.env };
// Migrations must use Neon's direct (non-pooled) connection.
if (args[0] === 'migrate' && env.DIRECT_DATABASE_URL) env.DATABASE_URL = env.DIRECT_DATABASE_URL;
if (!env.DIRECT_DATABASE_URL && env.DATABASE_URL) env.DIRECT_DATABASE_URL = env.DATABASE_URL;
const res = spawnSync(process.execPath, [cli, ...args, '--schema', schema], {
  stdio: 'inherit',
  env,
});
process.exit(res.status ?? 1);
