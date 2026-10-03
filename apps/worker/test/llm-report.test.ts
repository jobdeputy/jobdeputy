import type { ResultField } from '@aws-sdk/client-cloudwatch-logs';
import { describe, expect, it, vi } from 'vitest';
import {
  assessDay,
  checkGroup,
  GROUPS_QUERY,
  type LatencyBaselines,
  type LlmReportDeps,
  REPORT_WINDOW_MS,
  type ReportGroup,
  runReport,
  SCORED_QUERY,
  toGroup,
} from '../src/llm-report.js';

const NOW = new Date('2026-10-02T03:30:00Z');
const MODEL = 'mistral.ministral-3-14b-instruct';
const baselines: LatencyBaselines = { 'relevance@v2': { modelId: MODEL, medianMs: 3000 } };

/** A healthy day: every share inside its limit. */
const healthy: ReportGroup = {
  task: 'relevance',
  promptVersion: 'relevance@v2',
  modelId: MODEL,
  keySource: 'platform',
  provider: 'bedrock',
  taskCalls: 100,
  modelCalls: 110,
  rejected: 5,
  partial: 5,
  timeouts: 1,
  jobs: 1000,
  grounding: 20,
  lowScore: 400,
  p95Ms: 6000,
  medianSpread: 20,
};

const row = (g: Partial<ReportGroup>): ResultField[] =>
  Object.entries({ ...healthy, ...g }).map(([field, value]) => ({ field, value: `${value}` }));

describe('checkGroup', () => {
  it('a day at every limit, but not over: nothing to say', () => {
    expect(checkGroup(healthy, baselines)).toEqual([]);
  });

  it('reports each limit crossed', () => {
    const problems = checkGroup(
      {
        ...healthy,
        rejected: 6,
        partial: 6,
        timeouts: 2,
        grounding: 21,
        p95Ms: 6001,
        medianSpread: 19,
        lowScore: 801,
      },
      baselines,
    );
    expect(problems.map((p) => p.split(':')[0])).toEqual([
      'rejected outputs',
      'partial results',
      'timeouts',
      'grounding rejections per job',
      'latency p95',
      'median score spread',
      'hidden by a low score',
    ]);
    expect(problems[0]).toBe('rejected outputs: 5.5% (6 of 110; limit 5%)');
  });

  it('too few jobs hidden by a low score is a problem too', () => {
    expect(checkGroup({ ...healthy, lowScore: 99 }, baselines)).toEqual([
      'hidden by a low score: 9.9% of jobs (99 of 1000; expected 10%–80%)',
    ]);
  });

  it('latency only against the baseline of the same prompt version and model, platform only', () => {
    const slow = { ...healthy, p95Ms: 60_000 };
    expect(checkGroup(slow, baselines)).toHaveLength(1);
    expect(checkGroup({ ...slow, keySource: 'own', modelId: 'own:openai' }, baselines)).toEqual([]);
    expect(checkGroup({ ...slow, promptVersion: 'relevance@v3' }, baselines)).toEqual([]);
    expect(checkGroup({ ...slow, modelId: 'other' }, baselines)).toEqual([]);
  });

  it('missing measures are not judged', () => {
    const { p95Ms: _, medianSpread: __, ...rest } = healthy;
    expect(checkGroup({ ...rest, jobs: 0, modelCalls: 0 }, baselines)).toEqual([]);
  });
});

describe('assessDay', () => {
  it('skips groups under 20 task calls, and never judges the stub model', () => {
    const report = assessDay(
      [
        row({ taskCalls: 19, rejected: 19 }),
        row({ provider: 'stub', modelId: 'stub', rejected: 100 }),
        row({}),
      ],
      0,
      baselines,
    );
    expect(report).toEqual({ lines: [], checked: 1, skipped: 1 });
  });

  it('names the group and its problems', () => {
    const report = assessDay([row({ timeouts: 5 })], 0, baselines);
    expect(report.lines).toEqual([
      `relevance relevance@v2 on ${MODEL} (platform, 100 task calls):`,
      '  - timeouts: 5% (5 of 100; limit 1%)',
    ]);
  });

  it('jobs scored but no LLM log lines: the report is blind and says so', () => {
    expect(assessDay([], 12, baselines).lines[0]).toMatch(/^12 jobs were scored, but no LLM/);
    expect(assessDay([], 0, baselines).lines).toEqual([]);
    // Stub lines still count as lines (the logging works).
    expect(assessDay([row({ provider: 'stub', taskCalls: 3 })], 12, baselines).lines).toEqual([]);
  });

  it('reads Logs Insights rows, with fields absent when no line had them', () => {
    expect(toGroup([{ field: 'task', value: 'smoke' }])).toMatchObject({
      task: 'smoke',
      taskCalls: 0,
      p95Ms: undefined,
      medianSpread: undefined,
    });
  });
});

describe('runReport', () => {
  const deps = (rows: ResultField[][], scored = 0) => {
    const d: LlmReportDeps = {
      stackName: 'jobdeputy-dev-iad',
      baselines,
      query: vi.fn(async (q: string) =>
        q === GROUPS_QUERY ? rows : [[{ field: 'scoredJobs', value: `${scored}` }]],
      ),
      publish: vi.fn(async () => undefined),
      now: () => NOW,
    };
    return d;
  };

  it('queries the last day and sends no email when all is well', async () => {
    const d = deps([row({})], 900);
    await runReport(d);
    const start = new Date(NOW.getTime() - REPORT_WINDOW_MS);
    expect(d.query).toHaveBeenCalledWith(GROUPS_QUERY, start, NOW);
    expect(d.query).toHaveBeenCalledWith(SCORED_QUERY, start, NOW);
    expect(d.publish).not.toHaveBeenCalled();
  });

  it('emails the alarm topic when a limit is crossed', async () => {
    const d = deps([row({ partial: 50 })]);
    await runReport(d);
    expect(d.publish).toHaveBeenCalledWith(
      '[jobdeputy-dev-iad] LLM report: limits crossed',
      expect.stringContaining('partial results: 50% (50 of 100; limit 5%)'),
    );
  });

  it('a failed query fails the run (its alarm fires)', async () => {
    const d = deps([]);
    d.query = vi.fn(async () => {
      throw new Error('Logs Insights query ended as Failed');
    });
    await expect(runReport(d)).rejects.toThrow('Failed');
    expect(d.publish).not.toHaveBeenCalled();
  });
});
