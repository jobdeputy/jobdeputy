import { defineConfig } from 'vitest/config';

/** Fast unit tests for the test helpers themselves; no AWS needed. */
export default defineConfig({ test: { include: ['src/**/*.unit.test.ts'] } });
