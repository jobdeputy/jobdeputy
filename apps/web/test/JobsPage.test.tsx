import { RELEVANCE_ERRORS } from '@jobdeputy/shared/ai';
import { CRAWL_ERRORS } from '@jobdeputy/shared/crawl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostOf, JobsPage, withScheme } from '../src/components/jobs/jobs-page.tsx';
import { copy } from '../src/copy/index.ts';
import { ApiError } from '../src/lib/api/client.ts';
import {
  type Crawl,
  crawlName,
  crawlStage,
  isCrawling,
  isStalled,
  LIST_STALLED_MS,
  nextCrawlCheck,
  SCORING_START_MS,
  STALLED_MS,
} from '../src/lib/api/crawls.ts';
import { createFakeApi } from '../src/lib/api/fake.ts';
import { ApiContext } from '../src/lib/api/index.ts';

afterEach(cleanup);

type FakeApi = ReturnType<typeof createFakeApi>;

/** One stage of a fake crawl, on the test's own clock (moved on only by `next`). */
const STAGE = 60_000;

/**
 * A fake API whose crawls move on only when the test says (`next()`: one stage), never by the
 * real clock, so no test races it. Stages: queued, reading, read, scoring, done.
 */
function heldApi() {
  let t = Date.now();
  const api = createFakeApi({ delay: 0, crawlMs: STAGE, now: () => t });
  return Object.assign(api, {
    next(stages = 1) {
      t += stages * STAGE;
    },
  });
}

/** The page on `api`, following the newest crawl every 20 ms. */
async function renderPage(api: FakeApi = heldApi()) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queries, 'invalidateQueries');
  render(
    <QueryClientProvider client={queries}>
      <ApiContext.Provider value={api}>
        <JobsPage checkEvery={20} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'The best jobs at each company.' });
  return { api, queries, invalidate };
}

const input = () => screen.getByRole('textbox', { name: 'Careers page link' }) as HTMLInputElement;
const findJobs = () => fireEvent.click(screen.getByRole('button', { name: 'Find jobs' }));
function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}
/** The field's error (tied to the input), or null. */
function fieldError(): string | null {
  const ids = input().getAttribute('aria-describedby') ?? '';
  return (
    ids
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((el) => el?.className.includes('danger'))?.textContent ?? null
  );
}
/** What the form says under its buttons (an alert), or ''. */
const notice = () => screen.getAllByRole('alert')[0]?.textContent ?? '';
const posts = (request: { mock: { calls: unknown[][] } }) =>
  request.mock.calls.filter(([method]) => method === 'POST');

