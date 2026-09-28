import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    // Tests share one deployed stack; run them one file at a time.
    fileParallelism: false,
  },
});
