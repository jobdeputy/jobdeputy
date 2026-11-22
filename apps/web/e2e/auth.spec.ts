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
  // The whole journey (sign-up, the set-up's three steps with the résumé check's 3 s, then the
  // Profile page's forms, axe at each): over the 30 s limit on CI's WebKit (main run 44968165243).
  test.slow();
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
  // Step 2, target roles: at least one, then saved and the set-up ends.
  await expect(
    page.getByRole('heading', { level: 1, name: 'What roles should I look for?' }),
  ).toBeFocused();
  await expect(page.getByRole('banner')).toContainText('Step 2 of 3');
  const jobTitle = page.getByLabel('Job title');
  await jobTitle.waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(jobTitle).toBeFocused();
  await expect(page.getByText('Add at least one role, or pick a suggestion.')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await jobTitle.fill('Staff engineer');
  await jobTitle.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Staff engineer' })).toBeChecked();
  await expect(jobTitle).toBeFocused();
  await page.getByText('Backend engineer', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Backend engineer' })).toBeChecked();
  await expect(page.getByText('2 of 10 added', { exact: false })).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  // Step 3, the résumé: a wrong file is refused before anything is sent; a PDF goes up, is
  // checked, and is ready; then the set-up ends.
  await expect(page.getByRole('heading', { level: 1, name: 'Add your résumé.' })).toBeFocused();
  await expect(page.getByRole('banner')).toContainText('Step 3 of 3');
  const picker = page.locator('input[type="file"]');
  await page.getByRole('button', { name: 'Choose a file' }).waitFor();
  await picker.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'),
  });
  await expect(
    page.getByText('notes.txt isn’t a PDF or DOCX file.', { exact: false }),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
  // Dropped on the zone, as a person would drag it in.
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['%PDF-1.7 a résumé'], 'Alex_Morgan_Resume.pdf', { type: 'application/pdf' }),
    );
    return transfer;
  });
  const zone = page.getByText('Drop your résumé here');
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await zone.dispatchEvent(type, { dataTransfer: dropped });
  }
  const resume = page.getByRole('list', { name: 'Your résumé' });
  await expect(resume).toContainText('Checking it for malware');
  await expect(page.getByText('Checking your file')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  // The fake's check takes 3 s, asked about every 2 s.
  await expect(resume.getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('I’ll tailor from this one.')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  // Job matches (#49), where the app opens: at its own address, named in the tab, passing axe.
  await expect(
    page.getByRole('heading', { level: 1, name: 'The best jobs at each company.' }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(page).toHaveTitle('Job matches · JobDeputy');
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  // A link in: the deputy at work (axe while it works), then how it went.
  await page.getByLabel('Careers page link').fill('boards.greenhouse.io/acme');
  await page.getByRole('button', { name: 'Find jobs' }).click();
  await expect(page.getByText('Finding jobs')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expect(page.getByText('Done with boards.greenhouse.io: 12 jobs read.')).toBeVisible({
    timeout: 15_000,
  });
  // The company it found, its best jobs ranked, each with its fit (#49 PR C).
  const acme = page.getByRole('article', { name: 'Acme' });
  await expect(acme.getByRole('listitem')).toHaveCount(3);
  await expect(acme.getByText('Strong fit')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  // A job opens in its preview (#49 PR D): its title takes the focus, the posting is read, axe.
  await acme.getByRole('button', { name: 'Senior Backend Engineer' }).click();
  const job = page.getByRole('region', { name: 'Senior Backend Engineer' });
  await expect(job.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(job.getByText(/Design and run TypeScript services on AWS/)).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await job.getByRole('button', { name: /Close|Back to your companies/ }).click();
  await expect(acme.getByRole('button', { name: 'Senior Backend Engineer' })).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Profile' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'What your deputy knows about you.' }),
  ).toBeFocused();
  // The Profile page (#33): at its own address, named in the tab, and passing axe.
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page).toHaveTitle('Profile · JobDeputy');
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  // A group's form, open in place: axe, no sideways scroll, saved, and back to its facts.
  await page.getByRole('button', { name: 'Edit Contact and location' }).click();
  await expect(page.getByLabel('Phone number')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Phone number').fill('512 555 0100');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit Contact and location' })).toBeFocused();
  await expect(page.getByText('+1 512 555 0100')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Links' }).click();
  await expect(page.getByLabel('Other links')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  // Target roles: the set-up's editor, in place.
  await page.getByRole('button', { name: 'Edit Target roles' }).click();
  await expect(page.getByLabel('Job title')).toBeFocused();
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole('checkbox', { name: 'Backend engineer' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit Target roles' })).toBeFocused();
  await expect(page.getByRole('list', { name: 'Target roles' })).toContainText('Backend engineer');
  // The Résumés page (#33): the set-up's résumé, the default; Delete asks first.
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Résumés' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'The résumés your deputy tailors from.' }),
  ).toBeFocused();
  await expect(page).toHaveURL(/\/resumes$/);
  await expect(page).toHaveTitle('Résumés · JobDeputy');
  const library = page.getByRole('list', { name: 'Your résumés' });
  await expect(library).toContainText('Default');
  await expectNoAccessibilityViolations(page);
  await expectNoHorizontalScroll(page);
  // Download (#33 6b3): the browser saves the file under its own name.
  const saving = page.waitForEvent('download');
  await library.getByRole('button', { name: 'Download Alex_Morgan_Resume' }).click();
  expect((await saving).suggestedFilename()).toBe('Alex_Morgan_Resume.pdf');
  // Rename: a sheet with the name selected (typing replaces it); focus goes back to Rename.
  const renameButton = library.getByRole('button', { name: 'Rename Alex_Morgan_Resume' });
  await renameButton.click();
  const renameSheet = page.getByRole('dialog', { name: 'Rename résumé' });
  await expect(renameSheet.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await expectNoAccessibilityViolations(page);
  await page.keyboard.type('Alex Morgan, design');
  await renameSheet.getByRole('button', { name: 'Save name' }).click();
  await expect(renameSheet).toBeHidden();
  const renamed = library.getByRole('button', { name: 'Rename Alex Morgan, design' });
  await expect(renamed).toBeFocused();
  await library.getByRole('button', { name: 'Delete Alex Morgan, design' }).click();
  const question = page.getByRole('alertdialog', { name: 'Delete Alex Morgan, design?' });
  await expect(question.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await expectNoAccessibilityViolations(page);
  await question.getByRole('button', { name: 'Delete résumé' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Library' })).toBeFocused();
  await expect(page.getByText('No résumés yet')).toBeVisible();

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
