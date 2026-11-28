import { expect, test } from '@playwright/test';
import { buildEnv } from '../build-env.ts';
import { readSettings } from '../src/settings.ts';
import { withExtension } from './extension.ts';

// #54: the toolbar popup as Chrome shows it, and its screenshots (the PR's proof, artifacts). The
// build's sign-in settings are read as the build read them (CI's variables, or .env files).
const settings = readSettings(buildEnv());
// CI always builds with settings: missing ones would quietly skip every sign-in test.
if (process.env.CI && !settings) throw new Error('CI builds the extension with WXT_* settings');

test('signed out, the popup says what the extension is for and offers sign-in', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, id, close } = await withExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 280 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole('heading', { level: 1, name: 'JobDeputy' })).toBeVisible();
    // A dev build (every build but the store's) says so beside the title.
    await expect(page.getByTitle('Development build')).toBeVisible();
    await expect(page.getByText(/You review and click Submit/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/popup.png' });
  } finally {
    await close();
  }
});

test('signed in, it says who and what the deputy can fill in, read from the API', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { apiUrl } = settings ?? { apiUrl: '' };
  const { context, id, close } = await withExtension();
  try {
    // The API, answered here: the service worker's calls go through the context's routes.
    const bodies: Record<string, unknown> = {
      '/me/profile': {
        version: 2,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
      },
      '/me/documents': {
        documents: [{ documentId: 'd1', fileName: 'cv.pdf', status: 'ready', isDefault: true }],
      },
      '/me/applicant': { version: 0, workAuthorization: [], workSetups: [] },
    };
    const seen: string[] = [];
    await context.route(`${apiUrl}/**`, (route) => {
      const { pathname } = new URL(route.request().url());
      seen.push(`${route.request().headers().authorization} ${pathname}`);
      return route.fulfill({
        json: bodies[pathname] ?? {},
        status: pathname in bodies ? 200 : 404,
      });
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      // Runs in the service worker, where `chrome` is the extension API.
      const { chrome } = globalThis as unknown as {
        chrome: { storage: { session: { set(items: object): Promise<void> } } };
      };
      await chrome.storage.session.set({
        session: {
          accessToken: 'e2e-access',
          refreshToken: 'e2e-refresh',
          expiresAt: Date.now() + 3_600_000,
          email: 'ada@example.com',
        },
      });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 380 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByText('Signed in as ada@example.com')).toBeVisible();
    const items = page.getByRole('listitem');
    await expect(items).toHaveText([
      /Your details: Ready, 3 of 6 saved/,
      /A résumé to attach: Ready/,
      /Application answers: Not ready yet, 0 of 10 saved/,
    ]);
    expect(seen.sort()).toEqual([
      'Bearer e2e-access /me/applicant',
      'Bearer e2e-access /me/documents',
      'Bearer e2e-access /me/profile',
    ]);
    await page.screenshot({ path: 'screenshots/popup-signed-in.png' });
  } finally {
    await close();
  }
});

test('after sign-out, it offers to continue as that person or to use a different account', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, id, close } = await withExtension();
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await worker.evaluate(async () => {
      const { chrome } = globalThis as unknown as {
        chrome: { storage: { session: { set(items: object): Promise<void> } } };
      };
      await chrome.storage.session.set({ lastEmail: 'ada.lovelace.analytical@example.com' });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 300 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(
      page.getByRole('button', { name: 'Continue as ada.lovelace.analytical@example.com' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/popup-continue.png' });
  } finally {
    await close();
  }
});

test('a build without sign-in settings says so', async () => {
  test.skip(settings !== null, 'this build has sign-in settings');
  const { context, id, close } = await withExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByText(/built without its sign-in settings/)).toBeVisible();
  } finally {
    await close();
  }
});
