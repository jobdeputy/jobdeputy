import { readFileSync } from 'node:fs';
import { atsJobKey, jobIdOf } from '@jobdeputy/shared/job-id';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { buildEnv } from '../build-env.ts';
import { readSettings } from '../src/settings.ts';
import { siteOrigins } from '../src/site.ts';
import { withExtension } from './extension.ts';

// #54 PR C: the filler on a Greenhouse form, in Chromium with the built extension. The form is
// the saved copy of a real one (test/fixtures), served at its real address: CI never touches a
// real job site. Before its scripts run its choices have no options, so those are left; choosing
// is tested against the real widget in test/greenhouse-fill.test.tsx.
const settings = readSettings(buildEnv());
if (process.env.CI && !settings) throw new Error('CI builds the extension with WXT_* settings');

const FORM = readFileSync(
  new URL('../test/fixtures/greenhouse-form.html', import.meta.url),
  'utf8',
);
const POSTING = 'https://job-boards.greenhouse.io/acme/jobs/4001001';
const EMBED = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4001001';
const CONFIRMATION = `${POSTING}/confirmation`;
const PDF = Buffer.from('%PDF-1.7\n% JobDeputy e2e résumé\n');

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apply</title></head>
  <body style="font-family: system-ui, sans-serif; max-width: 680px; margin: 32px auto; padding: 0 16px">
  <h1>Senior Engineer at Acme</h1>${body}</body></html>`;

/** The API and files, answered here: the service worker's calls go through the context's routes. */
async function serve(context: BrowserContext, { listed = true } = {}) {
  if (!settings) throw new Error('no settings');
  const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
  const bodies: Record<string, unknown> = {
    '/me/profile': {
      version: 2,
      firstName: 'Sam',
      lastName: 'Example',
      email: 'sam@example.com',
      phone: { countryCode: '+1', number: '555 0100' },
      location: { country: 'US' },
      links: { linkedin: 'https://www.linkedin.com/in/sam-example', other: [] },
      preferredName: 'Sammy',
    },
    '/me/applicant': { version: 1, workAuthorization: [], workSetups: [], over18: true },
    '/me/voluntary': { version: 0 },
    '/me/tailorings?companyKey=greenhouse%3Aacme': {
      tailorings: [
        {
          documentId: 't1',
          status: 'ready',
          createdAt: '2026-11-27T10:00:00Z',
          fileName: 'Sam Example – Acme.pdf',
        },
      ],
    },
    '/me/tailorings/t1': { downloads: { pdf: `${settings.filesOrigin}/t1.pdf`, docx: 'x' } },
    [`/me/cover-letters?jobId=${jobId}`]: { coverLetters: [] },
    '/me/documents': { documents: [] },
    // #54 PR D: the job, as an extension token sees it (in the list, stage New).
    ...(listed
      ? {
          [`/me/jobs/${jobId}`]: {
            jobId,
            title: 'Senior Engineer',
            companyName: 'Acme',
            status: 'new',
          },
        }
      : {}),
  };
  const seen: string[] = [];
  await context.route(`${settings.apiUrl}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    if (route.request().method() === 'PUT') {
      // #54 PR D: the extension's one write.
      seen.push(`PUT ${path} ${route.request().postData()}`);
      return route.fulfill({ json: { jobId, status: 'applied' } });
    }
    seen.push(path);
    return route.fulfill({ json: bodies[path] ?? {}, status: path in bodies ? 200 : 404 });
  });
  // #54 PR D: Greenhouse's page after a submit.
  await context.route(CONFIRMATION, (route) =>
    route.fulfill({
      body: page('<p>Thank you for applying. Your application has been received.</p>'),
      contentType: 'text/html',
    }),
  );
  // #54 PR D: the web app's job pane (its Auto apply hands the job to the extension).
  const site = SITE;
  if (site)
    await context.route(`${site}/**`, (route) =>
      route.fulfill({ body: page('<p>The job pane.</p>'), contentType: 'text/html' }),
    );
  await context.route(`${settings.filesOrigin}/**`, (route) =>
    route.fulfill({ body: PDF, contentType: 'application/pdf' }),
  );
  await context.route('https://job-boards.greenhouse.io/acme/benefits.pdf', (route) =>
    route.fulfill({
      body: PDF,
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="benefits.pdf"' },
    }),
  );
  await context.route(POSTING, (route) =>
    route.fulfill({
      body: page(`<a href="/acme/benefits.pdf" download>Our benefits</a>${FORM}`),
      contentType: 'text/html',
    }),
  );
  await context.route(EMBED, (route) =>
    route.fulfill({ body: page(FORM), contentType: 'text/html' }),
  );
  // The board's list of jobs, which opens a job without loading a page (as Greenhouse's app does).
  await context.route('https://job-boards.greenhouse.io/acme', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: page(`<a href="/acme/jobs/4001001" data-job>Senior Engineer</a>
        <a href="/acme/jobs/4001002" data-job>Staff Engineer</a>
        <template id="form">${FORM}</template>
        <script>
          // As the board does: the address first, the job's form a moment later.
          for (const link of document.querySelectorAll('[data-job]')) {
            link.addEventListener('click', (event) => {
              event.preventDefault();
              history.pushState({}, '', link.getAttribute('href'));
              setTimeout(() => {
                document.getElementById('application-form')?.remove();
                document.body.append(document.getElementById('form').content.cloneNode(true));
              }, 300);
            });
          }
        </script>`),
    }),
  );
  await context.route('https://careers.acme.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: page(`<p>Our careers site, with Greenhouse's form below.</p>
        <iframe title="Application" src="${EMBED}" style="width: 100%; height: 1400px; border: 0"></iframe>`),
    }),
  );
  return seen;
}

async function signIn(context: BrowserContext) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: { storage: { session: { set(items: object): Promise<void> } } };
    };
    await chrome.storage.session.set({
      session: {
        accessToken: 'e2e-access',
        refreshToken: 'e2e-refresh',
        expiresAt: Date.now() + 3_600_000,
        email: 'sam@example.com',
      },
    });
  });
}

const value = (tab: Page, id: string) => tab.locator(`#${id}`).inputValue();

test('on a Greenhouse form, the panel fills it, attaches the résumé, and lists what is left', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    const seen = await serve(context);
    await signIn(context);
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1280, height: 800 });
    await tab.goto(POSTING);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    await expect(panel.getByRole('button', { name: 'Fill this application' })).toBeVisible();
    await expect(panel.getByTitle('Development build')).toBeVisible();
    await tab.screenshot({ path: 'screenshots/greenhouse-panel.png' });

    await panel.getByRole('button', { name: 'Fill this application' }).click();
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    expect(await value(tab, 'first_name')).toBe('Sam');
    expect(await value(tab, 'email')).toBe('sam@example.com');
    expect(await value(tab, 'phone')).toBe('+1 555 0100');
    const resume = await tab.locator('#resume').evaluate((input: HTMLInputElement) => ({
      name: input.files?.[0]?.name,
      size: input.files?.[0]?.size,
    }));
    expect(resume).toEqual({ name: 'Sam Example – Acme.pdf', size: PDF.length });
    await expect(panel.getByText('Attached your résumé tailored for this company.')).toBeVisible();
    await expect(panel.getByRole('heading', { name: /^Left for you/ })).toBeVisible();
    await expect(panel.getByText('Check every answer, then click Submit yourself.')).toBeVisible();
    // Never submitted: the form is where it was.
    expect(tab.url()).toBe(POSTING);
    // Only reads, and only for this posting's company and job.
    expect(seen).toContain('/me/tailorings?companyKey=greenhouse%3Aacme');
    await tab.screenshot({ path: 'screenshots/greenhouse-filled.png' });
    // Only the #hash changes (the same job): the panel and its summary stay.
    await tab.evaluate(() => {
      location.hash = 'app';
    });
    await expect(tab).toHaveURL(`${POSTING}#app`);
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    // A download link announces a navigation that never happens: the panel stays.
    const download = tab.waitForEvent('download');
    await tab.getByRole('link', { name: 'Our benefits' }).click();
    await download;
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();

    // A left question, from the list: the page scrolls to it and focuses it.
    const first = panel.getByRole('list').last().getByRole('button').first();
    const label = await first.textContent();
    await first.click();
    await expect(tab.locator(':focus')).toHaveAttribute('id', /.+/);
    expect(label).not.toBe('');
  } finally {
    await close();
  }
});

