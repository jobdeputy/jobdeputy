import { LLM_METRICS_NAMESPACE } from '@jobdeputy/shared';
import type { TaskResult } from './task.js';

// T08b3 (decision 0009): how LLM tasks behave, as CloudWatch metrics and one log line per
// task call, never with a user ID (0004: aggregated, non-personal). The line uses CloudWatch's
// Embedded Metric Format: Lambda's log stream turns it into metrics, and the same line is the
// detail that Logs Insights queries (dashboard, daily LLM report) read.
//
// T08e: metrics are totals and per task only, in every stage. Each metric is billed per
// combination of dimension values, so the split by model, prompt version, and key source
// is read from the line instead (kept 14 days). Revisit about a month after launch.

export { LLM_METRICS_NAMESPACE };

/** Task-specific measures the caller adds, for example from grounding checks. */
export interface TaskMetricExtras {
  /** Results dropped because they did not match what was sent (0010 rule 4). */
  groundingRejections?: number;
  /** For scoring tasks: highest minus lowest score in the call. */
  scoreSpread?: number;
  /** Jobs (or other items) sent in the call. In the line only, not a metric. */
  jobs?: number;
  /** For scoring tasks: results scored below the cut-off that hides them. In the line only. */
  lowScoreJobs?: number;
}

/**
 * The model as logged: an own key's model can be any name the provider offers, so it is
 * logged by provider only, which keeps the report's groups few.
 */
export function loggedModel(
  result: Pick<TaskResult<unknown>, 'keySource' | 'provider' | 'modelId'>,
): string {
  return result.keySource === 'own' ? `own:${result.provider}` : result.modelId;
}

/** One Embedded Metric Format line for a finished task call. */
export function taskMetricsLine(
  result: TaskResult<unknown>,
  extras: TaskMetricExtras = {},
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
  return {
    _aws: {
      Timestamp: at.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: LLM_METRICS_NAMESPACE,
          Dimensions: [[], ['task']],
          Metrics: Object.entries(values).map(([Name, [, Unit]]) => ({ Name, Unit })),
        },
      ],
    },
    task: result.task,
    promptVersion: result.promptVersion,
    keySource: result.keySource,
    provider: result.provider,
    modelId: loggedModel(result),
    status: result.status,
    ...(result.status === 'partial' ? { reason: result.reason } : {}),
    ...Object.fromEntries(Object.entries(values).map(([name, [value]]) => [name, value])),
    ...(extras.jobs !== undefined ? { Jobs: extras.jobs } : {}),
    ...(extras.lowScoreJobs !== undefined ? { LowScoreJobs: extras.lowScoreJobs } : {}),
  };
}

/** Writes the metrics line for a task call. LLM workers call it once per finished task call. */
export function recordTaskMetrics(
  result: TaskResult<unknown>,
  extras: TaskMetricExtras = {},
  write: (line: string) => void = (line) => console.log(line),
): void {
  write(JSON.stringify(taskMetricsLine(result, extras)));
}
