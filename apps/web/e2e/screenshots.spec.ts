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
  // Every shared component state (#17); the pending buttons appear after the 300 ms delay.
  { name: 'gallery', path: '/gallery.html', ready: '[data-pending]' },
  // The boot loader at the end of its story, held up by an app script that never arrives.
  { name: 'boot-loader', path: '/', ready: '#boot-loader', blockScript: true, settleMs: 3000 },
];

for (const screen of SCREENS) {
  test(`screenshot: ${screen.name}`, async ({ page }, testInfo) => {
    if (screen.blockScript) {
      await page.route('**/assets/*.js', (route) => route.abort());
    }
    await page.goto(screen.path);
    if (screen.open) {
      await page
        .getByRole('button', { name: screen.open, exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    }
    if (screen.ready) {
      await page.locator(screen.ready).first().waitFor();
    }
    if (screen.settleMs) {
      await page.waitForFunction((ms) => performance.now() > ms, screen.settleMs);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `${screen.name}--${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