describe('Job matches: Find jobs (#49)', () => {
  it('asks for a link, and catches a link the API would refuse, without sending it', async () => {
    const { api } = await renderPage();
    const request = vi.spyOn(api, 'request');
    findJobs();
    expect(fieldError()).toBe('Paste a link to a careers page.');
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute('aria-invalid')).toBe('true');

    type('not a link');
    expect(fieldError()).toBeNull();
    findJobs();
    expect(fieldError()).toBe('This is not a web address your deputy can read.');
    type('linkedin.com/jobs/view/1');
    findJobs();
    expect(fieldError()).toBe('This page needs a sign-in. Your deputy only reads public pages.');
    type('http://localhost/jobs');
    findJobs();
    expect(fieldError()).toBe(
      'This address points to a private or internal network, which your deputy never reads.',
    );
    expect(posts(request)).toEqual([]);
  });

  it('sends a link (adding https://), follows the deputy through each stage, and says how it went', async () => {
    const api = heldApi();
    await renderPage(api);
    const request = vi.spyOn(api, 'request');
    type('  boards.greenhouse.io/acme ');
    findJobs();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/me/crawls', {
        url: 'https://boards.greenhouse.io/acme',
      }),
    );
    // The field is cleared for the next link.
    await waitFor(() => expect(input().value).toBe(''));
    // Held at its first stage: the deputy shows (after 300 ms, as every wait) and says what he does.
    expect(await screen.findByText('Finding jobs', {}, { timeout: 2000 })).toBeTruthy();
    expect(
      await screen.findByText(
        'Waiting for my turn to read boards.greenhouse.io…',
        {},
        { timeout: 2000 },
      ),
    ).toBeTruthy();
    api.next();
    expect(await screen.findByText('Reading boards.greenhouse.io…')).toBeTruthy();
    // Read: the AI's scoring starts in its own step, and the page waits for it.
    api.next();
    expect(
      await screen.findByText('Scoring the jobs at boards.greenhouse.io against your roles…'),
    ).toBeTruthy();
    api.next();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/^Done with/)).toBeNull();
    api.next();
    const done = await screen.findByText(
      'Done with boards.greenhouse.io: 12 jobs read.',
      {},
      { timeout: 3000 },
    );
    expect(done.closest('[role="status"]')).toBeTruthy();
  });

  it('says why a link could not be read', async () => {
    const api = heldApi();
    await renderPage(api);
    type('https://unreachable.example.com/careers');
    findJobs();
    await waitFor(() => expect(input().value).toBe(''));
    api.next(2);
    expect(
      await screen.findByText(
        'Couldn’t read unreachable.example.com. The site couldn’t be reached.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Check the link, or try another page.')).toBeTruthy();
  });

  it('leaves links at work to the API: one it turns away is said under the buttons', async () => {
    const api = heldApi();
    await api.request('POST', '/me/crawls', { url: 'https://still-crawling.example.com/jobs' });
    const { invalidate } = await renderPage(api);
    expect(
      await screen.findByText('Reading still-crawling.example.com…', {}, { timeout: 2000 }),
    ).toBeTruthy();
    const request = vi.spyOn(api, 'request');
    type('boards.greenhouse.io/acme');
    findJobs();
    await waitFor(() =>
      expect(notice()).toBe(
        'Your deputy is already reading a link. Paste the next one when it’s done.',
      ),
    );
    // Sent: the API decides (its limit can be more than one).
    expect(posts(request)).toHaveLength(1);
    expect(fieldError()).toBeNull();
    expect(input().getAttribute('aria-invalid')).toBeNull();
    // A link at work the page may not know of (another tab): it reads the newest again.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crawls', 'latest'] });
    expect(input().value).toBe('boards.greenhouse.io/acme');
  });

  it.each([
    [
      new ApiError('too-many', { status: 429, code: 'daily-limit-reached' }),
      'You’ve used today’s links. More from midnight UTC.',
    ],
    [new ApiError('offline'), 'That didn’t go through. Try again in a moment.'],
    [new ApiError('server', { status: 500 }), 'That didn’t go through. Try again in a moment.'],
    [new ApiError('unsure'), 'That didn’t go through. Try again in a moment.'],
  ])('says why the API turned it away, under the buttons: %s', async (failure, said) => {
    const { api } = await renderPage();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'POST') throw failure;
      return request(method, path, body);
    });
    type('boards.greenhouse.io/acme');
    findJobs();
    await waitFor(() => expect(notice()).toBe(said));
    expect(fieldError()).toBeNull();
    // What was typed stays, to send again.
    expect(input().value).toBe('boards.greenhouse.io/acme');
  });

  it.each([
    [
      new ApiError('invalid', { status: 400, code: 'blocked_by_robots', message: 'API words' }),
      'The site asks automated visitors not to read this page.',
    ],
    [
      new ApiError('invalid', { status: 400 }),
      'That link can’t be read. Check it, or try another page.',
    ],
  ])('says why the API refused the address, beside the field: %s', async (failure, said) => {
    const { api } = await renderPage();
    const request = api.request.bind(api);
    vi.spyOn(api, 'request').mockImplementation(async (method, path, body) => {
      if (method === 'POST') throw failure;
      return request(method, path, body);
    });
    type('boards.greenhouse.io/acme');
    findJobs();
    await waitFor(() => expect(fieldError()).toBe(said));
    expect(document.activeElement).toBe(input());
  });
});

