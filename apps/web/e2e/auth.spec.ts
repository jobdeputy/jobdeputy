import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll, openHome } from './checks.ts';

/**
 * The sign-in and sign-up forms (#14 slice 2) in real browsers. The test build swaps Cognito for
 * in-memory accounts (src/lib/auth/fake.ts): code 123456 confirms, exists@example.com is taken
 * (password "correct horse battery").
 */

/** Opens the drawer from the first visible button with this name. */
async function openDrawer(page: Page, name: string) {
  await openHome(page);
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('creates an account, confirms it with the code, lands signed in, and signs out', async ({
  page,
}) => {
  await openDrawer(page, 'Get started free');
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('new@example.com');
  await drawer.getByLabel('Password', { exact: true }).fill('a long enough password');
  await drawer.getByRole('button', { name: 'Create account' }).click();
  await expect(drawer.getByRole('heading', { name: 'Enter your code.' })).toBeVisible();
  // The new step starts at its field.
  await expect(drawer.getByLabel('Code from your email')).toBeFocused();
  await drawer.getByLabel('Code from your email').fill('123456');
  await drawer.getByRole('button', { name: 'Confirm' }).click();

  // A new account (no profile yet) starts the guided set-up (#33), at its welcome.
  const title = page.getByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(page.getByText('new@example.com')).toBeVisible();
  await expect(page.getByText('United States (US)')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Let’s start' }).click();
  // Step 1, You: saved, then on.
  await expect(
    page.getByRole('heading', { level: 1, name: 'First, what should I call you?' }),
  ).toBeFocused();
  await expect(page.getByRole('banner')).toContainText('Step 1 of 3');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('First name')).toBeFocused();
  await expect(page.getByText('Enter your first name.')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByLabel('First name').fill('Alex');
  await page.getByLabel('Last name').fill('Morgan');
  await page.getByLabel('City (optional)').fill('Austin');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'You’re in.' })).toBeFocused();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'You set it up. Your deputy applies.' }),
  ).toBeVisible();
});

test('marks wrong fields, says why, and passes axe while it does', async ({ page }) => {
  await openDrawer(page, 'Get started free');
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('not-an-email');
  await drawer.getByRole('button', { name: 'Create account' }).click();
  await expect(drawer.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await expect(drawer.getByText('Enter an email like name@example.com.')).toBeVisible();
  await expect(drawer.getByLabel('Email')).toBeFocused();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
});

test('refuses wrong details, then signs in', async ({ page }) => {
  await openDrawer(page, 'Sign in');
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('exists@example.com');
  await drawer.getByLabel('Password', { exact: true }).fill('not the password');
  await drawer.getByRole('button', { name: 'Sign in' }).click();
  await expect(drawer.getByRole('alert')).toHaveText(
    'That email and password don’t match an account.',
  );
  await drawer.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await drawer.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' })).toBeVisible();
});

test('shows the button working while the account is being created', async ({ page }) => {
  await openDrawer(page, 'Get started free');
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Email').fill('slow@example.com');
  await drawer.getByLabel('Password', { exact: true }).fill('a long enough password');
  await drawer.getByRole('button', { name: 'Create account' }).click();
  // "slow" makes the fake take 1.5 s, well past the 300 ms delay: the pending state shows.
  await expect(drawer.getByRole('button', { name: 'Creating your account…' })).toBeVisible();
});

// The real sign-in tells a site without its config ("not set up") from someone else's page by
// the boot loader in the app's own page (src/lib/auth/amplify.ts): the built site must keep it.
test('the built site answers a missing config with its own page', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'one server, one check');
  const response = await request.get('/config.json');
  expect(await response.text()).toContain('id="boot-loader"');
});
