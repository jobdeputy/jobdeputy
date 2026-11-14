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
 * Opens the page with the app's script never arriving: the loader stays, on a loaded page. Waits
 * for its words, which only show once the reveal has run (the loader's own box is there from the
 * first paint, so it cannot tell).
 */
async function openWithoutScript(page: Page) {
  await page.route(APP_SCRIPT, (route) => route.abort());
  await page.goto('/');
  await expect(loader(page).getByText('Loading…')).toBeVisible();
}

test('a slow boot shows the loader, then hands over to the app', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(APP_SCRIPT, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });

  await expect(page.getByRole('progressbar', { name: 'Loading JobDeputy' })).toBeVisible();
  await expect(loader(page).getByText('Loading…')).toBeVisible();

  release();
  await expect(loader(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'JobDeputy is ready.' })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('root')?.inert)).toBe(false);
  // The hand-over never moves focus.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
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
