import { describe, expect, it } from 'vitest';
import {
  LLM_METRICS_NAMESPACE,
  loggedModel,
  recordTaskMetrics,
  taskMetricsLine,
} from '../src/metrics.js';
import type { TaskResult } from '../src/task.js';

const AT = new Date('2026-09-30T12:00:00Z');
const base = {
  task: 'relevance',
  promptVersion: 'relevance@v1',
  keySource: 'platform' as const,
  provider: 'bedrock',
  modelId: 'mistral.ministral-3-14b-instruct',
  usage: { calls: 2, inputTokens: 1200, outputTokens: 90 },
  rejectedOutputs: 1,
  durationMs: 2100,
};
const ok: TaskResult<unknown> = { ...base, status: 'ok', output: { secret: 'job text' } };
const timeout: TaskResult<unknown> = { ...base, status: 'partial', reason: 'timeout' };

describe('task metrics (Embedded Metric Format)', () => {
  it('counts calls, rejections, partial results, timeouts, tokens, and latency', () => {
    const line = taskMetricsLine(
      timeout,
      { groundingRejections: 3, scoreSpread: 40, jobs: 10, lowScoreJobs: 4 },
      AT,
    );
    expect(line).toMatchObject({
      task: 'relevance',
      promptVersion: 'relevance@v1',
      modelId: 'mistral.ministral-3-14b-instruct',
      status: 'partial',
      reason: 'timeout',
      Calls: 2,
      RejectedOutputs: 1,
      Partial: 1,
      Timeouts: 1,
      InputTokens: 1200,
      OutputTokens: 90,
      LatencyMs: 2100,
      GroundingRejections: 3,
      ScoreSpread: 40,
      Jobs: 10,
      LowScoreJobs: 4,
    });
    const [directive] = (
      line._aws as { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] }
    ).CloudWatchMetrics;
    expect(directive?.Namespace).toBe(LLM_METRICS_NAMESPACE);
    // Every metric named in the directive has a value in the line.
    for (const { Name } of directive?.Metrics ?? []) expect(typeof line[Name]).toBe('number');
  });

  it('metrics are totals and per task; jobs and low scores are in the line only', () => {
    const { Dimensions, Metrics } = (
      taskMetricsLine(ok, { jobs: 10, lowScoreJobs: 4 }, AT)._aws as {
        CloudWatchMetrics: { Dimensions: string[][]; Metrics: { Name: string }[] }[];
      }
    ).CloudWatchMetrics[0] ?? { Dimensions: [], Metrics: [] };
    expect(Dimensions).toEqual([[], ['task']]);
    expect(Metrics.map((m) => m.Name)).not.toContain('Jobs');
    expect(Metrics.map((m) => m.Name)).not.toContain('LowScoreJobs');
  });

  it("logs an own key's model by provider only", () => {
    const own: TaskResult<unknown> = { ...ok, keySource: 'own', provider: 'openai' };
    expect(taskMetricsLine(own, {}, AT)).toMatchObject({ keySource: 'own', modelId: 'own:openai' });
    expect(loggedModel(ok)).toBe('mistral.ministral-3-14b-instruct');
  });

  it('never writes the output, a user, or anything not measured', () => {
    const line = JSON.stringify(taskMetricsLine(ok, {}, AT));
    expect(line).not.toContain('job text');
    expect(line).not.toMatch(/userId|user/i);
    expect(taskMetricsLine(ok, {}, AT)).not.toHaveProperty('GroundingRejections');
  });

  it('writes one JSON line', () => {
    const lines: string[] = [];
    recordTaskMetrics(ok, {}, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)._aws.CloudWatchMetrics[0].Dimensions).toEqual([
      [],
      ['task'],
    ]);
  });
});
