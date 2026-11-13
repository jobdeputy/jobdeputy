import { LLM_METRICS_NAMESPACE } from '@jobdeputy/shared';
import type { TaskResult } from './task.js';

// T08b3 (decision 0009): how LLM tasks behave, as CloudWatch metrics and one log line per
// task call, never with a user ID (0004: aggregated, non-personal). The line uses CloudWatch's
// Embedded Metric Format: Lambda's log stream turns it into metrics, and the same line is the
// detail that Logs Insights queries (dashboard) read.

export { LLM_METRICS_NAMESPACE };

/**
 * `task`: totals and per task (dev, a few metrics). `full`: also per model, prompt version,
 * and key source (prod; agreed 2026-09-30: no compromise on detail in prod).
 */
export type MetricsDetail = 'task' | 'full';

/** Task-specific measures the caller adds, for example from grounding checks. */
export interface TaskMetricExtras {
  /** Results dropped because they did not match what was sent (0010 rule 4). */
  groundingRejections?: number;
  /** For scoring tasks: highest minus lowest score in the call. */
  scoreSpread?: number;
}

const FULL_DIMENSIONS = ['task', 'modelId', 'promptVersion', 'keySource'];

/** One Embedded Metric Format line for a finished task call. */
export function taskMetricsLine(
  result: TaskResult<unknown>,
  extras: TaskMetricExtras = {},
  detail: MetricsDetail = 'task',
  at: Date = new Date(),
): Record<string, unknown> {
  const values: Record<string, [number, string]> = {
    Calls: [result.usage.calls, 'Count'],
    RejectedOutputs: [result.rejectedOutputs, 'Count'],
    Partial: [result.status === 'partial' ? 1 : 0, 'Count'],
    Timeouts: [result.status === 'partial' && result.reason === 'timeout' ? 1 : 0, 'Count'],
    InputTokens: [result.usage.inputTokens, 'Count'],
    OutputTokens: [result.usage.outputTokens, 'Count'],
    LatencyMs: [result.durationMs, 'Milliseconds'],
    ...(extras.groundingRejections !== undefined
      ? { GroundingRejections: [extras.groundingRejections, 'Count'] }
      : {}),
    ...(extras.scoreSpread !== undefined ? { ScoreSpread: [extras.scoreSpread, 'None'] } : {}),
  };
  const dimensions = detail === 'full' ? [[], ['task'], FULL_DIMENSIONS] : [[], ['task']];
  return {
    _aws: {
      Timestamp: at.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: LLM_METRICS_NAMESPACE,
          Dimensions: dimensions,
          Metrics: Object.entries(values).map(([Name, [, Unit]]) => ({ Name, Unit })),
        },
      ],
    },
    task: result.task,
    promptVersion: result.promptVersion,
    keySource: result.keySource,
    provider: result.provider,
    modelId: result.modelId,
    status: result.status,
    ...(result.status === 'partial' ? { reason: result.reason } : {}),
    ...Object.fromEntries(Object.entries(values).map(([name, [value]]) => [name, value])),
  };
}

/**
 * Writes the metrics line for a task call. LLM workers call it once per finished task call;
 * `LLM_METRICS_DETAIL` (set by the stack per stage) chooses the detail.
 */
export function recordTaskMetrics(
  result: TaskResult<unknown>,
  extras: TaskMetricExtras = {},
  write: (line: string) => void = (line) => console.log(line),
): void {
  const detail: MetricsDetail = process.env.LLM_METRICS_DETAIL === 'full' ? 'full' : 'task';
  write(JSON.stringify(taskMetricsLine(result, extras, detail)));
}
