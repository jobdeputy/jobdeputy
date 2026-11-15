import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import { SCREENSHOTS_DIR } from './screenshots-dir.ts';

/**
 * Proof for UI pull requests: a full-page screenshot of every screen on every device. CI posts
 * them on the PR (.github/workflows/web.yml). Add each new screen here.
 */
const SCREENS = [
  // The landing page, its story paused on the first step (chosen in the strip), so every device
  // and run shows the same frame.
  { name: 'home', path: '/', firstStep: true },
  // The drawer, opened from the first visible "Sign in" button; the story behind it held still
  // (reduced motion), so every run shows the same.
  { name: 'sign-in', path: '/', open: 'Sign in', still: true },
  // Sign-up with its fields marked wrong, then its 6-digit code step, and the signed-in page (the
  // test build's in-memory accounts: src/lib/auth/fake.ts).
  { name: 'sign-up-errors', path: '/', open: 'Get started free', still: true, steps: wrongSignUp },
  { name: 'sign-up-code', path: '/', open: 'Get started free', still: true, steps: toCode },
  { name: 'signed-in', path: '/', open: 'Get started free', still: true, steps: toSignedIn },
  // Every shared component state (#17); the pending buttons and the loading skeleton appear
  // after the 300 ms delay.
  {
    name: 'gallery',
    path: '/gallery.html',
    ready: '[data-slot="query-region"][data-state="loading"]',
  },
  // The boot loader at the end of its story, held up by an app script that never arrives.
  { name: 'boot-loader', path: '/', ready: '#boot-loader', blockScript: true, storyEnd: true },
  // The same boot, stalled past the 8 s long wait: the reload offer.
  {
    name: 'boot-loader-slow',
    path: '/',
    ready: '#boot-loader [role="status"] a',
    blockScript: true,
  },
];

for (const screen of SCREENS) {
  test(`screenshot: ${screen.name}`, async ({ page }, testInfo) => {
    if (screen.still) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    if (screen.blockScript) {
      await page.route('**/assets/*.js', (route) => route.abort());
    }
    await page.goto(screen.path);
    if (screen.firstStep) {
      await page
        .getByRole('list', { name: 'How your deputy works' })
        .getByRole('button')
        .first()
        .click();
      // Off the step again, so it is not caught hovered.
      await page.mouse.move(0, 0);
    }
    if (screen.open) {
      await page
        .getByRole('button', { name: screen.open, exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    }
    if (screen.steps) {
      await screen.steps(page);
    }
    for (const ready of [screen.ready ?? []].flat()) {
      await page.locator(ready).first().waitFor();
    }
    if (screen.storyEnd) {
      // The logo's 2.605 s story runs from when its image arrives, so wait for that, not a clock.
      await page.waitForFunction(() => {
        const logo = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find(
          (entry) => entry.name.endsWith('/jobdeputy-animated.svg'),
        );
        return logo !== undefined && performance.now() > logo.responseEnd + 2705;
      });
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `${screen.name}--${testInfo.project.name}.png`),
      fullPage: true,
      // 'disabled' fast-forwards finite animations, which would show the loader's 8 s reload
      // offer early; the loader's screens are captured as they stand.
      animations: screen.blockScript ? 'allow' : 'disabled',
    });
  });
}

// The boot loader with scripts turned off: the noscript line, without a loading look.
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('screenshot: boot-loader-no-js', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator('#boot-loader noscript p').waitFor();
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `boot-loader-no-js--${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
});

async function wrongSignUp(page: Page) {
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('not-an-email');
  await drawer.getByLabel('Password', { exact: true }).fill('short');
  await drawer.getByRole('button', { name: 'Create account' }).click();
  await drawer.getByText('Enter an email like name@example.com.').waitFor();
}

async function toCode(page: Page) {
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('new@example.com');
  await drawer.getByLabel('Password', { exact: true }).fill('a long enough password');
  await drawer.getByRole('button', { name: 'Create account' }).click();
  await drawer.getByRole('heading', { name: 'Enter your code.' }).waitFor();
}

async function toSignedIn(page: Page) {
  await toCode(page);
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Code from your email').fill('123456');
  await drawer.getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('heading', { level: 1, name: 'You’re in.' }).waitFor();
}
