import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchesList } from '../src/components/jobs/matches-list.tsx';
import { ApiError } from '../src/lib/api/client.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { type ApiClient, ApiContext, type ApiMethod } from '../src/lib/api/index.ts';

/** Links pressed here never navigate (happy-dom would follow them); their addresses are kept. */
let pressed: string[] = [];
let savedAs: string[] = [];
function stayHere(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.('a');
  if (!link) return;
  pressed.push(link.getAttribute('href') ?? '');
  if (link.hasAttribute('download')) savedAs.push(link.getAttribute('download') ?? '');
  event.preventDefault();
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pressed = [];
  savedAs = [];
  document.addEventListener('click', stayHere, true);
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
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
const LETTER_TEXT = [
  'Dear Hiring Manager,',
  'I am applying for the Senior Backend Engineer role at Acme.',
].join('\n\n');

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
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <MatchesList version="v1" />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: BACKEND });
  return { fake, clock };
}

/** The open job's letter section, once its letters are read. */
async function openSection(title = BACKEND) {
  fireEvent.click(screen.getByRole('button', { name: title }));
  const pane = within(screen.getByRole('region', { name: title }));
  const region = await pane.findByRole('region', { name: 'Cover letter for this job' });
  await waitFor(() => expect(region.getAttribute('aria-busy')).toBeNull());
  return within(region);
}

