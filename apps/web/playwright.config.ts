import { defineConfig, devices } from '@playwright/test';

// Not vite preview's default (4173), so a preview someone left running is never tested by mistake.
const port = 4319;

/**
 * End-to-end tests run against the production build (vite preview) on every device class we
 * support. `--mode e2e` builds the same production bundle and adds the component gallery
 * (gallery.html), which the shipped build leaves out, in its own `dist-e2e/`. See docs/testing.md and decision 0012.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No retries: a test that needs a second try is flaky, and flaky tests get fixed, not retried.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-safari', use: { ...devices['Desktop Safari'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 11)'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    // The narrowest screen still in use (320px): where layouts overflow first.
    { name: 'small-phone', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 } } },
  ],
  webServer: {
    command: `vite build --mode e2e && vite preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    // Always build and serve fresh: reusing a server could test stale code.
    reuseExistingServer: false,
  },
});
