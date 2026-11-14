import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
    // Playwright owns e2e/; Vitest runs only the unit tests.
    include: ['test/**/*.test.{ts,tsx}'],
  },
}));