test('on a company site that embeds the form, the panel shows above it, in the frame', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    await serve(context);
    await signIn(context);
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1280, height: 800 });
    await tab.goto('https://careers.acme.test/jobs?gh_jid=4001001');
    const frame = tab.frameLocator('iframe[title="Application"]');
    const panel = frame.getByRole('region', { name: 'JobDeputy' });
    await panel.getByRole('button', { name: 'Fill this application' }).click();
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    await expect(frame.locator('#first_name')).toHaveValue('Sam');
    // Only the frame: the company's own page has no panel.
    await expect(tab.getByRole('region', { name: 'JobDeputy' })).toHaveCount(0);
    // The frame's top in view (the panel above the form), as a person scrolling to it sees it.
    await tab.evaluate(() => {
      const top = document.querySelector('iframe')?.getBoundingClientRect().top ?? 0;
      window.scrollTo(0, window.scrollY + top - 24);
    });
    await tab.screenshot({ path: 'screenshots/greenhouse-embedded.png' });
  } finally {
    await close();
  }
});

test('opening a job inside the board, without a page load, brings the panel', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    await serve(context);
    await signIn(context);
    const tab = await context.newPage();
    await tab.goto('https://job-boards.greenhouse.io/acme');
    await tab.getByRole('link', { name: 'Senior Engineer' }).click();
    await expect(tab).toHaveURL(POSTING);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    await panel.getByRole('button', { name: 'Fill this application' }).click();
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    expect(await value(tab, 'first_name')).toBe('Sam');

    // On to another job: a fresh panel, on the new job's form (not the old one it replaces).
    await tab.getByRole('link', { name: 'Staff Engineer' }).click();
    await expect(tab).toHaveURL('https://job-boards.greenhouse.io/acme/jobs/4001002');
    const fresh = tab.getByRole('region', { name: 'JobDeputy' });
    await fresh.getByRole('button', { name: 'Fill this application' }).click();
    await expect(fresh.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    await expect(tab.locator('form#application-form')).toHaveCount(1);
    expect(await value(tab, 'first_name')).toBe('Sam');
    // Only one panel: the board's page had none to leave behind.
    await expect(tab.getByRole('region', { name: 'JobDeputy' })).toHaveCount(1);
  } finally {
    await close();
  }
});

