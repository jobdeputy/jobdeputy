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
  // #52: Matches, where the app opens (empty, pointing to Search), and Search before any link.
  { name: 'jobs', path: '/', open: 'Get started free', still: true, steps: toJobs },
  { name: 'search', path: '/', open: 'Get started free', still: true, steps: toSearch },
  // Search (#49 Find jobs): the deputy at work, done (its run in the history), a failed link.
  // Matches with the jobs a link found, and a job open in its pane.
  { name: 'jobs-working', path: '/', open: 'Get started free', still: true, steps: toJobsWorking },
  { name: 'jobs-done', path: '/', open: 'Get started free', still: true, steps: toJobsDone },
  { name: 'jobs-failed', path: '/', open: 'Get started free', still: true, steps: toJobsFailed },
  { name: 'matches', path: '/', open: 'Get started free', still: true, steps: toMatches },
  { name: 'jobs-preview', path: '/', open: 'Get started free', still: true, steps: toJobsPreview },
  // #52 PR C: applying from the pane: "Did you apply?", then the job out of Matches with Undo.
  {
    name: 'jobs-apply-ask',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toJobsApplyAsk,
  },
  {
    name: 'matches-applied',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toMatchesApplied,
  },
  // #51 PR C: the company's tailored résumé in the pane: ready (80% or more), and below 80%
  // with the keywords still missing (I have this).
  {
    name: 'matches-tailored',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: (page) => toMatchesTailored(page, 'Senior Backend Engineer', '86%'),
  },
  {
    name: 'matches-tailored-below',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: (page) => toMatchesTailored(page, 'Platform Engineer, Developer Experience', '72%'),
  },
  // #51 PR C2: the tailored résumé's preview, in its dialog.
  {
    name: 'matches-resume-preview',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toResumePreview,
  },
  // #51 PR D3: the job's cover letter in the pane (ready, after tailoring), and its preview.
  {
    name: 'matches-cover-letter',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toCoverLetter,
  },
  {
    name: 'matches-letter-preview',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toLetterPreview,
  },
  // #52 PR E: a company cooling down: the table says until when, and Manual apply is off.
  {
    name: 'matches-cooling',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toMatchesCooling,
  },
  // #52 PR D: Applications, empty (pointing to Matches), and with a job applied to, its stage set.
  {
    name: 'applications-empty',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toApplicationsEmpty,
  },
  { name: 'applications', path: '/', open: 'Get started free', still: true, steps: toApplications },
  {
    name: 'jobs-ai-used-up',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toJobsAiUsedUp,
  },
  // #50: a GitHub list: its companies being read (the bar), and how it went.
  {
    name: 'jobs-list-working',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toJobsListWorking,
  },
  {
    name: 'jobs-list-done',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toJobsListDone,
  },
  { name: 'profile', path: '/', open: 'Get started free', still: true, steps: toSignedIn },
  // A group's form open on the Profile page: Contact and location, a code without its number marked.
  {
    name: 'profile-edit',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toProfileEdit,
  },
  // Target roles' editor open on the Profile page, a typed title added.
  {
    name: 'profile-roles',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: toProfileRoles,
  },
  // The Résumés page (#33) with the set-up's résumé, ready and the default; then its Delete question.
  { name: 'resumes', path: '/', open: 'Get started free', still: true, steps: toResumes },
  {
    name: 'resumes-delete',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: async (page) => {
      await toResumes(page);
      await page.getByRole('button', { name: 'Delete Alex_Morgan_Resume' }).click();
      await page.getByRole('button', { name: 'Keep it' }).waitFor();
    },
  },
  {
    name: 'resumes-rename',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: async (page) => {
      await toResumes(page);
      await page.getByRole('button', { name: 'Rename Alex_Morgan_Resume' }).click();
      await page.getByRole('button', { name: 'Save name' }).waitFor();
    },
  },
  // Adding on the Résumés page: one in, being checked; one not added (not a PDF or DOCX).
  {
    name: 'resumes-adding',
    path: '/',
    open: 'Get started free',
    still: true,
    steps: async (page) => {
      await toResumes(page);
      await page.locator('input[type="file"]').setInputFiles([
        {
          name: 'still-checking.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.alloc(184_320, 'a'),
        },
        { name: 'Cover letter.txt', mimeType: 'text/plain', buffer: Buffer.alloc(2_048, 'a') },
      ]);
      await page
        .getByRole('list', { name: 'Your résumés' })
        .getByText('Checking it for malware')
        .waitFor({ timeout: 15_000 });
      await page
        .getByRole('list', { name: 'Files you are adding' })
        .getByText('Not added')
        .waitFor();
    },
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
  // The boot loader, held up by an app script that never arrives. Under reduced motion, so the
  // logo shows its settled frame (the story's last) and every run captures the same pixels.
  // Shot once its reveal (300 ms in) has finished, so never blank or half faded in.
  {
    name: 'boot-loader',
    path: '/',
    ready: '#boot-loader',
    blockScript: true,
    still: true,
    steps: revealed,
  },
  // The same boot, stalled past the 8 s long wait: the reload offer.
  {
    name: 'boot-loader-slow',
    path: '/',
    ready: '#boot-loader [role="status"] a',
    blockScript: true,
    still: true,
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
  await page.evaluate(() => document.fonts.ready);
}

/** The boot loader's reveal has run to its end (its other, later animations aside). */
async function revealed(page: Page) {
  await page
    .locator('#boot-loader > div')
    .first()
    .evaluate((reveal) =>
      Promise.all(reveal.getAnimations().map((animation) => animation.finished)).then(
        () => undefined,
      ),
    );
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

async function toResumes(page: Page) {
  await uploadResume(page, 'Alex_Morgan_Resume.pdf', 'Ready');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { level: 1, name: 'The best jobs at each company.' }).waitFor();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Résumés' })
    .click();
  await page.getByRole('list', { name: 'Your résumés' }).getByText('Default').waitFor();
}

async function toProfileRoles(page: Page) {
  await toSignedIn(page);
  await page.getByRole('button', { name: 'Edit Target roles' }).click();
  await page.getByLabel('Job title').fill('Data engineer');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

async function toProfileEdit(page: Page) {
  await toSignedIn(page);
  await page.getByRole('button', { name: 'Edit Contact and location' }).click();
  await page.getByLabel('Country code').fill('+44');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Enter the number, or clear the country code.').waitFor();
}

/** Set up and signed in: the app opens on Matches (#52), empty. */
async function toJobs(page: Page) {
  await toStepResume(page);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { level: 1, name: 'The best jobs at each company.' }).waitFor();
  await page.getByRole('link', { name: 'Go to Search' }).waitFor();
}

/** A jobs tab (#52), from the tab row. */
async function openTab(page: Page, name: 'Search' | 'Matches' | 'Applications') {
  await page.getByRole('navigation', { name: 'Jobs' }).getByRole('link', { name }).click();
}

/** The Search tab (#52) before any link: Find jobs, and an empty history. */
async function toSearch(page: Page) {
  await toJobs(page);
  await openTab(page, 'Search');
  await page.getByText('No searches yet').waitFor();
}

/** `link` given in Search. */
async function findJobs(page: Page, link: string) {
  await toSearch(page);
  await page.getByLabel('Careers page link').fill(link);
  await page.getByRole('button', { name: 'Find jobs' }).click();
}

/** Search with a link sent: the deputy at work on a page that never finishes. */
async function toJobsWorking(page: Page) {
  await findJobs(page, 'still-crawling.example.com/careers');
  await page.getByText('Reading still-crawling.example.com…').waitFor();
  await page.getByRole('cell', { name: 'Reading', exact: true }).waitFor();
}

/** Search after a link was read: how it went, and its run in the history. */
async function toJobsDone(page: Page) {
  await findJobs(page, 'boards.greenhouse.io/acme');
  await page
    .getByText('Done with boards.greenhouse.io: 12 jobs read.')
    .waitFor({ timeout: 15_000 });
  await page.getByRole('cell', { name: 'Done', exact: true }).waitFor();
}

/** Matches after a link was read: its jobs in the table, best fit first. */
async function toMatches(page: Page) {
  await toJobsDone(page);
  await openTab(page, 'Matches');
  await page.getByRole('table', { name: 'Your matches' }).getByText('Strong fit').waitFor();
}

/** #50: a GitHub list whose companies are being read (held at its second company). */
async function toJobsListWorking(page: Page) {
  await findJobs(page, 'github.com/acme/still-crawling');
  await page
    .getByRole('progressbar', { name: '1 of 5 companies read' })
    .waitFor({ timeout: 15_000 });
}

/** #50: a GitHub list read: its jobs at its companies, and what it passed over. */
async function toJobsListDone(page: Page) {
  await findJobs(page, 'github.com/SimplifyJobs/New-Grad-Positions');
  await page
    .getByText('Done with SimplifyJobs/New-Grad-Positions: 46 jobs read at 4 companies.')
    .waitFor({ timeout: 30_000 });
  await page.getByRole('cell', { name: 'Done', exact: true }).waitFor();
}

/** A job open in its pane: beside the table on a wide screen, a view of its own on a phone. */
async function toJobsPreview(page: Page) {
  await toMatches(page);
  await page.getByRole('button', { name: 'Senior Backend Engineer' }).click();
  await page.getByText(/Design and run TypeScript services on AWS/).waitFor();
}

/**
 * #51 PR C: Tailor résumé pressed in a job's pane, and the run followed until its score shows
 * (the fake's run takes two of its stages); beside the table, its Score column has it too.
 */
async function toMatchesTailored(page: Page, title: string, score: string) {
  await toMatches(page);
  await page.getByRole('button', { name: title }).click();
  const section = page.getByRole('region', { name: 'Your résumé for Acme' });
  await section.getByRole('button', { name: 'Tailor résumé' }).click();
  await section.getByText(score, { exact: true }).waitFor({ timeout: 15_000 });
  // Beside the table (wide screens), the shot waits for its Score column read again too.
  const table = page.getByRole('table', { name: 'Your matches' });
  if (await table.isVisible()) await table.getByText(score).waitFor();
}

/** #51 PR C2: the ready version's Preview opened: the résumé laid out as its files. */
async function toResumePreview(page: Page) {
  await toMatchesTailored(page, 'Senior Backend Engineer', '86%');
  await page
    .getByRole('region', { name: 'Your résumé for Acme' })
    .getByRole('button', { name: 'Preview' })
    .click();
  await page
    .getByRole('dialog', { name: 'Your résumé for Acme' })
    .getByRole('heading', { name: 'Sam Example' })
    .waitFor();
}

/** #51 PR D3: a cover letter written after tailoring: ready, from the tailored résumé. */
async function toCoverLetter(page: Page) {
  await toMatchesTailored(page, 'Senior Backend Engineer', '86%');
  const section = page.getByRole('region', { name: 'Cover letter for this job' });
  await section.getByRole('button', { name: 'Write cover letter' }).click();
  await section.getByText(/from your résumé tailored for Acme\.$/).waitFor({ timeout: 15_000 });
  await section.getByRole('button', { name: 'Rewrite' }).waitFor();
}

/** #51 PR D3: the ready letter's Preview opened: the letter laid out as its files. */
async function toLetterPreview(page: Page) {
  await toCoverLetter(page);
  await page
    .getByRole('region', { name: 'Cover letter for this job' })
    .getByRole('button', { name: 'Preview' })
    .click();
  await page
    .getByRole('dialog', { name: 'Your cover letter for Acme' })
    .getByText('Dear Hiring Manager,')
    .waitFor();
}

/**
 * #52 PR C: Manual apply pressed, and "Did you apply?" asked in the job's pane. The employer's
 * tab it opens is closed at once (the fake's boards are not real sites).
 */
async function toJobsApplyAsk(page: Page) {
  await toJobsPreview(page);
  const employer = page.waitForEvent('popup');
  await page.getByRole('link', { name: /^Manual apply/ }).click();
  await (await employer).close();
  await page.getByRole('group', { name: 'Did you apply on the employer site?' }).waitFor();
}

/** #52 PR C: a job marked applied: out of Matches, the line saying so with Undo. */
async function toMatchesApplied(page: Page) {
  await toJobsApplyAsk(page);
  await page.getByRole('button', { name: 'I applied' }).click();
  await page.getByRole('button', { name: 'Undo' }).waitFor();
}

/**
 * #52 PR E: a company applied to 3 times in 30 days (the fake's "cooling" board): its rows say
 * until when, and its job's pane has Manual apply unavailable, saying why.
 */
async function toMatchesCooling(page: Page) {
  await findJobs(page, 'boards.greenhouse.io/cooling-co');
  await page.getByRole('cell', { name: 'Done', exact: true }).waitFor({ timeout: 15_000 });
  await openTab(page, 'Matches');
  await page.getByRole('button', { name: 'Senior Backend Engineer' }).click();
  await page.getByText(/^You reached the limit of 3 applications to Cooling co/).waitFor();
  await page.getByText(/Design and run TypeScript services on AWS/).waitFor();
}

/** #52 PR D: Applications before any job is applied to. */
async function toApplicationsEmpty(page: Page) {
  await toJobs(page);
  await openTab(page, 'Applications');
  await page.getByText('No applications yet').waitFor();
}

/** #52 PR D: Applications with the job applied to in Matches, moved on to Interviewing. */
async function toApplications(page: Page) {
  await toMatchesApplied(page);
  await openTab(page, 'Applications');
  const stage = page.getByRole('combobox', { name: 'Stage for Senior Backend Engineer at Acme' });
  await stage.selectOption('interviewing');
  await page
    .getByRole('status')
    .filter({ hasText: 'Senior Backend Engineer at Acme: Interviewing.' })
    .waitFor({ state: 'attached' });
}

/** A link that could not be read, its reason beside it. */
async function toJobsFailed(page: Page) {
  await findJobs(page, 'unreachable.example.com/careers');
  await page.getByText('Couldn’t read unreachable.example.com.', { exact: false }).waitFor({
    timeout: 15_000,
  });
}

/** The free AI runs used up: the reason, and the way on (keywords only). */
async function toJobsAiUsedUp(page: Page) {
  await findJobs(page, 'ai-limit.example.com/careers');
  await page.getByRole('button', { name: 'Find jobs without AI scores' }).waitFor();
}

/** Signed in, on the Profile page. */
async function toSignedIn(page: Page) {
  await toJobs(page);
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Profile' })
    .click();
  await page
    .getByRole('heading', { level: 1, name: 'What your deputy knows about you.' })
    .waitFor();
}
