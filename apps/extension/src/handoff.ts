import { greenhousePosting, jobIdFor, type Posting } from './fill/posting.ts';
import type { AutoApplyResponse } from './messages.ts';

/**
 * #54 PR D (decision 0020): Auto apply. The web app hands the extension a job and its Greenhouse
 * form (`auto-apply`); the worker checks the form is that job's, opens it in a new tab itself,
 * and remembers the tab (in `storage.session`, which pages and content scripts can't read). The
 * form's content script then asks once whether its tab was opened so; only then does it fill on
 * its own. It never submits.
 */
export const AUTO_APPLY_KEY = 'autoApply';

/** How long an opened tab waits for its form to ask; past it, the person fills by hand. */
export const AUTO_FILL_WINDOW_MS = 10 * 60_000;

/** Each tab Auto apply opened, by tab ID: the job, and when. */
export type Opened = Record<string, { jobId: string; at: number }>;

export interface HandoffDeps {
  /** Opens the address in a new tab; its ID, or undefined if none opened. */
  openTab: (url: string) => Promise<number | undefined>;
  read: () => Promise<Opened>;
  write: (opened: Opened) => Promise<void>;
  signedIn: () => Promise<boolean>;
  now: () => number;
}

export function createHandoff(deps: HandoffDeps) {
  /**
   * One step at a time: a tab's form may ask before the worker has remembered the tab (it waits
   * for the open), and two steps never write over each other.
   */
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(step: () => Promise<T>): Promise<T> {
    const next = queue.then(step);
    queue = next.catch(() => undefined);
    return next;
  }

  /** Only entries still in their window (the rest are dropped as they're met). */
  const live = (opened: Opened) =>
    Object.fromEntries(
      Object.entries(opened).filter(([, entry]) => deps.now() - entry.at < AUTO_FILL_WINDOW_MS),
    );

  async function open(jobId: string, url: string): Promise<AutoApplyResponse> {
    const posting = greenhousePosting(url);
    if (!posting) return { ok: false, reason: 'not-greenhouse' };
    // The address must be this job's own form: a page can't send the person to another one.
    if ((await jobIdFor(posting)) !== jobId) return { ok: false, reason: 'wrong-job' };
    // Outside the queue: a sign-in may take seconds, and other tabs' steps needn't wait for it.
    if (!(await deps.signedIn())) return { ok: false, reason: 'signed-out' };
    return serial(async () => {
      const tabId = await deps.openTab(url);
      if (tabId === undefined) return { ok: false, reason: 'failed' } as const;
      const opened = live(await deps.read());
      opened[String(tabId)] = { jobId, at: deps.now() };
      await deps.write(opened);
      return { ok: true } as const;
    });
  }

  return {
    autoApply(jobId: string, url: string): Promise<AutoApplyResponse> {
      return open(jobId, url).catch(() => ({ ok: false, reason: 'failed' }) as const);
    },

    /** Chrome swapped the tab (prerender, instant navigation): its entry follows it. */
    replaced(added: number, removed: number): Promise<void> {
      return serial(async () => {
        const opened = await deps.read();
        const entry = opened[String(removed)];
        if (!entry) return;
        delete opened[String(removed)];
        opened[String(added)] = entry;
        await deps.write(opened);
      });
    },

    /**
     * Whether this tab's form should fill on its own: Auto apply opened it for this posting's job.
     * Answered yes once, the first time the form shows in the tab (a first load that failed, then
     * a reload, still fills on its own); after that, a reload or the board's next job is filled by
     * hand.
     */
    autoFill(tabId: number, posting: Posting): Promise<boolean> {
      return serial(async () => {
        const opened = live(await deps.read());
        const entry = opened[String(tabId)];
        if (!entry || entry.jobId !== (await jobIdFor(posting))) return false;
        delete opened[String(tabId)];
        await deps.write(opened);
        return true;
      });
    },

    /** A tab closed: forget it. */
    closed(tabId: number): Promise<void> {
      return serial(async () => {
        const opened = await deps.read();
        if (!(String(tabId) in opened)) return;
        delete opened[String(tabId)];
        await deps.write(opened);
      });
    },
  };
}

export type Handoff = ReturnType<typeof createHandoff>;
