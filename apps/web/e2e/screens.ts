import type { Page } from '@playwright/test';

/**
 * The app's screens as the screenshot specs reach them: the PR proof (screenshots.spec.ts) and the
 * visual baselines (visual.spec.ts) both go through here, so they show the same frames.
 */
export interface Screen {
  name: string;
  path: string;
  /** Pause the story on its first step (chosen in the strip). */
  firstStep?: boolean;
  /** Open the drawer from the first visible button with this name. */
  open?: string;
  /** Reduced motion, so the story behind holds still. */
  still?: boolean;
  /** Further steps after opening. */
  steps?: (page: Page) => Promise<void>;
  /** Selectors to wait for before the shot. */
  ready?: string | string[];
  /** Block the app's script, so the boot loader stays up. */
  blockScript?: boolean;
  /** Wait for the boot loader's logo story to end. */
  storyEnd?: boolean;
  /**
   * Run the page on its own clock, held, and move it on in short steps only until every `ready`
   * selector is on the page, and never past this many ms: the frame comes from the page's state,
   * not from how fast the device is, and a later timer (the gallery's 8 s long wait) never fires.
   */
  clockUpTo?: number;
}

/** A fixed start for pages on their own clock, and the step it is moved on by. */
const CLOCK_START = Date.UTC(2026, 0, 5, 9, 0, 0);
const CLOCK_STEP = 100;

export const SCREENS: Screen[] = [
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
  // The guided set-up's welcome (#33), where a new account lands, and the page after it.
  { name: 'set-up', path: '/', open: 'Get started free', still: true, steps: toSetUp },
  { name: 'set-up-you', path: '/', open: 'Get started free', still: true, steps: toStepYou },
  // Step 2 with a typed title and a picked one chosen.
  { name: 'set-up-roles', path: '/', open: 'Get started free', still: true, steps: toStepRoles },
  // Step 3: the drop zone; a file being checked (the deputy at work); a ready résumé.
  { name: 'set-up-resume', path: '/', open: 'Get started free', still: true, steps: toStepResume },
  {
    name: 'set-up-resume-checking',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: (page) => uploadResume(page, 'still-checking.pdf', 'Checking it for malware'),
  },
  {
    name: 'set-up-resume-ready',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: (page) => uploadResume(page, 'Alex_Morgan_Resume.pdf', 'Ready'),
  },
  { name: 'profile', path: '/', open: 'Get started free', still: true, steps: toSignedIn },
  // A group's form open on the Profile page: Contact and location, a wrong calling code marked.
  {
    name: 'profile-edit',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toProfileEdit,
  },
  // Every shared component state (#17); the pending buttons and the loading skeleton appear
  // after the 300 ms delay.
  {
    name: 'gallery',
    path: '/gallery.html',
    // The skeleton (after the 300 ms delay), the first deputy's step line, and the deputy's last
    // beat (the long-wait demo's line).
    ready: [
      '[data-slot="query-region"][data-state="loading"]',
      'text=Reading page 3 of 12',
      '[data-slot="deputy-working"][data-long]',
    ],
    clockUpTo: 3000,
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

/** Opens a screen and brings it to the frame its shot shows. */
export async function showScreen(page: Page, screen: Screen) {
  if (screen.still) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }
  if (screen.blockScript) {
    await page.route('**/assets/*.js', (route) => route.abort());
  }
  if (screen.clockUpTo !== undefined) {
    // Paused at a fixed time (it takes hold once the page first reads the time).
    await page.clock.pauseAt(CLOCK_START);
  }
  await page.goto(screen.path);
  if (screen.clockUpTo !== undefined) {
    const ready = [screen.ready ?? []].flat();
    if (ready.length === 0) throw new Error(`${screen.name}: clockUpTo needs ready selectors.`);
    // Visible, as the wait below checks: a hidden match must not stop the clock.
    const reached = async () =>
      (
        await Promise.all(ready.map((selector) => page.locator(selector).first().isVisible()))
      ).every(Boolean);
    // Short steps until the frame's state is all there: a slow render only takes more steps.
    for (let ran = 0; ran < screen.clockUpTo && !(await reached()); ran += CLOCK_STEP) {
      await page.clock.runFor(CLOCK_STEP);
    }
  }
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
}

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

async function toSetUp(page: Page) {
  await toCode(page);
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Code from your email').fill('123456');
  await drawer.getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('heading', { level: 1, name: 'Hi, I’m your deputy.' }).waitFor();
}

async function toStepYou(page: Page) {
  await toSetUp(page);
  await page.getByRole('button', { name: 'Let’s start' }).click();
  await page.getByRole('heading', { level: 1, name: 'First, what should I call you?' }).waitFor();
}

async function toStepRoles(page: Page) {
  await toStepYou(page);
  await page.getByLabel('First name').fill('Alex');
  await page.getByLabel('Last name').fill('Morgan');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { level: 1, name: 'What roles should I look for?' }).waitFor();
  await page.getByLabel('Job title').fill('Staff engineer');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Backend engineer', { exact: true }).click();
  await page
    .locator('input[name="role"][value="Backend engineer"]:checked')
    .waitFor({ state: 'attached' });
}

async function toStepResume(page: Page) {
  await toStepRoles(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { level: 1, name: 'Add your résumé.' }).waitFor();
  await page.getByRole('button', { name: 'Choose a file' }).waitFor();
}

/** Step 3 with this PDF chosen, once its line shows `stage`. */
async function uploadResume(page: Page, name: string, stage: string) {
  await toStepResume(page);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(184_320, 'a') });
  await page
    .getByRole('list', { name: 'Your résumé' })
    .getByText(stage)
    .first()
    .waitFor({ timeout: 15_000 });
}

async function toProfileEdit(page: Page) {
  await toSignedIn(page);
  await page.getByRole('button', { name: 'Edit Contact and location' }).click();
  await page.getByLabel('Country code').fill('44');
  await page.getByLabel('Phone number').fill('20 7946 0000');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Use a code like +1, +44, or +91.').waitFor();
}

async function toSignedIn(page: Page) {
  await toStepResume(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page
    .getByRole('heading', { level: 1, name: 'What your deputy knows about you.' })
    .waitFor();
}
