import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from './checks.ts';

// Long waits in the component gallery (#17), on the page's clock: installed before the page
// loads, then fast-forwarded past the 8 s long wait instead of waiting for it. A file of its own,
// because gallery.spec.ts opens the page in its beforeEach, before a clock could be installed.

test('a first load that runs long says it is still working', async ({ page }) => {
  await page.clock.install();
  await page.goto('/gallery.html');
  const live = page.getByTestId('live-region');
  await live.getByRole('button', { name: 'Load' }).click();
  await page.clock.fastForward(8000);
  await expect(live.getByRole('status')).toHaveText('Loading your matches. Still working…');
  await expect(live.getByText('Still working…', { exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page);
});