describe('Job matches: when the free AI runs are used up (#49)', () => {
  it('offers to rank the same link by keywords', async () => {
    const { api } = await renderPage();
    const request = vi.spyOn(api, 'request');
    const url = 'https://ai-limit.example.com/careers';
    type(url);
    findJobs();
    await waitFor(() =>
      expect(notice()).toBe(
        'You’ve used your free AI scoring for now. Your deputy can still rank this link by keywords.',
      ),
    );
    expect(input().getAttribute('aria-invalid')).toBeNull();
    const keywords = screen.getByRole('button', { name: 'Find jobs without AI scores' });
    keywords.focus();
    fireEvent.click(keywords);
    // The button stays while its link is on its way (it holds the focus).
    expect(screen.getByRole('button', { name: 'Find jobs without AI scores' })).toBe(keywords);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/me/crawls', { url, aiSource: 'none' }),
    );
    await waitFor(() => expect(input().value).toBe(''));
    expect(screen.queryByRole('button', { name: 'Find jobs without AI scores' })).toBeNull();
    // The focus goes on to the field, not lost with the button.
    expect(document.activeElement).toBe(input());
  });

  it('drops the offer when the link changes (it was for that link)', async () => {
    await renderPage();
    type('ai-limit.example.com/careers');
    findJobs();
    await screen.findByRole('button', { name: 'Find jobs without AI scores' });
    type('ai-limit.example.com/other');
    expect(screen.queryByRole('button', { name: 'Find jobs without AI scores' })).toBeNull();
    expect(notice()).toBe('');
  });
});

