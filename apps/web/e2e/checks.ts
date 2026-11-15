import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The page must fit the screen width: nothing may push it into a sideways scroll. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page is wider than the screen').toBeLessThanOrEqual(0);
}

/** No WCAG 2.2 A or AA violations that axe can detect. */
export async function expectNoAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/**
 * Opens the home page once the boot loader has handed over: until then the app is inert under it
 * (focus and keys do nothing) and rises in as it fades, so it is not yet where it settles.
 */
export async function openHome(page: Page) {
  await page.goto('/');
  await page.locator('#boot-loader').waitFor({ state: 'detached' });
}
