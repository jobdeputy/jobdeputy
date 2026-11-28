import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionLink } from '../src/lib/extension.ts';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Chrome's runtime as a page sees it: `answers` by extension ID (missing: not installed). */
function stubChrome(answers: Record<string, (message: { type: string }) => unknown>) {
  const runtime = {
    lastError: undefined as unknown,
    sendMessage: vi.fn((id: string, message: { type: string }, callback: (r: unknown) => void) => {
      const answer = answers[id];
      if (!answer) {
        runtime.lastError = { message: 'Could not establish connection.' };
        callback(undefined);
        runtime.lastError = undefined;
        return;
      }
      callback(answer(message));
    }),
  };
  vi.stubGlobal('chrome', { runtime });
  return runtime;
}

describe('the extension, as the page reaches it (#54 PR D3)', () => {
  it('says unsupported where the site trusts no extension, and asks none', async () => {
    const runtime = stubChrome({});
    expect(await createExtensionLink(async () => []).check()).toEqual({ state: 'unsupported' });
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('says missing when no trusted ID answers, or Chrome offers the page no runtime', async () => {
    stubChrome({});
    expect(await createExtensionLink(async () => [A]).check()).toEqual({ state: 'missing' });
    vi.stubGlobal('chrome', undefined);
    expect(await createExtensionLink(async () => [A]).check()).toEqual({ state: 'missing' });
  });

  it('finds the trusted ID that answers, and hands jobs to that one', async () => {
    const runtime = stubChrome({
      [B]: (message) =>
        message.type === 'hello' ? { version: '1.2.0', signedIn: true } : { ok: true },
    });
    const link = createExtensionLink(async () => [A, B]);
    expect(await link.check()).toEqual({ state: 'ready', version: '1.2.0', signedIn: true });
    expect(
      await link.autoApply('j'.repeat(32), 'https://job-boards.greenhouse.io/x/jobs/1'),
    ).toEqual({ ok: true });
    expect(runtime.sendMessage).toHaveBeenLastCalledWith(
      B,
      {
        type: 'auto-apply',
        jobId: 'j'.repeat(32),
        url: 'https://job-boards.greenhouse.io/x/jobs/1',
      },
      expect.any(Function),
    );
  });

  it('trusts only answers of the right shape', async () => {
    stubChrome({ [A]: (message) => (message.type === 'hello' ? { version: 1 } : { ok: 'yes' }) });
    const link = createExtensionLink(async () => [A]);
    expect(await link.check()).toEqual({ state: 'missing' });
    stubChrome({
      [A]: (message) =>
        message.type === 'hello' ? { version: '1', signedIn: false } : { ok: false, reason: 'x' },
    });
    // Reached, but no answer it understands: as no answer (never sent again).
    expect(await link.autoApply('j', 'u')).toEqual({ ok: false, reason: 'no-answer' });
  });

  it('when the extension that answered is gone, looks again and uses the one that answers', async () => {
    const answers: Record<string, (message: { type: string }) => unknown> = {
      [A]: (message) =>
        message.type === 'hello' ? { version: '1', signedIn: true } : { ok: true },
    };
    const runtime = stubChrome(answers);
    const link = createExtensionLink(async () => [A, B]);
    await link.check();
    delete answers[A];
    answers[B] = (message) =>
      message.type === 'hello' ? { version: '2', signedIn: true } : { ok: true };
    expect(await link.autoApply('j', 'u')).toEqual({ ok: true });
    expect(runtime.sendMessage).toHaveBeenLastCalledWith(
      B,
      { type: 'auto-apply', jobId: 'j', url: 'u' },
      expect.any(Function),
    );
  });

  it('an extension reached but silent is never sent the job again: it may have opened the form', async () => {
    vi.useFakeTimers();
    try {
      const runtime = {
        lastError: undefined,
        sendMessage: vi.fn(
          (_id: string, message: { type: string }, callback: (r: unknown) => void) => {
            // Says hello; then takes the job and never answers.
            if (message.type === 'hello') callback({ version: '1', signedIn: true });
          },
        ),
      };
      vi.stubGlobal('chrome', { runtime });
      const link = createExtensionLink(async () => [A]);
      await link.check();
      const applying = link.autoApply('j', 'u');
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await applying).toEqual({ ok: false, reason: 'no-answer' });
      const sends = runtime.sendMessage.mock.calls.filter(([, m]) => m.type === 'auto-apply');
      expect(sends).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a reply port closed after the extension was reached is no answer: never sent again', async () => {
    const runtime = {
      lastError: undefined as { message: string } | undefined,
      sendMessage: vi.fn(
        (_id: string, message: { type: string }, callback: (r: unknown) => void) => {
          if (message.type === 'hello') return callback({ version: '1', signedIn: true });
          runtime.lastError = {
            message: 'The message port closed before a response was received.',
          };
          callback(undefined);
          runtime.lastError = undefined;
        },
      ),
    };
    vi.stubGlobal('chrome', { runtime });
    const link = createExtensionLink(async () => [A]);
    await link.check();
    expect(await link.autoApply('j', 'u')).toEqual({ ok: false, reason: 'no-answer' });
    expect(runtime.sendMessage.mock.calls.filter(([, m]) => m.type === 'auto-apply')).toHaveLength(
      1,
    );
  });

  it('none reachable: unreachable, and nothing opened', async () => {
    stubChrome({});
    expect(await createExtensionLink(async () => [A]).autoApply('j', 'u')).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it("a failed config read is not 'none trusted': the check fails, to be asked again", async () => {
    stubChrome({});
    await expect(
      createExtensionLink(async () => Promise.reject(new Error('offline'))).check(),
    ).rejects.toThrow('offline');
  });

  it('an empty reply (the extension closed it) is no answer, not a refusal', async () => {
    stubChrome({
      [A]: (message) => (message.type === 'hello' ? { version: '1', signedIn: true } : undefined),
    });
    const link = createExtensionLink(async () => [A]);
    await link.check();
    expect(await link.autoApply('j', 'u')).toEqual({ ok: false, reason: 'no-answer' });
  });

  it('an extension that never answers counts as none', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
      const checking = createExtensionLink(async () => [A]).check();
      await vi.advanceTimersByTimeAsync(3500);
      expect(await checking).toEqual({ state: 'missing' });
    } finally {
      vi.useRealTimers();
    }
  });
});
