import { existsSync, readdirSync, rmSync } from 'node:fs';
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
// Every file there, not only PNGs (dot files such as .DS_Store aside).
const made = existsSync(BASELINES)
  ? readdirSync(BASELINES).filter((file) => !file.startsWith('.'))
  : [];
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
// screen would be compared with again, unreviewed, if the name came back. A test run fails on
// one; an update run on Linux (the workflow) removes it, so its new branch drops it.
test('keeps no stray baselines', async ({ baseURL: _baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'one listing, one check');
  const expected = COMPARED.flatMap((screen) =>
    DEVICES.map((device) => `${screen}--${device}.png`),
  );
  const strays = made.filter((file) => !expected.includes(file));
  if (testInfo.config.updateSnapshots !== 'none') {
    // Only where the baselines are made (Linux): elsewhere the comparisons skip and would not
    // make the replacements.
    test.skip(process.platform !== 'linux', 'baselines are Linux renderings');
    for (const file of strays) rmSync(join(BASELINES, file), { recursive: true });
    return;
  }
  expect(strays).toEqual([]);
});
