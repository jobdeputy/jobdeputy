import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

// The component gallery (#17): every loading state, checked on every device.

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  // The pending buttons appear after the shared 300 ms delay.
  await expect(page.locator('[data-pending]')).toHaveCount(2);
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
  await page.keyboard.press('Enter');
  // force: Playwright waits for an aria-disabled button to enable; this click must land now.
  await button.click({ force: true });
  await expect(button).toHaveAccessibleName('Saved');
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

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('spinners and the unknown-length bar hold still', async ({ page }) => {
    await expect(page.locator('[data-slot="spinner"]').first()).toHaveCSS('animation-name', 'none');
    const sweep = page.getByRole('progressbar', { name: 'Preparing your desk' }).locator('div');
    await expect(sweep).toHaveCSS('animation-name', 'none');
  });
});
