import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
const BASELINES = join(import.meta.dirname, '__screenshots__');
const made = existsSync(BASELINES) ? readdirSync(BASELINES).filter((f) => f.endsWith('.png')) : [];
// Before the workflow's first run there are none, and the comparisons wait for them. Once there
// are any, a missing one fails (a renamed screen or device must not pass by checking nothing).
const bootstrapping = made.length === 0;

for (const screen of SCREENS.filter((s) => COMPARED.includes(s.name))) {
  test(`looks as approved: ${screen.name}`, async ({ page }, testInfo) => {
    test.skip(!DEVICES.includes(testInfo.project.name), 'compared on three devices');
    test.skip(process.platform !== 'linux', 'baselines are Linux renderings');
    const baseline = `${screen.name}.png`;
    test.skip(
      bootstrapping && testInfo.config.updateSnapshots === 'none',
      'no baselines yet: run the "Update screenshot baselines" workflow',
    );
    await showScreen(page, screen);
    await expect(page).toHaveScreenshot(baseline, { fullPage: true });
  });
}

// Every baseline belongs to a compared screen on a compared device: one left behind by a removed
// screen would be compared with again, unreviewed, if the name came back.
test('keeps no stray baselines', async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'desktop-chrome',
    'one listing, one check',
  );
  const expected = COMPARED.flatMap((screen) =>
    DEVICES.map((device) => `${screen}--${device}.png`),
  );
  expect(made.filter((file) => !expected.includes(file))).toEqual([]);
});
