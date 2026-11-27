import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchesList } from '../src/components/jobs/matches-list.tsx';
import { RunWatcher } from '../src/components/jobs/tailor-section.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { type ApiClient, ApiContext, type ApiMethod } from '../src/lib/api/index.ts';

/** Links pressed here never navigate (happy-dom would follow them); their addresses are kept. */
let pressed: string[] = [];
/** The names pressed links save their file as (`download`). */
let savedAs: string[] = [];
function stayHere(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.('a');
  if (!link) return;
  pressed.push(link.getAttribute('href') ?? '');
  if (link.hasAttribute('download')) savedAs.push(link.getAttribute('download') ?? '');
  event.preventDefault();
}

beforeEach(() => {
  pressed = [];
  savedAs = [];
  document.addEventListener('click', stayHere, true);
  // Wide: the pane beside the table (Tailwind's xl).
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(min-width: 80rem)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  document.removeEventListener('click', stayHere, true);
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BACKEND = 'Senior Backend Engineer';
const PLATFORM = 'Platform Engineer, Developer Experience';

/** Acme's three jobs read (each stage of the fake's work `crawlMs` long, on a held clock). */
async function setUp({
  crawlMs = 0,
  wrap,
}: {
  crawlMs?: number;
  wrap?: (api: ApiClient) => ApiClient;
} = {}) {
  const clock = { now: Date.parse('2026-11-25T15:00:00Z') };
  const fake = createFakeApi({ delay: 0, crawlMs, now: () => clock.now });
  await fake.request('POST', '/me/crawls', { url: 'https://boards.greenhouse.io/acme' });
  clock.now += 10 * crawlMs;
  const api = wrap ? wrap(fake) : fake;
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (shown: boolean) => (
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>{shown && <MatchesList version="v1" />}</ApiContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  await screen.findByRole('button', { name: BACKEND });
  /** Matches left (another tab), then opened again, with the same cache. */
  const remount = async () => {
    view.rerender(tree(false));
    view.rerender(tree(true));
    await screen.findByRole('button', { name: BACKEND });
  };
  return { fake, clock, remount };
}

/** The open job's tailoring section, once its versions are read. */
async function openSection(title: string) {
  fireEvent.click(screen.getByRole('button', { name: title }));
  const pane = within(screen.getByRole('region', { name: title }));
  const region = await pane.findByRole('region', { name: 'Your résumé for Acme' });
  await waitFor(() => expect(region.getAttribute('aria-busy')).toBeNull());
  return within(region);
}

/** The Matches table's cell for a job, in a column. */
function cell(title: string, column: number) {
  const row = screen.getByRole('button', { name: title }).closest('tr');
  return row?.querySelectorAll('td')[column]?.textContent;
}

/** An API that answers `method path` with `answer` (or throws it), else as the fake. */
function answering(method: string, path: string, answer: () => unknown) {
  return (api: ApiClient): ApiClient => ({
    ...api,
    async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
      if (m === method && p.startsWith(path)) return answer() as T;
      return api.request<T>(m, p, body);
    },
  });
}

describe('tailoring in the job pane (#51 PR C)', () => {
  it('starts a run, follows it, then shows this job’s score and updates the Score column', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { clock } = await setUp({ crawlMs: 1000 });
    const scoreColumn = screen
      .getAllByRole('columnheader')
      .findIndex((h) => /Résumé score/.test(h.textContent ?? ''));
    expect(cell(BACKEND, scoreColumn)).toBe('Not tailored');
    const section = await openSection(BACKEND);
    expect(section.getByText(/10 of 10 free runs left this month/)).toBeTruthy();
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    // Followed while it works: the button waits, and says why.
    expect(await section.findByText('Tailoring your résumé for Acme…')).toBeTruthy();
    const again = section.getByRole('button', { name: 'Tailor résumé' });
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(await section.findByText(/9 of 10 free runs left/)).toBeTruthy();
    // The fake's run ends 2 stages later; the next check (5 s) finds it ready.
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await section.findByText('86%')).toBeTruthy();
    expect(section.getByText('Your base résumé: 61%')).toBeTruthy();
    expect(section.getByText('Ready to apply: 80% or more.')).toBeTruthy();
    expect(section.queryByText('Tailoring your résumé for Acme…')).toBeNull();
    expect(section.getByRole('button', { name: 'Re-tailor' })).toBeTruthy();
    // Matches is read again: the column has the scores now.
    await waitFor(() => expect(cell(BACKEND, scoreColumn)).toBe('86%'));
    expect(cell(PLATFORM, scoreColumn)).toBe('72%');
  });

  it('below 80%: warns, lists what is missing, and I have this saves the skill for a Re-tailor', async () => {
    const { fake } = await setUp();
    let section = await openSection(PLATFORM);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    expect(await section.findByText('72%')).toBeTruthy();
    expect(section.getByText(/Below 80%\. You can still apply\./)).toBeTruthy();
    expect(section.getByText('GraphQL')).toBeTruthy();
    // No profile saved yet: the skill can't be added, and the way there is given.
    fireEvent.click(section.getByRole('button', { name: 'I have this: Kafka' }));
    expect(
      await section.findByText('Save your profile first, then add skills to it.'),
    ).toBeTruthy();
    expect(section.getByRole('link', { name: 'Go to Profile' }).getAttribute('href')).toBe(
      '/profile',
    );
    await fake.request('PUT', '/me/profile', { version: 0, firstName: 'Sam', lastName: 'Example' });
    fireEvent.click(section.getByRole('button', { name: 'I have this: Kafka' }));
    expect(
      await section.findByText('Kafka was added to your profile. Re-tailor to use it.'),
    ).toBeTruthy();
    expect(section.queryByRole('button', { name: 'I have this: Kafka' })).toBeNull();
    expect(section.getByText('Added to your profile')).toBeTruthy();
    expect(section.queryByText('Save your profile first, then add skills to it.')).toBeNull();
    const profile = await fake.request<{ skills: string[] }>('GET', '/me/profile');
    expect(profile.skills).toEqual(['Kafka']);
    // Re-tailor uses it: the score rises, and Kafka is no longer missing.
    fireEvent.click(section.getByRole('button', { name: 'Re-tailor' }));
    section = within(screen.getByRole('region', { name: 'Your résumé for Acme' }));
    expect(await section.findByText('78%')).toBeTruthy();
    expect(section.queryByRole('button', { name: 'I have this: Kafka' })).toBeNull();
    expect(section.getByRole('button', { name: 'I have this: Terraform' })).toBeTruthy();
  });

  it('downloads the PDF or DOCX from fresh links read on the click', async () => {
    const { fake } = await setUp();
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    const read = vi.spyOn(fake, 'request');
    fireEvent.click(await section.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(pressed).toEqual([expect.stringMatching(/^data:application\/pdf/)]));
    fireEvent.click(section.getByRole('button', { name: 'Download DOCX' }));
    await waitFor(() => expect(pressed).toHaveLength(2));
    expect(pressed[1]).toMatch(/^data:application\/vnd\.openxmlformats/);
    expect(savedAs).toEqual(['Sam Example – Acme.pdf', 'Sam Example – Acme.docx']);
    expect(
      read.mock.calls.filter(([m, p]) => m === 'GET' && /^\/me\/tailorings\/\d+$/.test(p)),
    ).toHaveLength(2);
  });

  it('says when a download could not start', async () => {
    await setUp({
      wrap: answering('GET', '/me/tailorings/', () => {
        throw new ApiError('server', { status: 500 });
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    fireEvent.click(await section.findByRole('button', { name: 'Download PDF' }));
    expect(await section.findByText('The download didn’t start. Try again.')).toBeTruthy();
    expect(pressed).toEqual([]);
  });

  it.each([
    ['no_resume', 422, 'invalid', /Upload a résumé/, 'Go to Résumés'],
    ['tailoring_busy', 409, 'conflict', /already running/, undefined],
    ['model_needed', 422, 'invalid', /needs an AI model/, undefined],
    ['no_jobs', 422, 'invalid', /no jobs shown/, undefined],
    ['tailoring_allowance', 429, 'too-many', /You’ve used this month’s 10 free runs/, undefined],
  ] as const)('a refused start (%s) says why', async (code, status, kind, words, link) => {
    await setUp({
      wrap: answering('POST', '/me/tailorings', () => {
        throw new ApiError(kind, { status, code });
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    const alert = await waitFor(() => {
      const found = section.getAllByRole('alert').find((a) => words.test(a.textContent ?? ''));
      if (!found) throw new Error('not said yet');
      return found;
    });
    if (link) expect(within(alert).getByRole('link', { name: link })).toBeTruthy();
    else expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('a Tailor whose answer was lost says it may have started (D3 round 3)', async () => {
    await setUp({
      wrap: answering('POST', '/me/tailorings', () => {
        throw new ApiError('unsure');
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    expect(
      await section.findByText(
        'We couldn’t tell whether that started. If it did, it shows here in a moment.',
      ),
    ).toBeTruthy();
  });

  it('a failed run says why, and can be tried again', async () => {
    await setUp({
      wrap: answering('GET', '/me/tailorings?', () => ({
        tailorings: [
          {
            documentId: '1'.padStart(26, '0'),
            companyKey: 'greenhouse:acme',
            jobIds: [],
            status: 'failed',
            error: 'model_unavailable',
            message: 'The AI model was unavailable. Try again later.',
            createdAt: '2026-11-25T14:00:00.000Z',
          },
        ],
        allowance: { used: 1, perMonth: 10, nextAt: '2026-12-01T00:00:00.000Z' },
      })),
    });
    const section = await openSection(BACKEND);
    expect(section.getByText('This tailoring didn’t finish.')).toBeTruthy();
    expect(section.getByText('The AI model was unavailable. Try again later.')).toBeTruthy();
    expect(
      section.getByRole('button', { name: 'Tailor résumé' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('a version made before this job showed offers Re-tailor, and warns of a résumé partly read', async () => {
    await setUp({
      wrap: answering('GET', '/me/tailorings?', () => ({
        tailorings: [
          {
            documentId: '1'.padStart(26, '0'),
            companyKey: 'greenhouse:acme',
            jobIds: ['other'],
            status: 'ready',
            result: 'ok',
            scores: [
              { jobId: 'other', base: 50, tailored: 90, missingProven: [], missingUnproven: [] },
            ],
            coverage: 0.6,
            createdAt: '2026-11-25T14:00:00.000Z',
            finishedAt: '2026-11-25T14:02:00.000Z',
          },
        ],
        allowance: { used: 10, perMonth: 10, nextAt: '2026-12-01T00:00:00.000Z' },
      })),
    });
    const section = await openSection(BACKEND);
    expect(
      section.getByText('This version was made before this job showed. Re-tailor to include it.'),
    ).toBeTruthy();
    expect(section.getByText(/Part of your résumé couldn’t be read/)).toBeTruthy();
    expect(section.getByRole('button', { name: 'Re-tailor' })).toBeTruthy();
    expect(
      section.getByText(
        /You’ve used this month’s 10 free runs for résumés and cover letters\. More from/,
      ),
    ).toBeTruthy();
  });

  it('says when the versions did not load, and reads them again on Try again', async () => {
    let fail = true;
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (fail && m === 'GET' && p.startsWith('/me/tailorings?')) {
            throw new ApiError('server', { status: 500 });
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    const section = await openSection(BACKEND);
    expect(await section.findByText('Your tailored résumés didn’t load.')).toBeTruthy();
    fail = false;
    fireEvent.click(section.getByRole('button', { name: 'Try again' }));
    expect(await section.findByRole('button', { name: 'Tailor résumé' })).toBeTruthy();
  });

  it('updates the Score column when a run ends after its pane was closed (review round 1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { clock } = await setUp({ crawlMs: 1000 });
    const scoreColumn = screen
      .getAllByRole('columnheader')
      .findIndex((h) => /Résumé score/.test(h.textContent ?? ''));
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    expect(await section.findByText('Tailoring your résumé for Acme…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Your résumé for Acme' })).toBeNull();
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(cell(BACKEND, scoreColumn)).toBe('86%'));
  });

  it('keeps a skill already on the profile marked added when the pane opens again', async () => {
    const { fake } = await setUp();
    await fake.request('PUT', '/me/profile', { version: 0, firstName: 'Sam', lastName: 'Example' });
    let section = await openSection(PLATFORM);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    fireEvent.click(await section.findByRole('button', { name: 'I have this: Kafka' }));
    expect(
      await section.findByText('Kafka was added to your profile. Re-tailor to use it.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    section = await openSection(PLATFORM);
    await waitFor(() =>
      expect(section.queryByRole('button', { name: 'I have this: Kafka' })).toBeNull(),
    );
    expect(section.getByText('Added to your profile')).toBeTruthy();
    expect(section.getByRole('button', { name: 'I have this: Terraform' })).toBeTruthy();
  });

  it('says a job tailored with no keyword to count has nothing to score, in the table and the pane', async () => {
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          const answer = await api.request<T>(m, p, body);
          if (m === 'GET' && p === '/me/matches') {
            const matches = answer as { jobs: { title: string; match?: unknown }[] };
            for (const job of matches.jobs) {
              if (job.title === BACKEND)
                job.match = { score: null, base: null, resumeDocumentId: 'x' };
            }
          }
          if (m === 'GET' && p.startsWith('/me/tailorings?')) {
            const list = answer as { tailorings: { scores?: { tailored: number | null }[] }[] };
            for (const t of list.tailorings)
              for (const score of t.scores ?? []) score.tailored = null;
          }
          return answer;
        },
      }),
    });
    const scoreColumn = screen
      .getAllByRole('columnheader')
      .findIndex((h) => /Résumé score/.test(h.textContent ?? ''));
    expect(cell(BACKEND, scoreColumn)).toBe('No keywords to score');
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    await waitFor(() =>
      expect(section.getAllByText('No keywords to score').length).toBeGreaterThan(0),
    );
    expect(section.queryByText(/Below 80%/)).toBeNull();
    expect(section.queryByText(/Ready to apply/)).toBeNull();
  });

  it('follows a run again when Matches opens anew mid-run (review round 2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { clock, remount } = await setUp({ crawlMs: 1000 });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    expect(await section.findByText('Tailoring your résumé for Acme…')).toBeTruthy();
    await remount();
    const scoreColumn = screen
      .getAllByRole('columnheader')
      .findIndex((h) => /Résumé score/.test(h.textContent ?? ''));
    expect(cell(BACKEND, scoreColumn)).toBe('Not tailored');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(cell(BACKEND, scoreColumn)).toBe('86%'));
  });

  it('says a run followed here ended ready, and a new version starts with nothing said', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fake, clock } = await setUp({ crawlMs: 1000 });
    await fake.request('PUT', '/me/profile', { version: 0, firstName: 'Sam', lastName: 'Example' });
    const section = await openSection(PLATFORM);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    await section.findByText('Tailoring your résumé for Acme…');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    const status = () =>
      section.getAllByRole('status').find((s) => /is ready/.test(s.textContent ?? ''));
    await waitFor(() =>
      expect(status()?.textContent).toBe('Your résumé for Acme is ready: 72% match for this job.'),
    );
    fireEvent.click(section.getByRole('button', { name: 'I have this: Kafka' }));
    await section.findByText('Kafka was added to your profile. Re-tailor to use it.');
    fireEvent.click(section.getByRole('button', { name: 'Re-tailor' }));
    await section.findByText('Tailoring your résumé for Acme…');
    expect(status()).toBeUndefined();
    // Being done now: "Re-tailor to use it" is no longer said.
    expect(section.queryByText('Kafka was added to your profile. Re-tailor to use it.')).toBeNull();
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await section.findByText('78%')).toBeTruthy();
    // The new version: the line about the one before is gone.
    expect(section.queryByText('Kafka was added to your profile. Re-tailor to use it.')).toBeNull();
  });

  it('keeps a refused start said while the run it met works, and clears it once that run ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let busy = true;
    const { clock } = await setUp({
      crawlMs: 1000,
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (busy && m === 'POST' && p === '/me/tailorings') {
            // Another tab's run: started there, so this click is refused.
            await api.request(m, p, body);
            busy = false;
            throw new ApiError('conflict', { status: 409, code: 'tailoring_busy' });
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    const section = await openSection(BACKEND);
    const refusal = 'A tailoring for this company is already running.';
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    // The list read after the refusal shows the other tab's run: the refusal stays said.
    expect(await section.findByText('Tailoring your résumé for Acme…')).toBeTruthy();
    expect(section.getByText(refusal)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(section.getByText('Tailoring your résumé for Acme…')).toBeTruthy();
    expect(section.getByText(refusal)).toBeTruthy();
    // That run ends: the refusal no longer holds.
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await section.findByText('86%')).toBeTruthy();
    expect(section.queryByText(refusal)).toBeNull();
  });

  it('a watcher whose first read fails stops following (review round 3)', async () => {
    const offline: ApiClient = {
      ...createFakeApi({ delay: 0 }),
      async request() {
        throw new ApiError('offline');
      },
    };
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={queries}>
        <ApiContext.Provider value={offline}>
          <RunWatcher companyKey="greenhouse:acme" onDone={onDone} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    // Offline is tried once more (after about 1 s) before the read fails.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('greenhouse:acme'), {
      timeout: 5000,
    });
  });

  it('previews the résumé in a dialog, laid out as its files, with the downloads under it (C2)', async () => {
    const { fake } = await setUp();
    await fake.request('PUT', '/me/profile', {
      version: 0,
      firstName: 'Sam',
      lastName: 'Example',
      skills: ['Kafka'],
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    const open = await section.findByRole('button', { name: 'Preview' });
    fireEvent.click(open);
    const dialog = within(await screen.findByRole('dialog', { name: 'Your résumé for Acme' }));
    const page = within(await dialog.findByRole('article', { name: 'Résumé preview' }));
    expect(page.getByRole('heading', { level: 3, name: 'Sam Example' })).toBeTruthy();
    expect(page.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Summary',
      'Skills',
      'Experience',
      'Education',
      'Certifications',
    ]);
    expect(page.getByText(/ready to bring payments and platform experience to Acme/)).toBeTruthy();
    // A skill the profile added (I have this) is in the tailored skills.
    expect(page.getByText(/AWS Lambda, DynamoDB, GraphQL, Kafka/)).toBeTruthy();
    expect(page.getByText('Senior Software Engineer, Example Logistics')).toBeTruthy();
    expect(page.getByText('New York, NY | Mar 2021 – Present')).toBeTruthy();
    expect(page.getAllByRole('listitem').map((li) => li.textContent)).toContain(
      'Led the move of 12 services to AWS Lambda, cutting hosting costs by 40%.',
    );
    expect(page.getByText('BSc in Computer Science, State University')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(pressed).toEqual([expect.stringMatching(/^data:application\/pdf/)]));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it('says when the preview did not load, and reads it again on Try again (C2)', async () => {
    let fail = true;
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (fail && m === 'GET' && /^\/me\/tailorings\/\d+$/.test(p)) {
            throw new ApiError('server', { status: 500 });
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    fireEvent.click(await section.findByRole('button', { name: 'Preview' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Your résumé for Acme' }));
    expect(await dialog.findByText('Your résumé didn’t load.')).toBeTruthy();
    fail = false;
    fireEvent.click(dialog.getByRole('button', { name: 'Try again' }));
    expect(await dialog.findByRole('article', { name: 'Résumé preview' })).toBeTruthy();
  });

  it('keeps an open preview open when a re-tailor ends, showing the new version (C2 round 1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fake, clock } = await setUp({ crawlMs: 1000 });
    await fake.request('PUT', '/me/profile', { version: 0, firstName: 'Sam', lastName: 'Example' });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    await section.findByText('Tailoring your résumé for Acme…');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await section.findByText('86%');
    await fake.request('POST', '/me/profile/skills', { skill: 'Kafka' });
    fireEvent.click(section.getByRole('button', { name: 'Re-tailor' }));
    await section.findByText('Tailoring your résumé for Acme…');
    fireEvent.click(section.getByRole('button', { name: 'Preview' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Your résumé for Acme' }));
    expect(await dialog.findByText(/AWS Lambda, DynamoDB, GraphQL$/)).toBeTruthy();
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    // Still open: the new version's résumé (with Kafka) replaces the one before, and says so.
    expect(await dialog.findByText(/AWS Lambda, DynamoDB, GraphQL, Kafka/)).toBeTruthy();
    expect(
      dialog
        .getAllByRole('status')
        .some(
          (s) => s.textContent === 'Your re-tailored résumé is ready. This preview switches to it.',
        ),
    ).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Your résumé for Acme' })).toBeTruthy();
  });

  it('says a ready version without its résumé is unavailable, with no retry (C2 round 1)', async () => {
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          const answer = await api.request<T>(m, p, body);
          if (m === 'GET' && /^\/me\/tailorings\/\d+$/.test(p)) {
            const { resume: _gone, ...rest } = answer as { resume?: unknown };
            return rest as T;
          }
          return answer;
        },
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    fireEvent.click(await section.findByRole('button', { name: 'Preview' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Your résumé for Acme' }));
    expect(await dialog.findByText(/isn’t available\. Re-tailor to make a new one\./)).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says a download asked for in the preview failed, in the pane once the dialog closes (C2 round 2)', async () => {
    let fail = false;
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (fail && m === 'GET' && /^\/me\/tailorings\/\d+$/.test(p)) {
            throw new ApiError('offline');
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    fireEvent.click(await section.findByRole('button', { name: 'Preview' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Your résumé for Acme' }));
    await dialog.findByRole('article', { name: 'Résumé preview' });
    fail = true;
    fireEvent.click(dialog.getByRole('button', { name: 'Download PDF' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await section.findByText('The download didn’t start. Try again.')).toBeTruthy();
    expect(pressed).toEqual([]);
  });

  it('hands the focus to the notice when the job leaves Matches with its preview open (C2 round 2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fake, clock } = await setUp({ crawlMs: 1000 });
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    await section.findByText('Tailoring your résumé for Acme…');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await section.findByText('86%');
    fireEvent.click(section.getByRole('button', { name: 'Re-tailor' }));
    await section.findByText('Tailoring your résumé for Acme…');
    fireEvent.click(section.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('dialog', { name: 'Your résumé for Acme' });
    // Applied in another tab meanwhile: the list read when the run ends leaves it out.
    const { jobs } = await fake.request<{ jobs: { jobId: string; title: string }[] }>(
      'GET',
      '/me/matches',
    );
    const jobId = jobs.find((j) => j.title === BACKEND)?.jobId;
    await fake.request('PUT', `/me/jobs/${jobId}/stage`, { stage: 'applied', from: 'new' });
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const notice = await screen.findByText(/is no longer in Matches/);
    await waitFor(() => expect(document.activeElement).toBe(notice));
  });

  it('saves a file asked for just as a re-tailor ends (C2 round 3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (() => void) | undefined;
    const { clock, fake } = await setUp({
      crawlMs: 1000,
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (release === undefined && m === 'GET' && /^\/me\/tailorings\/\d+$/.test(p)) {
            // The download's links come back only after the re-tailor has ended.
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    void fake;
    const section = await openSection(BACKEND);
    fireEvent.click(section.getByRole('button', { name: 'Tailor résumé' }));
    await section.findByText('Tailoring your résumé for Acme…');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await section.findByText('86%');
    fireEvent.click(section.getByRole('button', { name: 'Re-tailor' }));
    await section.findByText('Tailoring your résumé for Acme…');
    fireEvent.click(section.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(release).toBeDefined());
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(section.queryByText('Tailoring your résumé for Acme…')).toBeNull());
    release?.();
    await waitFor(() => expect(savedAs).toEqual(['Sam Example – Acme.pdf']));
  });
});