test('signed out, the panel says to sign in from the toolbar', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    await serve(context);
    const tab = await context.newPage();
    await tab.goto(POSTING);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    await panel.getByRole('button', { name: 'Fill this application' }).click();
    await expect(panel.getByRole('alert')).toHaveText(/Sign in from the JobDeputy button/);
    expect(await value(tab, 'first_name')).toBe('');
  } finally {
    await close();
  }
});

/** The web app's first origin this build lets message it (#54 PR D). */
const SITE = settings
  ? siteOrigins(settings, { store: process.env.JD_STORE_BUILD === '1' })[0]
  : '';

test('Auto apply: the web app hands over a job; its form opens in a new tab and fills itself', async () => {
  test.skip(!settings || !SITE, 'a build without sign-in settings or a site');
  const { context, id, close } = await withExtension({ offline: true });
  try {
    await serve(context);
    await signIn(context);
    const site = await context.newPage();
    await site.goto(`${SITE}/jobs`);
    const send = (message: unknown) =>
      site.evaluate(
        ([extension, body]) =>
          (
            globalThis as unknown as {
              chrome: { runtime: { sendMessage(id: string, m: unknown): Promise<unknown> } };
            }
          ).chrome.runtime.sendMessage(extension as string, body),
        [id, message] as const,
      );
    expect(await send({ type: 'hello' })).toEqual({ version: expect.any(String), signedIn: true });
    const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
    // Another job's form, or not a Greenhouse form: refused, and no tab opens.
    expect(
      await send({
        type: 'auto-apply',
        jobId,
        url: 'https://job-boards.greenhouse.io/acme/jobs/9',
      }),
    ).toEqual({ ok: false, reason: 'wrong-job' });
    expect(await send({ type: 'auto-apply', jobId, url: 'https://evil.example/' })).toEqual({
      ok: false,
      reason: 'not-greenhouse',
    });
    const opened = context.waitForEvent('page');
    expect(await send({ type: 'auto-apply', jobId, url: POSTING })).toEqual({ ok: true });
    const tab = await opened;
    await tab.setViewportSize({ width: 1280, height: 800 });
    // Opened at the job's form. Its first load never reaches the network (offline); loaded
    // through the routes, it is still the tab Auto apply opened.
    await expect(tab).toHaveURL(POSTING);
    // Whether the routes caught the first load is a race: load it again only if they didn't.
    await tab.waitForLoadState('domcontentloaded');
    if ((await tab.locator('form#application-form').count()) === 0) await tab.goto(POSTING);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    // Filled without a click.
    await expect(panel.getByText(/^\d+ of \d+ questions answered$/)).toBeVisible();
    expect(await value(tab, 'first_name')).toBe('Sam');
    await tab.screenshot({ path: 'screenshots/greenhouse-auto-apply.png' });
    // Once: a reload waits for the button.
    await tab.reload();
    await expect(panel.getByRole('button', { name: 'Fill this application' })).toBeVisible();
    expect(await value(tab, 'first_name')).toBe('');
    // A form the person opened themselves never fills on its own.
    const own = await context.newPage();
    await own.goto(POSTING);
    await expect(
      own.getByRole('region', { name: 'JobDeputy' }).getByRole('button', {
        name: 'Fill this application',
      }),
    ).toBeVisible();
    expect(await value(own, 'first_name')).toBe('');
  } finally {
    await close();
  }
});

