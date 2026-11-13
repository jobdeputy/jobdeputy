import { describe, expect, it, vi } from 'vitest';
import {
  assess,
  checkQueues,
  type HealthState,
  type Observation,
  parseState,
  type QueueHealthDeps,
} from '../src/queue-health.js';

const T0 = new Date('2026-10-01T06:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const crawls = (waiting: number, deadLetters = 0): Observation => ({
  name: 'crawls',
  waiting,
  deadLetters,
  backlogAfterSeconds: 15 * 60,
});

describe('assess', () => {
  it('healthy queues: nothing to say, nothing remembered', () => {
    expect(assess({}, [crawls(0)], T0)).toEqual({ next: {}, changes: [], problems: 0 });
  });

  it('reports dead letters once, then once more when they are gone', () => {
    const first = assess({}, [crawls(0, 2)], T0);
    expect(first.changes).toEqual([
      'crawls: 2 message(s) in the dead-letter queue (work failed after all retries). See docs/runbooks/alarms.md.',
    ]);
    expect(first).toMatchObject({ next: { crawls: { deadLetters: 2 } }, problems: 1 });
    // Still there (even more of them): no repeat.
    const second = assess(first.next, [crawls(0, 5)], at(5));
    expect(second.changes).toEqual([]);
    expect(second.problems).toBe(1);
    const cleared = assess(second.next, [crawls(0, 0)], at(10));
    expect(cleared).toEqual({
      next: {},
      changes: ['crawls: the dead-letter queue is empty again.'],
      problems: 0,
    });
  });

  it('a backlog is reported only after messages waited without a break past the limit', () => {
    let state: HealthState = {};
    for (const minute of [0, 5, 10]) {
      const r = assess(state, [crawls(3)], at(minute));
      expect(r.changes, `minute ${minute}`).toEqual([]);
      state = r.next;
    }
    expect(state.crawls?.waitingSince).toBe(T0.toISOString());
    const late = assess(state, [crawls(1)], at(15));
    expect(late.changes).toEqual([
      'crawls: messages have been waiting for over 15 minutes (worker stuck, throttled, or not running). See docs/runbooks/alarms.md.',
    ]);
    expect(late.problems).toBe(1);
    expect(assess(late.next, [crawls(1)], at(20)).changes).toEqual([]);
    expect(assess(late.next, [crawls(0)], at(20))).toEqual({
      next: {},
      changes: ['crawls: the backlog has cleared.'],
      problems: 0,
    });
  });

  it('a break in the waiting starts the clock again (a busy queue that keeps up is fine)', () => {
    const a = assess({}, [crawls(2)], T0);
    const b = assess(a.next, [crawls(0)], at(10));
    const c = assess(b.next, [crawls(2)], at(14));
    expect(assess(c.next, [crawls(2)], at(20)).changes).toEqual([]);
  });

  it('a queue without a backlog limit is only checked for dead letters', () => {
    const q = { name: 'key-checks', waiting: 9, deadLetters: 0 };
    expect(assess({}, [q], T0).changes).toEqual([]);
    expect(assess(assess({}, [q], T0).next, [q], at(600)).changes).toEqual([]);
  });

  it('several queues and problems at once; queues no longer watched are forgotten', () => {
    const docs = { name: 'documents', waiting: 0, deadLetters: 1 };
    const r = assess({ removed: { deadLetters: 3 } }, [crawls(0, 1), docs], T0);
    expect(r.problems).toBe(2);
    expect(r.changes).toHaveLength(2);
    expect(Object.keys(r.next).sort()).toEqual(['crawls', 'documents']);
  });
});

describe('parseState', () => {
  it('reads the stored state; anything unreadable starts over', () => {
    expect(parseState('{"crawls":{"deadLetters":1}}')).toEqual({ crawls: { deadLetters: 1 } });
    for (const raw of [undefined, '', 'not json', '[1]', '{"crawls":{"deadLetters":-1}}']) {
      expect(parseState(raw), String(raw)).toEqual({});
    }
  });
});

describe('checkQueues', () => {
  /** `stored: null`: the state parameter does not exist. */
  function setup(counts: Record<string, number>, stored: string | null = '{}') {
    let state: string | undefined = stored ?? undefined;
    const deps = {
      queues: [
        {
          name: 'crawls',
          queueUrl: 'https://sqs/q',
          deadLetterUrl: 'https://sqs/q-dlq',
          backlogAfterSeconds: 900,
        },
      ],
      stackName: 'jobdeputy-dev-iad',
      counts: vi.fn(async (url: string) => counts[url] ?? 0),
      readState: vi.fn(async () => state),
      writeState: vi.fn(async (value: string) => {
        state = value;
      }),
      publish: vi.fn(async () => undefined),
      now: () => T0,
    } satisfies QueueHealthDeps;
    return { deps, state: () => state };
  }

  it('emails a change with a short subject, and saves the new state', async () => {
    const { deps, state } = setup({ 'https://sqs/q-dlq': 1 });
    await checkQueues(deps);
    expect(deps.publish).toHaveBeenCalledWith(
      '[jobdeputy-dev-iad] Queue health: 1 queue(s) need attention',
      expect.stringContaining('crawls: 1 message(s) in the dead-letter queue'),
    );
    expect(JSON.parse(state() ?? '')).toEqual({ crawls: { deadLetters: 1 } });

    // The next check: same problem, so no email and no write.
    deps.publish.mockClear();
    deps.writeState.mockClear();
    await checkQueues(deps);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
  });

  it('says when everything is back to normal', async () => {
    const { deps } = setup({}, '{"crawls":{"deadLetters":1}}');
    await checkQueues(deps);
    expect(deps.publish).toHaveBeenCalledWith(
      '[jobdeputy-dev-iad] Queue health: all queues back to normal',
      'crawls: the dead-letter queue is empty again.',
    );
  });

  it('healthy and unchanged: no email, no write', async () => {
    const { deps } = setup({});
    await checkQueues(deps);
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
  });

  it('a missing state is created', async () => {
    const { deps } = setup({}, null);
    await checkQueues(deps);
    expect(deps.writeState).toHaveBeenCalledWith('{}');
  });

  it('a failed email fails the run before the state is saved (so the next check sends it)', async () => {
    const { deps } = setup({ 'https://sqs/q-dlq': 1 });
    deps.publish.mockRejectedValue(new Error('SNS down'));
    await expect(checkQueues(deps)).rejects.toThrow('SNS down');
    expect(deps.writeState).not.toHaveBeenCalled();
  });

  it('a failed queue read fails the run (its own alarm fires)', async () => {
    const { deps } = setup({});
    deps.counts.mockRejectedValue(new Error('AccessDenied'));
    await expect(checkQueues(deps)).rejects.toThrow('AccessDenied');
    expect(deps.publish).not.toHaveBeenCalled();
  });
});
