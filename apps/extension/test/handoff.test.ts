import { atsJobKey, jobIdOf } from '@jobdeputy/shared/job-id';
import { describe, expect, it, vi } from 'vitest';
import { AUTO_FILL_WINDOW_MS, createHandoff, type Opened } from '../src/handoff.ts';

const FORM = 'https://job-boards.greenhouse.io/acme/jobs/4001001';
const POSTING = { companyKey: 'greenhouse:acme', postingId: '4001001' };
const OTHER = { companyKey: 'greenhouse:acme', postingId: '4001002' };

async function setup({ signedIn = true, opens = true } = {}) {
  let stored: Opened = {};
  let now = 1_000;
  const openTab = vi.fn(async (_url: string) => (opens ? 7 : undefined));
  const handoff = createHandoff({
    openTab,
    read: async () => structuredClone(stored),
    write: async (opened) => {
      stored = structuredClone(opened);
    },
    signedIn: async () => signedIn,
    now: () => now,
  });
  const jobId = await jobIdOf(atsJobKey('greenhouse:acme', '4001001'));
  return {
    handoff,
    openTab,
    jobId,
    stored: () => stored,
    later: (ms: number) => {
      now += ms;
    },
  };
}

describe('Auto apply (#54 PR D, decision 0020)', () => {
  it("opens the job's own form in a new tab, and that tab's form fills once", async () => {
    const { handoff, openTab, jobId, stored } = await setup();
    expect(await handoff.autoApply(jobId, FORM)).toEqual({ ok: true });
    expect(openTab).toHaveBeenCalledWith(FORM);
    expect(stored()).toEqual({ '7': { jobId, at: 1_000 } });
    // Another tab, or the board's next job in this tab: by hand.
    expect(await handoff.autoFill(8, POSTING)).toBe(false);
    expect(await handoff.autoFill(7, OTHER)).toBe(false);
    expect(await handoff.autoFill(7, POSTING)).toBe(true);
    // Used up: a reload fills by hand.
    expect(await handoff.autoFill(7, POSTING)).toBe(false);
    expect(stored()).toEqual({});
  });

  it('a form that asks before the tab is remembered waits for it', async () => {
    const { handoff, openTab, jobId } = await setup();
    // The new tab's form asks while the worker is still opening it (before it's remembered).
    let asked: Promise<boolean> = Promise.resolve(false);
    openTab.mockImplementationOnce(async () => {
      asked = handoff.autoFill(7, POSTING);
      return 7;
    });
    expect(await handoff.autoApply(jobId, FORM)).toEqual({ ok: true });
    expect(await asked).toBe(true);
  });

  it("refuses an address that isn't this job's Greenhouse form, and opens nothing", async () => {
    const { handoff, openTab, jobId } = await setup();
    for (const url of [
      'https://evil.example/acme/jobs/4001001',
      'http://job-boards.greenhouse.io/acme/jobs/4001001',
      'https://job-boards.greenhouse.io/acme',
      'javascript:alert(1)',
    ]) {
      expect(await handoff.autoApply(jobId, url)).toEqual({ ok: false, reason: 'not-greenhouse' });
    }
    expect(
      await handoff.autoApply(jobId, 'https://job-boards.greenhouse.io/acme/jobs/4001002'),
    ).toEqual({ ok: false, reason: 'wrong-job' });
    expect(openTab).not.toHaveBeenCalled();
  });

  it('signed out, opens nothing; a tab that never opened is a failure', async () => {
    const out = await setup({ signedIn: false });
    expect(await out.handoff.autoApply(out.jobId, FORM)).toEqual({
      ok: false,
      reason: 'signed-out',
    });
    expect(out.openTab).not.toHaveBeenCalled();
    const none = await setup({ opens: false });
    expect(await none.handoff.autoApply(none.jobId, FORM)).toEqual({ ok: false, reason: 'failed' });
  });

  it('follows a tab Chrome swapped for another', async () => {
    const { handoff, jobId } = await setup();
    await handoff.autoApply(jobId, FORM);
    await handoff.replaced(9, 7);
    expect(await handoff.autoFill(7, POSTING)).toBe(false);
    expect(await handoff.autoFill(9, POSTING)).toBe(true);
    await handoff.replaced(10, 99);
  });

  it('forgets a tab once closed, or once its window has passed', async () => {
    const { handoff, jobId, stored, later } = await setup();
    await handoff.autoApply(jobId, FORM);
    await handoff.closed(7);
    expect(stored()).toEqual({});
    await handoff.autoApply(jobId, FORM);
    later(AUTO_FILL_WINDOW_MS);
    expect(await handoff.autoFill(7, POSTING)).toBe(false);
  });
});
