import { describe, expect, it } from 'vitest';
import { applyCompanyLimit, compareRank, type RankedJob } from '../src/relevance/company-limit.js';

const j = (jobId: string, p = 50, t?: string): RankedJob => ({ jobId, p, ...(t ? { t } : {}) });

describe('compareRank', () => {
  it('orders by role priority, then newest posting (unknown last), then ID', () => {
    const jobs = [
      j('e', 50),
      j('d', 50, '2026-09-01'),
      j('c', 90),
      j('b', 50, '2026-09-20'),
      j('a', 50),
    ];
    expect(jobs.sort(compareRank).map((x) => x.jobId)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });
});

describe('compareRank with scores (T08d)', () => {
  it('scored jobs first by score, then unscored ones by priority', () => {
    const jobs: RankedJob[] = [
      { jobId: 'unscored-top', p: 100 },
      { jobId: 'scored-low', p: 10, s: 31 },
      { jobId: 'scored-high', p: 10, s: 90 },
      { jobId: 'scored-tie', p: 50, s: 90 },
    ];
    expect([...jobs].sort(compareRank).map((j) => j.jobId)).toEqual([
      'scored-tie',
      'scored-high',
      'scored-low',
      'unscored-top',
    ]);
  });

  it('keeps the score in the shown list, so later crawls rank against it', () => {
    const result = applyCompanyLimit(
      { old: { p: 99 } },
      new Set(['a']),
      [{ jobId: 'a', p: 10, s: 40 }],
      1,
    );
    expect(result.shown).toEqual({ a: { p: 10, s: 40 } });
    expect(result.pushedOut).toEqual(['old']);
  });
});

describe('applyCompanyLimit', () => {
  it('shows the best candidates up to the limit and hides the rest', () => {
    const result = applyCompanyLimit(
      {},
      new Set(['a', 'b', 'c', 'x']),
      [j('a', 10), j('b', 90), j('c', 50)],
      2,
    );
    expect(result).toEqual({
      shown: { b: { p: 90 }, c: { p: 50 } },
      counted: ['b', 'c'],
      overLimit: ['a'],
      pushedOut: [],
    });
  });

  it('jobs other pages listed keep competing; a better one pushes them out', () => {
    const previous = { old1: { p: 50, t: '2026-09-01' }, old2: { p: 30 } };
    const result = applyCompanyLimit(previous, new Set(['n']), [j('n', 50, '2026-09-25')], 2);
    expect(result.shown).toEqual({
      n: { p: 50, t: '2026-09-25' },
      old1: { p: 50, t: '2026-09-01' },
    });
    expect(result.counted).toEqual(['n']);
    expect(result.pushedOut).toEqual(['old2']);
  });

  it('a job this crawl read and dropped leaves the list, freeing its place', () => {
    const previous = { gone: { p: 90 }, kept: { p: 10 } };
    const result = applyCompanyLimit(previous, new Set(['gone', 'new']), [j('new', 20)], 2);
    expect(result.shown).toEqual({ new: { p: 20 }, kept: { p: 10 } });
    expect(result.pushedOut).toEqual([]);
  });

  it('ranks the same job again with what this crawl read (it is not counted twice)', () => {
    const result = applyCompanyLimit({ a: { p: 10 } }, new Set(['a']), [j('a', 90)], 1);
    expect(result).toMatchObject({ shown: { a: { p: 90 } }, counted: ['a'], overLimit: [] });
  });

  it('a lower limit trims what was shown; nothing read means nothing changes', () => {
    const previous = { a: { p: 90 }, b: { p: 50 }, c: { p: 10 } };
    const lower = applyCompanyLimit(previous, new Set(), [], 1);
    expect(lower.shown).toEqual({ a: { p: 90 } });
    expect(lower.pushedOut).toEqual(['b', 'c']);
    expect(applyCompanyLimit(previous, new Set(), [], 3).shown).toEqual(previous);
  });
});
