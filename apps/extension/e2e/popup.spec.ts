import { expect, test } from '@playwright/test';
import { withExtension } from './extension.ts';

// #54: the toolbar popup as Chrome shows it, and its screenshot (the PR's proof, an artifact).
test('the popup says what the extension is for', async () => {
  const { context, id, close } = await withExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 200 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeVisible();
    await expect(page.getByText(/You review and click Submit/)).toBeVisible();
    await page.screenshot({ path: 'screenshots/popup.png' });
  } finally {
    await close();
  }
});
