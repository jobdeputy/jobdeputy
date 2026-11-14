import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

// The component gallery (#17): every loading state, checked on every device.

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  // The pending buttons and the loading skeleton appear after the shared 300 ms delay.
  await expect(page.locator('[data-pending]')).toHaveCount(2);
  await expect(page.locator('[data-slot="query-region"][data-state="loading"]')).toHaveCount(1);
});

test('has no accessibility violations', async ({ page }) => {
  await expectNoAccessibilityViolations(page);
});

test('fits the screen', async ({ page }) => {
  await expectNoHorizontalScroll(page);
});

test('fits the screen with text at 200%', async ({ page }) => {
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expectNoHorizontalScroll(page);
});

test('spinners turn', async ({ page }) => {
  await expect(page.locator('[data-slot="spinner"]').first()).toHaveCSS(
    'animation-name',
    'spinner',
  );
});

test('a pending button keeps focus and starts its work only once', async ({ page }) => {
  // By test id: the button's name changes as it goes (Try a save, Saving…, Saved).
  const button = page.getByTestId('live-button');
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('data-pending');
  await expect(button).toBeFocused();
  await expect(button).toHaveAccessibleName('Saving…');
  // The work runs until "Finish the save", so these presses land while it is pending.
  await page.keyboard.press('Enter');
  // force: Playwright waits for an aria-disabled button to enable; this click must land now.
  await button.click({ force: true });
  await expect(page.getByTestId('live-button-runs')).toHaveText('Started 1 time');
  // A double-click finishes once: the second press lands on a button that is no longer available.
  await page.getByRole('button', { name: 'Finish the save' }).dblclick();
  await expect(button).toHaveAccessibleName('Saved');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(button).toHaveAccessibleName('Try a save');
  await expect(page.getByTestId('live-button-runs')).toHaveText('Started 1 time');
});

test('a progress bar reads out its quarters', async ({ page }) => {
  await page.getByRole('button', { name: 'Run an upload' }).click();
  const bar = page.getByRole('progressbar', { name: 'Uploading cover letter' });
  await expect(bar).toHaveAttribute('aria-valuenow', '100', { timeout: 10_000 });
  await expect(
    page.getByRole('status').filter({ hasText: 'Uploading cover letter, 100%' }),
  ).toBeAttached();
});

test('skeletons shimmer, each in its shape', async ({ page }) => {
  const skeletons = page.locator('[data-slot="skeleton"]');
  for (const kind of ['block', 'lines', 'rows', 'cards', 'chart']) {
    const skeleton = skeletons.and(page.locator(`[data-kind="${kind}"]`)).first();
    await expect(skeleton).toBeVisible();
    expect(await skeleton.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe(
      'skeleton-sweep',
    );
  }
  // The highlight crosses the rows only, not the gaps between them.
  expect(
    await skeletons
      .and(page.locator('[data-kind="rows"]'))
      .first()
      .evaluate((el) => getComputedStyle(el, '::after').maskImage),
  ).toContain('repeating-linear-gradient');
  // The shape keeps its rows' size: three 55px rows, 8px apart.
  const rows = skeletons.and(page.locator('[data-kind="rows"]')).first();
  expect(await rows.evaluate((el) => el.getBoundingClientRect().height)).toBe(181);
});

test('a query region goes from skeleton to data, and keeps its data while it refreshes', async ({
  page,
}) => {
  const live = page.getByTestId('live-region');
  const region = live.locator('[data-slot="query-region"]');
  const content = region.locator('[data-slot="query-region-content"]');
  await live.getByRole('button', { name: 'Load' }).click();
  await expect(content).toHaveAttribute('aria-busy', 'true');
  await expect(region).toHaveAttribute('data-state', 'loading');
  await expect(region.getByRole('status')).toHaveText('Loading your matches');
  await expect(region.locator('[data-slot="skeleton"]')).toBeVisible();

  await live.getByRole('button', { name: 'Data arrives' }).click();
  await expect(region.getByText('Staff engineer, Lumen')).toBeVisible();
  await expect(content).not.toHaveAttribute('aria-busy');

  await live.getByRole('button', { name: 'Refetch' }).click();
  await expect(region).toHaveAttribute('data-state', 'refreshing');
  await expect(content).not.toHaveAttribute('aria-busy');
  await expect(region.getByText('Updating…')).toBeVisible();
  await expect(region.getByText('Staff engineer, Lumen')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('the deputy works with his hourglass, and says a long job carries on', async ({ page }) => {
  const working = page.locator('[data-slot="deputy-working"][data-shown]');
  await expect(working).toHaveCount(2);
  await expect(working.first().getByRole('status').filter({ hasText: 'Reading page' })).toHaveText(
    'Reading page 3 of 12',
  );
  await expect(working.first().locator('svg path[d^="M2 -84"]')).toBeVisible();
  await expect(
    working.nth(1).getByText('This keeps going in the background. You can leave this page.', {
      exact: true,
    }),
  ).toBeVisible();
});

test('a failed first load hands over to its error', async ({ page }) => {
  const live = page.getByTestId('live-region');
  await live.getByRole('button', { name: 'Load' }).click();
  await live.getByRole('button', { name: 'Fail' }).click();
  await expect(live.getByText('Could not load your matches.')).toBeVisible();
  await expect(live.locator('[data-slot="query-region-content"]')).not.toHaveAttribute('aria-busy');
});

test.describe('in forced colours', () => {
  test.use({ forcedColors: 'active' });

  test('skeletons keep a dashed outline', async ({ page }) => {
    const skeleton = page.locator('[data-slot="skeleton"]').first();
    await expect(skeleton).toHaveCSS('border-top-style', 'dashed');
    expect(await skeleton.evaluate((el) => getComputedStyle(el, '::after').display)).toBe('none');
  });

  test('spinners keep a visible gap', async ({ page }) => {
    const spinner = page.locator('[data-slot="spinner"]').first();
    const [top, right] = await spinner.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.borderTopColor, style.borderRightColor];
    });
    expect(top).not.toBe(right);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('spinners and the unknown-length bar hold still', async ({ page }) => {
    await expect(page.locator('[data-slot="spinner"]').first()).toHaveCSS('animation-name', 'none');
    const sweep = page.getByRole('progressbar', { name: 'Preparing your desk' }).locator('div');
    await expect(sweep).toHaveCSS('animation-name', 'none');
    // Still stripes across the whole track: working, neither empty nor full.
    await expect(sweep).toHaveCSS('background-image', /repeating-linear-gradient/);
    await expect(sweep).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await sweep.evaluate((el) => el.clientWidth)).toBe(
      await sweep.evaluate((el) => el.parentElement?.clientWidth),
    );
  });

  test('skeletons hold still', async ({ page }) => {
    const skeleton = page.locator('[data-slot="skeleton"]').first();
    expect(await skeleton.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe(
      'none',
    );
  });
});
