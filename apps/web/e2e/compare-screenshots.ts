import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { SCREENSHOTS_DIR } from './screenshots-dir.ts';

/**
 * Global teardown: which of this run's screenshots differ from main's, so the PR comment shows
 * only those (scripts/publish-ui-screenshots.sh). CI restores main's screenshots into
 * UI_BASELINE_DIR (.github/workflows/web.yml); without them, or if comparing fails, nothing is
 * written and the comment shows every screenshot, as before.
 *
 * Rendering is not perfectly repeatable: an unchanged screen may differ in a few anti-aliased
 * pixels (at most 12 measured on CI), each by at most 3 of 255 in a colour channel. So a shot
 * counts as changed when any pixel moves by more than NOISE_LEVEL, or more than NOISE_PIXELS
 * pixels move at all: a word moves thousands of pixels a lot, a token nudged by one level
 * moves every pixel it paints a little. A screen wrongly shown costs a look; a change wrongly
 * hidden loses its proof.
 */
export const NOISE_LEVEL = 3;
export const NOISE_PIXELS = 50;

export interface Comparison {
  /** Every screenshot of this run: the comment step checks that all of them were compared. */
  shots: number;
  /** File names that differ from main's, or that main does not have. */
  changed: string[];
  /** Every file name main has, so the comment can name screens this run no longer covers. */
  main: string[];
  /** The cache entry main's shots came from (`ui-screenshots-main-<commit>`), if known. */
  baseline?: string;
}

export default async function compareScreenshots() {
  const baselineDir = process.env.UI_BASELINE_DIR;
  if (!baselineDir || !existsSync(baselineDir) || !existsSync(SCREENSHOTS_DIR)) return;
  try {
    const result = await compareDirs(SCREENSHOTS_DIR, baselineDir);
    if (!result) return;
    const key = process.env.UI_BASELINE_KEY;
    if (key) result.baseline = key;
    // One file per test run (CI runs the suite in parts); the comment step reads them all.
    const name = `compare-${process.env.UI_COMPARE_ID ?? 'local'}.json`;
    writeFileSync(join(SCREENSHOTS_DIR, name), `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    // Only the comment's filter: the tests passed, so a failure here must not fail the run.
    console.warn('Could not compare the screenshots with main; the comment shows them all.', error);
  }
}

/** Compares every PNG in `shotsDir` with the same name in `baselineDir`; none: undefined. */
export async function compareDirs(
  shotsDir: string,
  baselineDir: string,
): Promise<Comparison | undefined> {
  const pngs = (dir: string) => readdirSync(dir).filter((file) => file.endsWith('.png'));
  const shots = pngs(shotsDir);
  if (shots.length === 0) return undefined;
  const result: Comparison = {
    shots: shots.length,
    changed: [],
    main: pngs(baselineDir).sort(),
  };
  const toCheck: { file: string; a: Buffer; b: Buffer }[] = [];
  for (const file of shots) {
    const baseline = join(baselineDir, file);
    if (!existsSync(baseline)) {
      result.changed.push(file);
      continue;
    }
    const a = readFileSync(baseline);
    const b = readFileSync(join(shotsDir, file));
    // Most screenshots are byte for byte the same; only the others need decoding.
    if (!a.equals(b)) toCheck.push({ file, a, b });
  }

  if (toCheck.length > 0) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      for (const { file, a, b } of toCheck) {
        const differs = await page.evaluate(pixelsDiffer, {
          a: a.toString('base64'),
          b: b.toString('base64'),
          level: NOISE_LEVEL,
          pixels: NOISE_PIXELS,
        });
        if (differs) result.changed.push(file);
      }
    } finally {
      await browser.close();
    }
  }
  result.changed.sort();
  return result;
}

/** Runs in the browser: does any pixel move by more than `level`, or more than `pixels` at all? */
async function pixelsDiffer(input: { a: string; b: string; level: number; pixels: number }) {
  const decode = async (base64: string) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  };
  const [a, b] = await Promise.all([decode(input.a), decode(input.b)]);
  if (a.width !== b.width || a.height !== b.height) return true;
  const pixels = (image: ImageBitmap) => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No 2D canvas');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const pa = pixels(a);
  const pb = pixels(b);
  let moved = 0;
  for (let i = 0; i < pa.length; i += 4) {
    let most = 0;
    for (let c = i; c < i + 4; c++) most = Math.max(most, Math.abs((pa[c] ?? 0) - (pb[c] ?? 0)));
    if (most > input.level) return true;
    if (most > 0 && ++moved > input.pixels) return true;
  }
  return false;
}