/** The pane's résumé section (it counts the same free runs). */
function resumeSection() {
  return within(screen.getByRole('region', { name: 'Your résumé for Acme' }));
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

describe('cover letters in the job pane (#51 PR D3)', () => {
  it('writes a letter, follows it, then offers its files; the résumé section counts the run', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { clock } = await setUp({ crawlMs: 1000 });
    const section = await openSection();
    expect(section.getByText(/It uses your newest résumé tailored for Acme/)).toBeTruthy();
    expect(
      section.getByText('Each letter uses 1 free run. Runs with your own AI key don’t count.'),
    ).toBeTruthy();
    // Outline: Manual apply stays the pane's one main action.
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    expect(await section.findByText('Writing your cover letter…')).toBeTruthy();
    expect(
      section.getByRole('button', { name: 'Write cover letter' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(await resumeSection().findByText(/9 of 10 free runs left this month/)).toBeTruthy();
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await section.findByRole('button', { name: 'Rewrite' })).toBeTruthy();
    expect(section.queryByText('Writing your cover letter…')).toBeNull();
    expect(section.getByText(/^Written .+, from your base résumé\.$/)).toBeTruthy();
    // Said once ready (the letter shows outside the status region).
    expect(section.getAllByRole('status').map((s) => s.textContent)).toContain(
      'Your cover letter is ready.',
    );
    for (const name of ['Preview', 'Copy text', 'Download PDF', 'Download DOCX']) {
      expect(section.getByRole('button', { name })).toBeTruthy();
    }
    // The intro is for a job with no letter yet.
    expect(section.queryByText(/Your deputy writes a letter/)).toBeNull();
  });

  it('says a letter written after tailoring was written from the tailored résumé', async () => {
    await setUp();
    await openSection();
    fireEvent.click(resumeSection().getByRole('button', { name: 'Tailor résumé' }));
    await resumeSection().findByText('86%');
    const section = await openSectionAgain();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    expect(
      await section.findByText(/^Written .+, from your résumé tailored for Acme\.$/),
    ).toBeTruthy();
    // The two runs counted, in both sections.
    expect(await resumeSection().findByText(/8 of 10 free runs left/)).toBeTruthy();
  });

  it('copies the letter’s text (no contact lines) in the click, and says so', async () => {
    await setUp();
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    const copyButton = await section.findByRole('button', { name: 'Copy text' });
    // The text is read when the letter shows, so the click writes it at once.
    await waitFor(() => expect(copyButton.getAttribute('data-pending')).toBeNull());
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied.startsWith(LETTER_TEXT)).toBe(true);
    expect(copied.endsWith('Sincerely,\nSam Example')).toBe(true);
    expect(copied).not.toContain('sam@example.com');
    expect(
      await section.findByText('Copied. Paste it into the application’s cover letter box.'),
    ).toBeTruthy();
  });

  it('says when the browser refused to copy', async () => {
    writeText.mockRejectedValueOnce(new Error('NotAllowedError'));
    await setUp();
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    const copyButton = await section.findByRole('button', { name: 'Copy text' });
    await waitFor(() => expect(copyButton.getAttribute('data-pending')).toBeNull());
    fireEvent.click(copyButton);
    expect(
      await section.findByText('Couldn’t copy the letter. Open Preview and copy it from there.'),
    ).toBeTruthy();
    expect(section.queryByText(/^Copied\./)).toBeNull();
  });

  it('downloads the PDF or DOCX from fresh links read on the click', async () => {
    const { fake } = await setUp();
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    const read = vi.spyOn(fake, 'request');
    fireEvent.click(await section.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(pressed).toEqual([expect.stringMatching(/^data:application\/pdf/)]));
    fireEvent.click(section.getByRole('button', { name: 'Download DOCX' }));
    await waitFor(() => expect(pressed).toHaveLength(2));
    expect(savedAs).toEqual([
      'Sam Example – Cover letter – Acme.pdf',
      'Sam Example – Cover letter – Acme.docx',
    ]);
    // Each click reads its own links (the read for Copy text is not reused: links expire).
    expect(
      read.mock.calls.filter(([m, p]) => m === 'GET' && /^\/me\/cover-letters\/\d+$/.test(p))
        .length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('previews the letter in a dialog, laid out as its files, with Copy and the downloads', async () => {
    await setUp();
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    const open = await section.findByRole('button', { name: 'Preview' });
    fireEvent.click(open);
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Your cover letter for Acme' }),
    );
    const page = within(await dialog.findByRole('article', { name: 'Cover letter preview' }));
    expect(page.getByRole('heading', { level: 3, name: 'Sam Example' })).toBeTruthy();
    expect(
      page.getByText('sam@example.com | New York, NY | https://github.com/sam-example'),
    ).toBeTruthy();
    expect(page.getByText('Dear Hiring Manager,')).toBeTruthy();
    expect(
      page.getByText(/^I am applying for the Senior Backend Engineer role at Acme\./),
    ).toBeTruthy();
    expect(page.getByText('Sincerely,')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Copy text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    fireEvent.click(dialog.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(pressed).toEqual([expect.stringMatching(/^data:application\/pdf/)]));
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it.each([
    ['no_resume', 422, 'invalid', /Upload a résumé/, 'Go to Résumés'],
    ['cover_letter_busy', 409, 'conflict', /already being written/, undefined],
    ['model_needed', 422, 'invalid', /Cover letters need an AI model/, undefined],
    ['no_jobs', 422, 'invalid', /This job has closed or is no longer shown/, undefined],
    ['no_company', 422, 'invalid', /couldn’t find this company’s name/, undefined],
    [
      'tailoring_allowance',
      429,
      'too-many',
      /You’ve used this month’s 10 free runs for résumés and cover letters/,
      undefined,
    ],
  ] as const)('a refused start (%s) says why', async (code, status, kind, words, link) => {
    await setUp({
      wrap: answering('POST', '/me/cover-letters', () => {
        throw new ApiError(kind, { status, code });
      }),
    });
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    const alert = await waitFor(() => {
      const found = section.getAllByRole('alert').find((a) => words.test(a.textContent ?? ''));
      if (!found) throw new Error('not said yet');
      return found;
    });
    if (link) expect(within(alert).getByRole('link', { name: link })).toBeTruthy();
    else expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('a failed run says why, and can be tried again; no free runs left is said briefly', async () => {
    await setUp({
      wrap: answering('GET', '/me/cover-letters?', () => ({
        coverLetters: [
          {
            documentId: '1'.padStart(26, '0'),
            jobId: 'x',
            companyKey: 'greenhouse:acme',
            status: 'failed',
            error: 'no_honest_draft',
            message: 'Every draft said something your résumé does not show, so none was kept.',
            createdAt: '2026-11-25T14:00:00.000Z',
          },
        ],
        allowance: { used: 10, perMonth: 10, nextAt: '2026-12-01T00:00:00.000Z' },
      })),
    });
    const section = await openSection();
    expect(section.getByText('This cover letter wasn’t written.')).toBeTruthy();
    // No free runs left: said briefly (the résumé section above says the count in full).
    expect(section.getByText(/^No free runs left this month\. More from /)).toBeTruthy();
    expect(section.getByText(/Every draft said something your résumé does not show/)).toBeTruthy();
    expect(
      section.getByRole('button', { name: 'Write cover letter' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('says when the letters did not load, and reads them again on Try again', async () => {
    let fail = true;
    await setUp({
      wrap: (api) => ({
        ...api,
        async request<T>(m: ApiMethod, p: `/${string}`, body?: unknown): Promise<T> {
          if (fail && m === 'GET' && p.startsWith('/me/cover-letters?')) {
            throw new ApiError('server', { status: 500 });
          }
          return api.request<T>(m, p, body);
        },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: BACKEND }));
    const pane = within(screen.getByRole('region', { name: BACKEND }));
    const region = within(await pane.findByRole('region', { name: 'Cover letter for this job' }));
    expect(await region.findByText('Your cover letters didn’t load.')).toBeTruthy();
    fail = false;
    fireEvent.click(region.getByRole('button', { name: 'Try again' }));
    expect(await region.findByRole('button', { name: 'Write cover letter' })).toBeTruthy();
  });

  it('keeps the ready letter shown while a rewrite works, then shows the new one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { clock } = await setUp({ crawlMs: 1000 });
    const section = await openSection();
    fireEvent.click(section.getByRole('button', { name: 'Write cover letter' }));
    await section.findByText('Writing your cover letter…');
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    fireEvent.click(await section.findByRole('button', { name: 'Rewrite' }));
    expect(await section.findByText('Writing your cover letter…')).toBeTruthy();
    // The letter already there stays usable meanwhile.
    expect(section.getByRole('button', { name: 'Download PDF' })).toBeTruthy();
    clock.now += 2000;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(section.queryByText('Writing your cover letter…')).toBeNull());
    expect(await resumeSection().findByText(/8 of 10 free runs left/)).toBeTruthy();
  });
});

/** The letter section after the résumé section changed (the pane stays open). */
async function openSectionAgain() {
  const pane = within(screen.getByRole('region', { name: BACKEND }));
  return within(await pane.findByRole('region', { name: 'Cover letter for this job' }));
}
