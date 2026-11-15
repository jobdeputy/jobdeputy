import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { SCREENS, showScreen } from './screens.ts';

/**
 * Visual baselines (#14): the main screens compared, pixel for pixel, with PNGs in
 * e2e/__screenshots__/, on a desktop, a tablet and a phone. Fonts render differently on each
 * system, so the baselines are made on Linux, as CI runs, by the "Update screenshot baselines"
 * workflow (.github/workflows/screenshot-baselines.yml), and checked on Linux only.
 */
const COMPARED = ['home', 'sign-in', 'gallery'];
const DEVICES = ['desktop-chrome', 'ipad', 'iphone'];

for (const screen of SCREENS.filter((s) => COMPARED.includes(s.name))) {
  test(`looks as approved: ${screen.name}`, async ({ page }, testInfo) => {
    test.skip(!DEVICES.includes(testInfo.project.name), 'compared on three devices');
    test.skip(process.platform !== 'linux', 'baselines are Linux renderings');
    const baseline = `${screen.name}.png`;
    // Until the workflow has made a baseline, there is nothing to compare with.
    test.skip(
      testInfo.config.updateSnapshots === 'none' &&
        !existsSync(testInfo.snapshotPath(baseline, { kind: 'screenshot' })),
      'no baseline yet: run the "Update screenshot baselines" workflow',
    );
    await showScreen(page, screen);
    await expect(page).toHaveScreenshot(baseline, { fullPage: true });
  });
}
