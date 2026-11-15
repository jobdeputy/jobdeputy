import { join } from 'node:path';
import { test } from '@playwright/test';
import { SCREENS, showScreen } from './screens.ts';
import { SCREENSHOTS_DIR } from './screenshots-dir.ts';

/**
 * Proof for UI pull requests: a full-page screenshot of every screen on every device. CI posts
 * them on the PR (.github/workflows/web.yml). Add each new screen to e2e/screens.ts.
 */
for (const screen of SCREENS) {
  test(`screenshot: ${screen.name}`, async ({ page }, testInfo) => {
    await showScreen(page, screen);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `${screen.name}--${testInfo.project.name}.png`),
      fullPage: true,
      // 'disabled' fast-forwards finite animations, which would show the loader's 8 s reload
      // offer early; the loader's screens are captured as they stand.
      animations: screen.blockScript ? 'allow' : 'disabled',
    });
  });
}

// The boot loader with scripts turned off: the noscript line, without a loading look.
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('screenshot: boot-loader-no-js', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator('#boot-loader noscript p').waitFor();
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `boot-loader-no-js--${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
});
