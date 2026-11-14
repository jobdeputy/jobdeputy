import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the product name and tagline', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeVisible();
    await expect(page.getByText('Your search partner.')).toBeVisible();
  });

  test('uses the brand tokens from the Tailwind theme', async ({ page }) => {
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 243)');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(27, 26, 24)');
  });

  test('fits the screen without sideways scrolling', async ({ page }) => {
    await expectNoHorizontalScroll(page);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await expectNoAccessibilityViolations(page);
  });
});
