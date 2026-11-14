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

  test('keeps the header usable with text at 200%', async ({ page }) => {
    // Doubles the root font, so every rem-sized part grows (WCAG 1.4.4). Unlike a browser's
    // text-size setting it leaves the breakpoints where they are, so each device keeps its layout.
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const header = page.locator('header');
    const box = await header.boundingBox();
    if (!box) throw new Error('The header has no box.');
    for (const part of await header.locator('a, button').filter({ visible: true }).all()) {
      const partBox = await part.boundingBox();
      if (!partBox) throw new Error('A header control has no box.');
      expect(partBox.x).toBeGreaterThanOrEqual(box.x);
      expect(partBox.x + partBox.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(partBox.y + partBox.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    }
    // Focused content stops below the header as it really is (plus 8px for the focus ring).
    const scrollPadding = () =>
      page.evaluate(() => {
        const { scrollPaddingTop } = getComputedStyle(document.documentElement);
        const headerHeight = document.querySelector('header')?.offsetHeight ?? 0;
        return Number.parseFloat(scrollPaddingTop) - headerHeight - 8;
      });
    await expect.poll(scrollPadding).toBeCloseTo(0, 0);
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
