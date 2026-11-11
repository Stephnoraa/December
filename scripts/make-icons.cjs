// Renders the PWA icons from an inline SVG. Run: node scripts/make-icons.cjs (uses sharp from apps/api).
const path = require('node:path');
const fs = require('node:fs');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../apps/api')] }));

const icon = (bg, fg, accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${bg}"/>
  <g fill="${fg}">
    <rect x="112" y="112" width="112" height="112" rx="16"/><rect x="288" y="112" width="112" height="112" rx="16"/>
    <rect x="112" y="288" width="112" height="112" rx="16"/>
  </g>
  <g fill="${bg}"><rect x="144" y="144" width="48" height="48" rx="6"/><rect x="320" y="144" width="48" height="48" rx="6"/><rect x="144" y="320" width="48" height="48" rx="6"/></g>
  <circle cx="344" cy="344" r="56" fill="${accent}"/>
</svg>`;

async function render(dir, bg, fg, accent) {
  const svg = icon(bg, fg, accent);
  fs.writeFileSync(path.join(dir, 'favicon.svg'), svg);
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(dir, name));
  }
}

(async () => {
  await render(path.join(__dirname, '../apps/staff/public'), '#0f172a', '#ffffff', '#10b981');
  fs.mkdirSync(path.join(__dirname, '../apps/customer/public'), { recursive: true });
  await render(path.join(__dirname, '../apps/customer/public'), '#047857', '#ffffff', '#fbbf24');
  console.info('icons written');
})();
