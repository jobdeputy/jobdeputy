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
      // The component gallery (src/gallery/) is built for tests (`--mode e2e`) and served by the
      // dev server, but never shipped: the production build has the app's page only.
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(mode === 'production'
          ? {}
          : { gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)) }),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    // Playwright owns e2e/; Vitest runs only the unit tests.
    include: ['test/**/*.test.{ts,tsx}'],
  },
}));
