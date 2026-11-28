import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { htmlCopy } from './html-copy.ts';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), htmlCopy()],
  // Always this port: dev stacks let managed login return only to it (LOCAL_WEB_ORIGIN, #111).
  server: { port: 5173, strictPort: true },
  // Preview would follow the dev server's strictPort; it may move to a free port as before.
  preview: { strictPort: false },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      // The component gallery (src/gallery/) is built only for tests (`--mode e2e`, allowed by
      // name so any other mode leaves it out) and served by the dev server. It never ships.
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(mode === 'e2e'
          ? { gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)) }
          : {}),
      },
    },
    // The test build has its own folder, so a deploy (which uploads dist/) can never pick it up.
    ...(mode === 'e2e' ? { outDir: 'dist-e2e' } : {}),
  },
  test: {
    environment: 'happy-dom',
    // A US time zone, as most of the launch's users are in (and never UTC, which hides bugs that
    // read a UTC date in the viewer's zone, #49). Workers inherit it.
    env: { TZ: 'America/New_York' },
    // Playwright owns e2e/; Vitest runs only the unit tests.
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    // A whole test may wait on several of those under load (docs/testing.md: generous timeouts).
    testTimeout: 15_000,
  },
}));