test('on the confirmation page, "Mark as applied?" records the application in one click', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    const seen = await serve(context);
    await signIn(context);
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1280, height: 800 });
    await tab.goto(CONFIRMATION);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    await expect(
      panel.getByText('You applied to Senior Engineer at Acme. Mark it as applied in JobDeputy?'),
    ).toBeVisible();
    await tab.screenshot({ path: 'screenshots/greenhouse-confirmation.png' });
    await panel.getByRole('button', { name: 'Mark as applied' }).click();
    await expect(panel.getByText(/^Marked as applied\./)).toBeVisible();
    await tab.screenshot({ path: 'screenshots/greenhouse-confirmation-saved.png' });
    const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
    expect(seen).toContain(`/me/jobs/${jobId}`);
    expect(seen).toContain(`PUT /me/jobs/${jobId}/stage {"stage":"applied","from":"new"}`);
    // The only write.
    expect(seen.filter((entry) => entry.startsWith('PUT '))).toHaveLength(1);
  } finally {
    await close();
  }
});

test('on the confirmation page of a job not in the list, there is nothing to record', async () => {
  test.skip(!settings, 'a build without sign-in settings');
  const { context, close } = await withExtension();
  try {
    const seen = await serve(context, { listed: false });
    await signIn(context);
    const tab = await context.newPage();
    await tab.goto(CONFIRMATION);
    const panel = tab.getByRole('region', { name: 'JobDeputy' });
    await expect(panel.getByText(/isn’t in your JobDeputy list/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Mark as applied' })).toHaveCount(0);
    expect(seen.filter((entry) => entry.startsWith('PUT '))).toHaveLength(0);
  } finally {
    await close();
  }
});
