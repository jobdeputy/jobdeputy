import { join } from 'node:path';
import { test } from '@playwright/test';
import { SCREENSHOTS_DIR } from './screenshots-dir.ts';

/**
 * Proof for UI pull requests: a full-page screenshot of every screen on every device. CI posts
 * them on the PR (.github/workflows/web.yml). Add each new screen here.
 */
const SCREENS = [
  { name: 'home', path: '/' },
  // The drawer, opened from the first visible "Sign in" button.
  { name: 'sign-in', path: '/', open: 'Sign in' },
];

for (const screen of SCREENS) {
  test(`screenshot: ${screen.name}`, async ({ page }, testInfo) => {
    await page.goto(screen.path);
    if (screen.open) {
      await page
        .getByRole('button', { name: screen.open, exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `${screen.name}--${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
