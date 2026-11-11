import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
const proxy = {
  '/v1': { target: apiTarget, changeOrigin: true },
  '/media': { target: apiTarget, changeOrigin: true },
  '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
};

export default defineConfig({
  resolve: {
    // The zod-free shared entry keeps the customer bundle small.
    alias: {
      '@app/shared': fileURLToPath(new URL('../../packages/shared/src/client.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Order at your table',
        short_name: 'Order',
        description: 'See the menu, order and pay from your table',
        theme_color: '#047857',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/v1\//, /^\/socket\.io/, /^\/media\//],
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            // Menu photos: cache-first, they are immutable (content-addressed keys).
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/media/') || url.pathname.includes('/public/menu/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'menu-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 86400 },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 5173, proxy },
  build: { target: 'es2019', sourcemap: true, cssCodeSplit: true },
  test: { include: ['test/**/*.test.ts'] },
});
