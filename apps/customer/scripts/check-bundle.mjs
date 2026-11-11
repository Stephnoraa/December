// Fails when the customer app's initial JavaScript (entry + modulepreloads) exceeds the
// gzipped budget. Run after `vite build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_BYTES = 200 * 1024;
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = [
  ...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
].map((m) => m[1]);
let total = 0;
for (const src of new Set(scripts)) {
  const file = path.join(dist, src.replace(/^\//, ''));
  const size = gzipSync(readFileSync(file), { level: 9 }).length;
  total += size;
  console.info(`${src}  ${(size / 1024).toFixed(1)} KB gzipped`);
}
console.info(
  `Initial JS: ${(total / 1024).toFixed(1)} KB gzipped (budget ${BUDGET_BYTES / 1024} KB)`,
);
if (total > BUDGET_BYTES) {
  console.error('Customer bundle is over budget');
  process.exit(1);
}
