import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { compareDirs, NOISE_LEVEL } from './compare-screenshots.ts';

// Pure logic: desktop Chrome only (skipped before any page opens on the other devices).
test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile);

/** The PR comment's filter (compare-screenshots.ts): what counts as a changed screenshot. */
test('lists only the screenshots that differ from main beyond rendering noise', async ({
  page,
}, testInfo) => {
  const main = testInfo.outputPath('main');
  const run = testInfo.outputPath('run');
  mkdirSync(main);
  mkdirSync(run);
  const shot = async (dir: string, file: string, html: string, width = 200) => {
    await page.setViewportSize({ width, height: 100 });
    await page.setContent(`<body style="margin:0">${html}</body>`);
    writeFileSync(join(dir, file), await page.screenshot());
  };
  const box = (grey: number) =>
    `<div style="width:100vw;height:100vh;background:rgb(${grey},${grey},${grey})"></div>`;
  // A 2×2 dot on a grey page: a few pixels, like anti-aliasing noise.
  const dot = (grey: number) =>
    `<div style="width:100vw;height:100vh;background:rgb(100,100,100)"><div style="width:2px;height:2px;background:rgb(${grey},${grey},${grey})"></div></div>`;

  // The same bytes.
  await shot(main, 'same--x.png', '<p>Sign in</p>');
  copyFileSync(join(main, 'same--x.png'), join(run, 'same--x.png'));
  // Different bytes, a few pixels within the noise level: unchanged.
  await shot(main, 'noise--x.png', dot(100));
  await shot(run, 'noise--x.png', dot(100 + NOISE_LEVEL));
  // A few pixels moving more than the noise ever does: changed.
  await shot(main, 'dot--x.png', dot(100));
  await shot(run, 'dot--x.png', dot(100 + NOISE_LEVEL + 1));
  // A token nudged by one level, so every pixel it paints moves a little: changed.
  await shot(main, 'token--x.png', box(100));
  await shot(run, 'token--x.png', box(101));
  // A word: changed.
  await shot(main, 'text--x.png', '<p>Sign in</p>');
  await shot(run, 'text--x.png', '<p>Log in</p>');
  // Another size: changed.
  await shot(main, 'size--x.png', '<p>Sign in</p>');
  await shot(run, 'size--x.png', '<p>Sign in</p>', 240);
  // New on this run: changed. Gone from this run: still listed under main.
  await shot(run, 'new--x.png', '<p>New</p>');
  await shot(main, 'gone--x.png', '<p>Gone</p>');

  expect(await compareDirs(run, main)).toEqual({
    shots: 7,
    changed: ['dot--x.png', 'new--x.png', 'size--x.png', 'text--x.png', 'token--x.png'],
    main: [
      'dot--x.png',
      'gone--x.png',
      'noise--x.png',
      'same--x.png',
      'size--x.png',
      'text--x.png',
      'token--x.png',
    ],
  });
  expect(await compareDirs(testInfo.outputPath('main'), testInfo.outputPath('main'))).toMatchObject(
    {
      changed: [],
    },
  );
});
