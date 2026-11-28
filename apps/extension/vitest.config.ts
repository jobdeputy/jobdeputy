import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    // Generous timeouts (docs/testing.md): the Greenhouse filler waits up to 1.5 s per choice
    // widget, so a form with several took 5.3–6.3 s under a full parallel `pnpm verify`.
    testTimeout: 15_000,
  },
});
