import { defineConfig } from '@playwright/test';

// #54: the built extension (`pnpm build` first), loaded unpacked in Chromium. Only Chromium runs
// extensions; Firefox and Safari come with #55.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
});
