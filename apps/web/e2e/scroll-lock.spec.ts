import { expect, type Page, test } from '@playwright/test';
import { openHome } from './checks.ts';

/**
 * The page behind an open drawer stays still (src/lib/scroll-lock.ts): it cannot scroll, and it
 * does not shift where its scrollbar was. The deployed CSP allows styles from the site's own files
 * only (infra/lib/web-stack.ts), which blocks the <style> Radix injects for this; the test build
 * sends no CSP, so the first test adds that directive to the page, and the second runs without
 * it, where Radix's own style does the work.
 */

// Headless Chromium hides its scrollbars; shown, on Linux (CI) they take room, as on Windows,
// which is where a page could shift as its scrollbar goes.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/** Makes the open page tall enough to scroll everywhere, then opens its sign-in drawer. */
async function openDrawerOnTallPage(page: Page) {
  await page.evaluate(() => document.body.style.setProperty('min-height', '300vh'));
  const width = await bodyWidth(page);
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Welcome back.' })).toBeVisible();
  return width;
}

/** The body's width: it grows by the scrollbar's width if the lock does not keep its place. */
function bodyWidth(page: Page) {
  return page.evaluate(() => document.body.getBoundingClientRect().width);
}

/** Whether the scrollbars take room here (Linux desktop Chrome), so a shift would show. */
function scrollbarsTakeRoom(projectName: string) {
  return process.platform === 'linux' && projectName === 'desktop-chrome';
}

test('under the site’s CSP, an open drawer keeps the page behind it still', async ({
  page,
}, testInfo) => {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': "style-src 'self'" },
      });
    },
  );
  // Counted in the page, by the standard event every browser fires when its CSP refuses a style.
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      if (!event.violatedDirective.startsWith('style-src')) return;
      document.documentElement.dataset.styleRefusals = String(
        Number(document.documentElement.dataset.styleRefusals ?? 0) + 1,
      );
    });
  });
  const refusals = () =>
    page.evaluate(() => Number(document.documentElement.dataset.styleRefusals ?? 0));
  await openHome(page);
  const refusedBefore = await refusals();
  const width = await openDrawerOnTallPage(page);
  // The CSP refused Radix's <style> as the drawer opened, and the page is locked anyway…
  await expect.poll(refusals).toBeGreaterThan(refusedBefore);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(page.locator('body')).toHaveAttribute('data-scroll-gap', '');
  // …without shifting where its scrollbar was.
  if (scrollbarsTakeRoom(testInfo.project.name)) {
    const gap = await page.evaluate(() => document.body.style.getPropertyValue('--scroll-gap'));
    expect(Number.parseFloat(gap)).toBeGreaterThan(0);
    await expect(page.locator('body')).toHaveCSS('margin-right', gap);
  }
  expect(await bodyWidth(page)).toBeCloseTo(width, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  // Let go fully, so the next lock measures afresh.
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-gap');
  expect(await page.evaluate(() => document.body.style.getPropertyValue('--scroll-gap'))).toBe('');
});

test('without a CSP, Radix’s own style keeps the page still, and ours stands aside', async ({
  page,
}) => {
  await openHome(page);
  const width = await openDrawerOnTallPage(page);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-gap');
  expect(await bodyWidth(page)).toBeCloseTo(width, 0);
});
