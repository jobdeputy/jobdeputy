import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchesList } from '../src/components/jobs/matches-list.tsx';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';
import {
  type AutoApplyResult,
  ExtensionContext,
  type ExtensionLink,
  type ExtensionState,
} from '../src/lib/extension.ts';

/** A link pressed here never navigates (happy-dom would reach the real page). */
function stayHere(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
}

beforeEach(() => {
  document.addEventListener('click', stayHere, true);
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeLink(state: ExtensionState, answer: AutoApplyResult = { ok: true }) {
  return {
    check: vi.fn(async () => state),
    autoApply: vi.fn(async (_jobId: string, _url: string): Promise<AutoApplyResult> => answer),
  } satisfies ExtensionLink;
}

const READY: ExtensionState = { state: 'ready', version: '0.1.0', signedIn: true };

/** Matches after a crawl of `url`, with this extension; the first job's pane open. */
async function renderWith(
  link: ExtensionLink,
  url = 'https://boards.greenhouse.io/acme',
  api = createFakeApi({ delay: 0, crawlMs: 0 }),
) {
  await api.request('POST', '/me/crawls', { url });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <ExtensionContext.Provider value={link}>
          <MatchesList version="v1" />
        </ExtensionContext.Provider>
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Senior Backend Engineer' }));
  const pane = within(screen.getByRole('region', { name: 'Senior Backend Engineer' }));
  return { api, pane };
}

const autoButton = (pane: ReturnType<typeof within>) =>
  pane.getByRole('button', { name: /^Auto apply/ });
const hintOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent;

describe('Auto apply through the extension (#54 PR D3)', () => {
  it("hands the job's Greenhouse form to the extension, then asks whether you applied", async () => {
    const link = fakeLink(READY);
    const { api, pane } = await renderWith(link);
    await pane.findByText(/fills it in with your saved answers/);
    // The extension's new tab has the focus when it answers.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const auto = autoButton(pane);
    expect(auto.getAttribute('aria-disabled')).toBeNull();
    expect(auto.textContent).not.toContain('Soon');
    const request = vi.spyOn(api, 'request');
    fireEvent.click(auto);
    expect(await pane.findByText('Did you apply on the employer site?')).toBeTruthy();
    // The board's own form, built from the posting's ID, not the job's stored address.
    const [jobId, url] = link.autoApply.mock.calls[0] ?? [];
    expect(jobId).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toBe('https://job-boards.greenhouse.io/acme/jobs/1');
    // Back on the page: Matches read again (the extension may have recorded the job).
    request.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    const matchesReads = () =>
      request.mock.calls.filter(([method, path]) => method === 'GET' && path === '/me/matches')
        .length;
    expect(matchesReads()).toBe(1);
    // Once: later returns don't read it again.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(matchesReads()).toBe(1);
  });

  it("a Greenhouse job whose posting couldn't be read says so, not that it isn't on Greenhouse", async () => {
    const link = fakeLink(READY);
    const api = createFakeApi({ delay: 0, crawlMs: 0 });
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'GET' && /^\/me\/jobs\/[0-9a-f]{32}$/.test(String(path))) {
        throw new Error('offline');
      }
      return request(method, path, body);
    });
    const { pane } = await renderWith(link, 'https://boards.greenhouse.io/acme', api);
    await pane.findByText(/Couldn’t check this job for Auto apply/);
    expect(autoButton(pane).getAttribute('aria-disabled')).toBe('true');
  });

  it('signed out of the extension, it can still be pressed, and says to sign in first', async () => {
    const { pane } = await renderWith(fakeLink({ ...READY, signedIn: false }));
    await pane.findByText(/Sign in to the JobDeputy extension from your browser’s toolbar first/);
    expect(autoButton(pane).getAttribute('aria-disabled')).toBeNull();
  });

  it('without the extension, it is unavailable and says to add it', async () => {
    const link = fakeLink({ state: 'missing' });
    const { pane } = await renderWith(link);
    await pane.findByText(/Add the JobDeputy browser extension/);
    const auto = autoButton(pane);
    expect(auto.getAttribute('aria-disabled')).toBe('true');
    expect(hintOf(auto)).toMatch(/Add the JobDeputy browser extension/);
    fireEvent.click(auto);
    expect(link.autoApply).not.toHaveBeenCalled();
  });

  it('for a job not on Greenhouse, it is unavailable and says so', async () => {
    const link = fakeLink(READY);
    const { pane } = await renderWith(link, 'https://jobs.lever.co/acme');
    await pane.findByText(/Auto apply fills Greenhouse applications for now/);
    expect(autoButton(pane).getAttribute('aria-disabled')).toBe('true');
  });

  it('already back on the page when the answer comes: Matches read at once', async () => {
    const link = fakeLink(READY, { ok: false, reason: 'no-answer' });
    const { api, pane } = await renderWith(link);
    await pane.findByText(/fills it in with your saved answers/);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const request = vi.spyOn(api, 'request');
    fireEvent.click(autoButton(pane));
    await pane.findByText('Did you apply on the employer site?');
    expect(
      request.mock.calls.filter(([method, path]) => method === 'GET' && path === '/me/matches'),
    ).toHaveLength(1);
  });

  it('an extension too slow to answer: asks whether you applied, and says to finish there', async () => {
    const link = fakeLink(READY, { ok: false, reason: 'no-answer' });
    const { pane } = await renderWith(link);
    await pane.findByText(/fills it in with your saved answers/);
    fireEvent.click(autoButton(pane));
    expect(await pane.findByText('Did you apply on the employer site?')).toBeTruthy();
    expect(pane.getByText(/took too long to answer/)).toBeTruthy();
  });

  it.each([
    ['signed-out', /Sign in to the JobDeputy extension from your browser’s toolbar, then try/],
    ['unreachable', /The extension didn’t answer/],
    ['failed', /couldn’t open this application/],
    ['wrong-job', /couldn’t open this application/],
  ] as const)('says why when the extension answers %s, and asks nothing', async (reason, words) => {
    const link = fakeLink(READY, { ok: false, reason });
    const { pane } = await renderWith(link);
    await pane.findByText(/fills it in with your saved answers/);
    fireEvent.click(autoButton(pane));
    expect(await pane.findByText(words)).toBeTruthy();
    expect(pane.queryByText('Did you apply on the employer site?')).toBeNull();
    // Asked again: the extension's state may have changed.
    expect(link.check.mock.calls.length).toBeGreaterThan(1);
  });
});
