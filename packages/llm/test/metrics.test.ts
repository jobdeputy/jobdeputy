import { describe, expect, it } from 'vitest';
import { LLM_METRICS_NAMESPACE, recordTaskMetrics, taskMetricsLine } from '../src/metrics.js';
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
    const line = taskMetricsLine(timeout, { groundingRejections: 3, scoreSpread: 40 }, 'task', AT);
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
    });
    const [directive] = (
      line._aws as { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] }
    ).CloudWatchMetrics;
    expect(directive?.Namespace).toBe(LLM_METRICS_NAMESPACE);
    // Every metric named in the directive has a value in the line.
    for (const { Name } of directive?.Metrics ?? []) expect(typeof line[Name]).toBe('number');
  });

  it('keeps dev to totals and per task; prod adds model, prompt version, and key source', () => {
    const dims = (detail: 'task' | 'full') =>
      (
        taskMetricsLine(ok, {}, detail, AT)._aws as {
          CloudWatchMetrics: { Dimensions: string[][] }[];
        }
      ).CloudWatchMetrics[0]?.Dimensions;
    expect(dims('task')).toEqual([[], ['task']]);
    expect(dims('full')).toEqual([[], ['task'], ['task', 'modelId', 'promptVersion', 'keySource']]);
  });

  it('never writes the output, a user, or anything not measured', () => {
    const line = JSON.stringify(taskMetricsLine(ok, {}, 'full', AT));
    expect(line).not.toContain('job text');
    expect(line).not.toMatch(/userId|user/i);
    expect(taskMetricsLine(ok, {}, 'task', AT)).not.toHaveProperty('GroundingRejections');
  });

  it('writes one JSON line with the detail chosen for the stage', () => {
    const lines: string[] = [];
    process.env.LLM_METRICS_DETAIL = 'full';
    recordTaskMetrics(ok, {}, (l) => lines.push(l));
    delete process.env.LLM_METRICS_DETAIL;
    recordTaskMetrics(ok, {}, (l) => lines.push(l));
    const [full, task] = lines.map(
      (l) => JSON.parse(l)._aws.CloudWatchMetrics[0].Dimensions.length,
    );
    expect([full, task]).toEqual([3, 2]);
  });
});
