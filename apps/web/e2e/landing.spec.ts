import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

const TITLE = 'You set it up. Your deputy applies.';

/** The visible button with this name: phones hide the header's "Get started free". */
function visibleButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the promise, the two ways in, and the three steps', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: /^JobDeputy/ })).toBeVisible();
    await expect(visibleButton(page, 'Get started free')).toBeVisible();
    await expect(visibleButton(page, 'Sign in')).toBeVisible();
    const steps = page.getByRole('list', { name: 'How your deputy works' }).getByRole('listitem');
    await expect(steps).toHaveText([/Set it up/, /It finds/, /It applies/]);
    await expect(steps.first()).toHaveAttribute('aria-current', 'step');
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

  test('"Get started free" opens the sign-up drawer', async ({ page }) => {
    await visibleButton(page, 'Get started free').click();
    const drawer = page.getByRole('dialog', { name: 'Set up your search desk.' });
    await expect(drawer).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
  });

  test('"Sign in" opens the sign-in drawer; Escape closes it and focus goes back', async ({
    page,
  }) => {
    const signIn = visibleButton(page, 'Sign in');
    await signIn.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Welcome back.' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(signIn).toBeFocused();
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the drawer appears without sliding', async ({ page }) => {
    await page.goto('/');
    await visibleButton(page, 'Sign in').click();
    const drawer = page.getByRole('dialog', { name: 'Welcome back.' });
    await expect(drawer).toHaveCSS('animation-name', 'none');
  });
});