describe('Job matches: following the newest link (#49)', () => {
  it('says when the newest link could not be checked on, and checks again', async () => {
    const api = heldApi();
    const request = api.request.bind(api);
    const spy = vi.spyOn(api, 'request').mockRejectedValue(new ApiError('server', { status: 500 }));
    await renderPage(api);
    expect(await screen.findByText('Couldn’t check on your last link.')).toBeTruthy();
    spy.mockImplementation(request);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByText('Couldn’t check on your last link.')).toBeNull());
  });

  it('says a crawl stalled rather than done, and draws that when its time runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'Date'] });
    try {
      const api = heldApi();
      await api.request('POST', '/me/crawls', { url: 'https://still-crawling.example.com/jobs' });
      await renderPage(api);
      await screen.findByText('Reading still-crawling.example.com…', {}, { timeout: 2000 });
      // 15 minutes on (the page's own clock): no new answer, yet the page moves on by itself.
      await vi.advanceTimersByTimeAsync(STALLED_MS + STAGE);
      expect(
        await screen.findByText(
          'Your deputy couldn’t finish still-crawling.example.com. Send the link again to start over.',
        ),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Job matches: your companies under the link (#49 PR C)', () => {
  /** Counts the companies list's reads from now on. */
  function companyReads(api: FakeApi) {
    const request = vi.spyOn(api, 'request');
    return () => request.mock.calls.filter(([, path]) => String(path).startsWith('/me/companies'));
  }

  it('reads the companies once the newest crawl is known, and again only when its work ends', async () => {
    const api = heldApi();
    const reads = companyReads(api);
    await renderPage(api);
    expect(await screen.findByText('No matches yet')).toBeTruthy();
    expect(reads()).toHaveLength(1);
    type('boards.greenhouse.io/acme');
    findJobs();
    await waitFor(() => expect(input().value).toBe(''));
    api.next(3);
    // Read, and its scoring under way: the list is not read again yet.
    await screen.findByText(
      'Scoring the jobs at boards.greenhouse.io against your roles…',
      {},
      { timeout: 2000 },
    );
    expect(reads()).toHaveLength(1);
    api.next();
    expect(await screen.findByRole('article', { name: 'Acme' }, { timeout: 3000 })).toBeTruthy();
    expect(reads()).toHaveLength(2);
  });

  it('reads them again for a crawl that ended in another tab, but not for one ended before', async () => {
    const api = heldApi();
    await api.request('POST', '/me/crawls', { url: 'https://boards.greenhouse.io/acme' });
    api.next(4);
    const reads = companyReads(api);
    await renderPage(api);
    expect(await screen.findByRole('article', { name: 'Acme' })).toBeTruthy();
    expect(reads()).toHaveLength(1);
    // Another tab sends a link and it ends; back here, the newest crawl is read on focus.
    await api.request('POST', '/me/crawls', { url: 'https://jobs.lever.co/globex' });
    api.next(4);
    fireEvent.focus(window);
    window.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByRole('article', { name: 'Globex' }, { timeout: 3000 })).toBeTruthy();
    expect(reads()).toHaveLength(2);
    // The list stayed on screen while it was read again (no skeleton in between).
    expect(screen.getByRole('article', { name: 'Acme' })).toBeTruthy();
  });

  it('does not read them again for a link that failed (it changed nothing)', async () => {
    const api = heldApi();
    const reads = companyReads(api);
    await renderPage(api);
    await screen.findByText('No matches yet');
    type('unreachable.example.com/careers');
    findJobs();
    await waitFor(() => expect(input().value).toBe(''));
    api.next(2);
    await screen.findByText(/^Couldn’t read unreachable\.example\.com\./);
    expect(reads()).toHaveLength(1);
  });
});

describe('Job matches: a GitHub list (#50)', () => {
  const LIST = 'github.com/SimplifyJobs/New-Grad-Positions/tree/dev';

  it('reads the list, then its companies with a bar of how many are read, and says how it went', async () => {
    const api = heldApi();
    await renderPage(api);
    const request = vi.spyOn(api, 'request');
    type(LIST);
    findJobs();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/me/crawls', { url: `https://${LIST}` }),
    );
    expect(
      await screen.findByText(
        'Waiting for my turn to read SimplifyJobs/New-Grad-Positions…',
        {},
        { timeout: 2000 },
      ),
    ).toBeTruthy();
    api.next();
    expect(
      await screen.findByText(
        'Reading the list SimplifyJobs/New-Grad-Positions and choosing the companies that fit you…',
      ),
    ).toBeTruthy();
    api.next(2);
    expect(
      await screen.findByText('Reading the companies from SimplifyJobs/New-Grad-Positions…'),
    ).toBeTruthy();
    const bar = await screen.findByRole('progressbar', { name: '1 of 5 companies read' });
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
    // The companies come in as they are read.
    expect(await screen.findByRole('article', { name: 'Acme' }, { timeout: 3000 })).toBeTruthy();
    api.next(4);
    // Read: its one AI run scores them all, then it is done.
    expect(
      await screen.findByText(
        'Scoring the jobs at SimplifyJobs/New-Grad-Positions against your roles…',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    api.next(2);
    const done = await screen.findByText(
      'Done with SimplifyJobs/New-Grad-Positions: 46 jobs read at 4 companies.',
      {},
      { timeout: 3000 },
    );
    expect(done.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText('3 companies skipped: their sites can’t be read yet.')).toBeTruthy();
    expect(screen.getByText('1 company couldn’t be read.')).toBeTruthy();
    expect(await screen.findByRole('article', { name: 'Umbrella' })).toBeTruthy();
  });

  it('says when a list fits none of the roles, or none of its sites can be read', async () => {
    for (const [repo, words] of [
      ['acme/nothing-fits', 'Done with acme/nothing-fits: none of its roles fit your roles.'],
      [
        'acme/unreadable',
        'Done with acme/unreadable: none of its companies’ sites can be read yet.',
      ],
    ] as const) {
      const api = heldApi();
      await renderPage(api);
      type(`github.com/${repo}`);
      findJobs();
      await waitFor(() => expect(input().value).toBe(''));
      api.next(2);
      expect(await screen.findByText(words, {}, { timeout: 3000 })).toBeTruthy();
      expect(screen.queryByText(/skipped/)).toBeNull();
      cleanup();
    }
  });

  it('says why a repository could not be read as a list', async () => {
    const api = heldApi();
    await renderPage(api);
    type('github.com/acme/not-a-list');
    findJobs();
    await waitFor(() => expect(input().value).toBe(''));
    api.next(2);
    expect(
      await screen.findByText(
        'Couldn’t read acme/not-a-list. Your deputy couldn’t find a list of open roles in this repository.',
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
  });

  it('says when the day’s lists are used, or lists are off, under the buttons', async () => {
    await renderPage();
    type('github.com/acme/list-limit');
    findJobs();
    await waitFor(() =>
      expect(notice()).toBe(
        'You’ve used today’s lists. More from midnight UTC; company links still work.',
      ),
    );
    expect(fieldError()).toBeNull();
    type('github.com/acme/lists-off');
    findJobs();
    await waitFor(() =>
      expect(notice()).toBe(
        'Lists can’t be read right now. Paste a company’s careers link instead.',
      ),
    );
  });
});

describe('the page’s words for every reason the API gives', () => {
  it('has one for every link and scoring reason', () => {
    expect(Object.keys(copy.jobsPage.linkErrors).sort()).toEqual(Object.keys(CRAWL_ERRORS).sort());
    expect(Object.keys(copy.jobsPage.scoringErrors).sort()).toEqual(
      Object.keys(RELEVANCE_ERRORS).sort(),
    );
  });
});

describe('crawl helpers', () => {
  const T0 = '2026-11-21T00:00:00.000Z';
  const at = (minutes: number) => Date.parse(T0) + minutes * 60_000;
  const crawl = (over: Partial<Crawl>): Crawl => ({
    crawlId: 'c',
    url: 'https://x.example.com',
    status: 'queued',
    createdAt: T0,
    ...over,
  });

  it('counts a crawl as at work while queued or reading, for 15 minutes at most', () => {
    expect(isCrawling(crawl({ status: 'queued' }), at(1))).toBe(true);
    expect(isCrawling(crawl({ status: 'running', startedAt: T0 }), at(14))).toBe(true);
    const stuck = crawl({ status: 'running', startedAt: T0 });
    expect(isCrawling(stuck, at(16))).toBe(false);
    expect(isStalled(stuck, at(16))).toBe(true);
    expect(isCrawling(crawl({ status: 'failed' }), at(1))).toBe(false);
    expect(isStalled(crawl({ status: 'failed' }), at(99))).toBe(false);
    expect(crawlStage(crawl({ status: 'queued' }))).toBe('waiting');
    expect(crawlStage(crawl({ status: 'running' }))).toBe('reading');
    expect(crawlStage(crawl({ status: 'succeeded' }))).toBe('scoring');
  });

  it('#50: follows a list through its stages, stalled only once it stops moving on for an hour', () => {
    const list = (over: Partial<Crawl>) => crawl({ kind: 'list', status: 'running', ...over });
    const chosen = {
      companies: [{ name: 'Acme', url: 'https://jobs.lever.co/acme' }],
      skipped: 0,
      busy: 0,
      waiting: 0,
      running: 1,
      ended: 0,
    };
    expect(crawlStage(list({ status: 'queued' }))).toBe('waiting');
    expect(crawlStage(list({}))).toBe('readingList');
    expect(crawlStage(list({ list: { ...chosen, crawlIds: [] } }))).toBe('companies');
    expect(crawlStage(list({ status: 'succeeded' }))).toBe('scoring');
    // Reading the list: as a crawl.
    expect(isStalled(list({ startedAt: T0 }), at(16))).toBe(true);
    // Its companies at work: from when it last moved on, for an hour.
    const moving = list({
      startedAt: T0,
      updatedAt: new Date(at(30)).toISOString(),
      list: { ...chosen, crawlIds: ['k1'] },
    });
    expect(isCrawling(moving, at(30) + LIST_STALLED_MS - 1)).toBe(true);
    expect(isStalled(moving, at(30) + LIST_STALLED_MS)).toBe(true);
  });

  it('#50: names a list by its repository, and a site by its host', () => {
    expect(
      crawlName({ kind: 'list', url: 'https://github.com/SimplifyJobs/New-Grad-Positions' }),
    ).toBe('SimplifyJobs/New-Grad-Positions');
    expect(crawlName({ url: 'https://www.acme.com/jobs' })).toBe('acme.com');
    expect(crawlName({ kind: 'list', url: 'not a url' })).toBe('not a url');
  });

  it('waits for the AI scoring that starts after the crawl, within limits', () => {
    const read = (over: Partial<Crawl>) =>
      crawl({
        status: 'succeeded',
        aiSource: 'platform',
        stats: { jobsFound: 5, jobsRelevant: 2 },
        finishedAt: T0,
        ...over,
      });
    expect(isCrawling(read({}), at(1))).toBe(true);
    expect(isCrawling(read({ aiSource: 'none' }), at(1))).toBe(false);
    expect(isCrawling(read({ stats: { jobsFound: 5, jobsRelevant: 0 } }), at(1))).toBe(false);
    expect(isCrawling(read({ relevance: { status: 'done' } }), at(1))).toBe(false);
    expect(isCrawling(read({ relevance: { status: 'failed' } }), at(1))).toBe(false);
    // A scoring never started is not waited on forever, and is not a stall: the jobs are there.
    expect(isCrawling(read({}), at(0) + SCORING_START_MS + 1)).toBe(false);
    expect(isStalled(read({}), at(0) + SCORING_START_MS + 1)).toBe(false);
    // A scoring that stops moving is a stall.
    expect(isCrawling(read({ relevance: { status: 'running' } }), at(14))).toBe(true);
    expect(isStalled(read({ relevance: { status: 'running' } }), at(16))).toBe(true);
  });

  it('asks again only while at work, and never once signed out', () => {
    const now = crawl({ createdAt: new Date().toISOString() });
    expect(nextCrawlCheck({ data: now, error: null }, 5)).toBe(5);
    expect(nextCrawlCheck({ data: crawl({ status: 'failed' }), error: null }, 5)).toBe(false);
    expect(nextCrawlCheck({ data: null, error: null }, 5)).toBe(false);
    expect(nextCrawlCheck({ data: now, error: new ApiError('signed-out') }, 5)).toBe(false);
    // A failed read keeps asking (the last answer stays on screen).
    expect(nextCrawlCheck({ data: now, error: new ApiError('offline') }, 5)).toBe(5);
  });

  it('adds https:// only when a link has no scheme, and names a site without www.', () => {
    expect(withScheme('acme.com/jobs')).toBe('https://acme.com/jobs');
    expect(withScheme('http://acme.com')).toBe('http://acme.com');
    expect(withScheme('HTTPS://acme.com')).toBe('HTTPS://acme.com');
    expect(withScheme('ftp://acme.com')).toBe('ftp://acme.com');
    expect(hostOf('https://www.acme.com/jobs')).toBe('acme.com');
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('how a link went, in words', () => {
  /** A fake whose newest crawl is this one, finished. */
  function finished(over: Partial<Crawl>) {
    const fake = createFakeApi({ delay: 0 });
    vi.spyOn(fake, 'request').mockResolvedValue({
      crawls: [
        {
          crawlId: 'c',
          url: 'https://acme.example.com/jobs',
          status: 'succeeded',
          aiSource: 'none',
          createdAt: '2026-11-21T00:00:00.000Z',
          finishedAt: '2026-11-21T00:00:00.000Z',
          ...over,
        },
      ],
    } as never);
    return fake;
  }

  it.each([
    [{ stats: { jobsFound: 1, jobsRelevant: 1 } }, 'Done with acme.example.com: 1 job read.'],
    [{ stats: { jobsFound: 7, jobsRelevant: 2 } }, 'Done with acme.example.com: 7 jobs read.'],
    [{ stats: { jobsFound: 0 } }, 'Done with acme.example.com: no jobs on that page.'],
    [
      { stats: { jobsFound: 4, jobsRelevant: 0 } },
      'Done with acme.example.com: no jobs there fit your roles.',
    ],
  ])('%j', async (over, said) => {
    await renderPage(finished(over));
    expect(await screen.findByText(said)).toBeTruthy();
  });

  it('says why the AI did not score them', async () => {
    await renderPage(
      finished({
        stats: { jobsFound: 4, jobsRelevant: 2 },
        aiSource: 'platform',
        relevance: { status: 'failed', error: { code: 'key_invalid', message: 'x' } },
      }),
    );
    expect(
      await screen.findByText(
        'Your deputy ranked them without AI: Its AI key doesn’t work, so the jobs weren’t scored.',
      ),
    ).toBeTruthy();
  });
});
