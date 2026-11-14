import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

/**
 * The boot loader (index.html, lib/boot-loader.ts). A real boot is too quick to catch reliably, so
 * these tests hold the app's script back: the loader is then the slow boot every visitor on a weak
 * connection sees. The 300 ms delay and 500 ms hold are unit-tested (test/boot-loader.test.tsx).
 */
const APP_SCRIPT = '**/assets/*.js';
const loader = (page: Page) => page.locator('#boot-loader');

/**
 * Waits until the loader has really been revealed: its CSS reveal has run past the delay. Neither
 * the loader's box (there from the first paint) nor its words (visible in the unstyled page, before
 * the stylesheet applies) can tell.
 */
async function waitForReveal(page: Page) {
  await page.waitForFunction(() => {
    const reveal = document
      .getElementById('boot-loader')
      ?.getAnimations({ subtree: true })
      .find((animation) => (animation as CSSAnimation).animationName === 'boot-reveal');
    return typeof reveal?.currentTime === 'number' && reveal.currentTime > 300;
  });
  await expect(loader(page).getByText('Loading…')).toBeVisible();
}

/** Opens the page with the app's script never arriving: the loader stays, on a loaded page. */
async function openWithoutScript(page: Page) {
  await page.route(APP_SCRIPT, (route) => route.abort());
  await page.goto('/');
  await waitForReveal(page);
}

/** The page's animation once the (held) loader is set to hand over, as the CSS gives it. */
function riseAtDone(page: Page) {
  return page.evaluate(() => {
    (document.getElementById('boot-loader') as HTMLElement).dataset.state = 'done';
    return getComputedStyle(document.getElementById('root') as HTMLElement).animationName;
  });
}

/** Opens the page with the app's script held back until the returned `release` is called. */
async function openWithScriptHeld(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(APP_SCRIPT, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await waitForReveal(page);
  return release;
}

/**
 * How much of the track the fill covers (0 to 1) at the moment the loader hands over. Recorded in
 * the page as the state flips, so the 618 ms fade cannot outrun the check.
 */
async function recordFillAtHandOver(page: Page) {
  await page.evaluate(() => {
    const loader = document.getElementById('boot-loader') as HTMLElement;
    const fill = loader.querySelector('span[aria-hidden] > span') as HTMLElement;
    new MutationObserver((_records, observer) => {
      if (loader.dataset.state !== 'done') return;
      observer.disconnect();
      const share =
        fill.getBoundingClientRect().width /
        (fill.parentElement as HTMLElement).getBoundingClientRect().width;
      document.documentElement.dataset.fillAtHandOver = share.toFixed(2);
      // The page rises in under the fading loader, on its timing.
      const rise = document.getElementById('root')?.getAnimations()[0];
      const start = (rise?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]?.transform;
      document.documentElement.dataset.riseAtHandOver = rise
        ? `${rise.effect?.getTiming().duration} from ${start}`
        : 'undefined';
    }).observe(loader, { attributes: true });
  });
  return () => page.evaluate(() => document.documentElement.dataset.fillAtHandOver);
}

test('a slow boot shows the loader, then hands over to the app', async ({ page }) => {
  const release = await openWithScriptHeld(page);
  await expect(page.getByRole('progressbar', { name: 'Loading JobDeputy' })).toBeVisible();
  const fillAtHandOver = await recordFillAtHandOver(page);

  release();
  await expect(loader(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'JobDeputy is ready.' })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' }),
  ).toBeVisible();
  expect(await fillAtHandOver()).toBe('1.00');
  expect(await page.evaluate(() => document.documentElement.dataset.riseAtHandOver)).toBe(
    '618 from translateY(13px)',
  );
  expect(await page.evaluate(() => document.getElementById('root')?.inert)).toBe(false);
  // The hand-over never moves focus.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('a boot that stalls offers a reload at the 8 s long wait', async ({ page }) => {
  await openWithoutScript(page);
  const address = page.url();
  const reload = loader(page).getByRole('link', { name: 'Reload' });
  await expect(reload).toBeHidden();
  const offer = loader(page).getByRole('status');
  await expect(offer).toHaveText('This is taking longer than usual. Reload', { timeout: 15_000 });
  await expect(reload).toBeVisible();
  await expectNoAccessibilityViolations(page);

  const reloaded = page.waitForEvent('framenavigated');
  await reload.click();
  expect((await reloaded).url()).toBe(address);
});

test('the page rises as the loader hands over', async ({ page }) => {
  await openWithoutScript(page);
  expect(await riseAtDone(page)).toBe('boot-rise');
});

test('the loader appears only once the shared 300 ms delay has passed', async ({ page }) => {
  await openWithoutScript(page);
  const delay = await page.evaluate(
    () =>
      document
        .getElementById('boot-loader')
        ?.getAnimations({ subtree: true })
        .find((animation) => (animation as CSSAnimation).animationName === 'boot-reveal')
        ?.effect?.getTiming().delay,
  );
  expect(delay).toBe(300);
});

test('the loader has no accessibility violations', async ({ page }) => {
  await openWithoutScript(page);
  await expectNoAccessibilityViolations(page);
});

test('the loader fits the screen', async ({ page }) => {
  await openWithoutScript(page);
  await expectNoHorizontalScroll(page);
});

test('the story plays, with the settled frame waiting under it', async ({ page }) => {
  await openWithoutScript(page);
  const [story, settled] = [loader(page).locator('img').nth(0), loader(page).locator('img').nth(1)];
  await expect(story).toBeVisible();
  await expect(settled).toBeHidden();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the loader shows the settled frame and holds still', async ({ page }) => {
    await openWithoutScript(page);
    const [story, settled] = [
      loader(page).locator('img').nth(0),
      loader(page).locator('img').nth(1),
    ];
    await expect(story).toBeHidden();
    await expect(settled).toBeVisible();
    const fill = loader(page).locator('span[aria-hidden] > span');
    expect(await fill.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  });

  test('the page does not rise as the loader hands over', async ({ page }) => {
    await openWithoutScript(page);
    // The loader's hand-over state, set by hand: the CSS that would rise the page.
    expect(await riseAtDone(page)).toBe('none');
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the loader says the app needs it', async ({ page }) => {
    await page.goto('/');
    // Playwright's text search skips <noscript>, so find the line by its place.
    const line = loader(page).locator('noscript p');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('JobDeputy needs JavaScript. Turn it on, then reload.');
    await expect(loader(page).getByText('Loading…')).toBeHidden();
  });

  test('nor offers a reload that cannot help', async ({ page }) => {
    await page.goto('/');
    // Taken out of the layout, so the 8 s reveal has nothing to show (no clock to wait on: the
    // page runs no scripts).
    await expect(loader(page).locator('p[role="status"]')).toHaveCSS('display', 'none');
  });
});

test.describe('in forced colours', () => {
  test.use({ forcedColors: 'active' });

  test("the track's fill keeps a system colour instead of vanishing", async ({ page }) => {
    await openWithoutScript(page);
    const fill = loader(page).locator('span[aria-hidden] > span');
    const colour = await fill.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(colour).not.toBe('rgba(0, 0, 0, 0)');
    expect(colour).not.toBe('rgb(47, 158, 119)');
  });
});
