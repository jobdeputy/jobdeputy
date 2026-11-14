import { test } from '@playwright/test';

/**
 * Proof for UI pull requests: a full-page screenshot of every screen on every device. CI posts
 * them on the PR (.github/workflows/web.yml). Add each new screen here.
 */
const SCREENS = [{ name: 'home', path: '/' }];

for (const screen of SCREENS) {
  test(`screenshot: ${screen.name}`, async ({ page }, testInfo) => {
    await page.goto(screen.path);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `screenshots/${screen.name}--${testInfo.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}
