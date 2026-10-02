import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  type ResultField,
  StartQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { createLogger } from '@jobdeputy/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';

/**
 * T08e1: the daily LLM report. Once a day it reads the last day's LLM log lines (one per
 * task call, packages/llm/src/metrics.ts) with Logs Insights, per task, prompt version, and
 * model, and emails the alarm topic only when a limit is crossed. Metrics stay totals and
 * per task (each metric is billed per combination of dimension values); this split costs
 * only the bytes the query scans.
 *
 * Start values, tuned with real runs (docs/tasks/t08e-live-effectiveness.md). Agreement
 * with the second model comes with T08e2 (#66).
 */
export const LLM_REPORT_LIMITS = {
  /** Groups with fewer task calls are skipped: too few to judge. */
  minTaskCalls: 20,
  /** Share of model calls whose reply was rejected as invalid output. */
  rejectedOutputs: 0.05,
  /** Share of task calls with a partial result. */
  partial: 0.05,
  /** Share of task calls that timed out. */
  timeouts: 0.01,
  /** Grounding rejections per job sent. */
  groundingRejections: 0.02,
  /** p95 latency against the eval baseline's median, platform model only. */
  latencyFactor: 2,
  /** Median score spread within a call (a model that scores everything alike). */
  minScoreSpread: 20,
  /** Share of jobs sent scored below the cut-off that hides them. */
  lowScoreShare: { min: 0.1, max: 0.8 },
} as const;

/** The report covers the day before it runs. */
export const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const logger = createLogger('llm-report');

/** One line per group: task, prompt version, model (own keys: `own:<provider>`), key source. */
export const GROUPS_QUERY = `filter ispresent(task) and ispresent(Calls)
| stats count(*) as taskCalls, sum(Calls) as modelCalls, sum(RejectedOutputs) as rejected,
  sum(Partial) as partial, sum(Timeouts) as timeouts, sum(Jobs) as jobs,
  sum(GroundingRejections) as grounding, sum(LowScoreJobs) as lowScore,
  pct(LatencyMs, 95) as p95Ms, pct(ScoreSpread, 50) as medianSpread
  by task, promptVersion, modelId, keySource, provider`;

/** Jobs the relevance worker scored with the model (its "Scoring ended" lines). */
export const SCORED_QUERY = `filter message = "Scoring ended" and scored > 0
| stats sum(scored) as scoredJobs`;

export interface ReportGroup {
  task: string;
  promptVersion: string;
  modelId: string;
  keySource: string;
  provider: string;
  taskCalls: number;
  modelCalls: number;
  rejected: number;
  partial: number;
  timeouts: number;
  jobs: number;
  grounding: number;
  lowScore: number;
  p95Ms?: number | undefined;
  medianSpread?: number | undefined;
}

/** The eval's baseline for a prompt version (packages/llm/eval/baselines). */
export const latencyBaseline = z.object({ modelId: z.string(), medianMs: z.number().positive() });
export type LatencyBaselines = Record<string, z.infer<typeof latencyBaseline>>;

type Row = ResultField[];

const text = (row: Row, field: string) => row.find((f) => f.field === field)?.value;
const num = (row: Row, field: string): number | undefined => {
  const value = text(row, field);
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export function toGroup(row: Row): ReportGroup {
  return {
    task: text(row, 'task') ?? '?',
    promptVersion: text(row, 'promptVersion') ?? '?',
    modelId: text(row, 'modelId') ?? '?',
    keySource: text(row, 'keySource') ?? '?',
    provider: text(row, 'provider') ?? '?',
    taskCalls: num(row, 'taskCalls') ?? 0,
    modelCalls: num(row, 'modelCalls') ?? 0,
    rejected: num(row, 'rejected') ?? 0,
    partial: num(row, 'partial') ?? 0,
    timeouts: num(row, 'timeouts') ?? 0,
    jobs: num(row, 'jobs') ?? 0,
    grounding: num(row, 'grounding') ?? 0,
    lowScore: num(row, 'lowScore') ?? 0,
    p95Ms: num(row, 'p95Ms'),
    medianSpread: num(row, 'medianSpread'),
  };
}

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** The limits a group crosses, one line each. Pure. */
export function checkGroup(g: ReportGroup, baselines: LatencyBaselines): string[] {
  const L = LLM_REPORT_LIMITS;
  const problems: string[] = [];
  const over = (count: number, of: number, limit: number, what: string) => {
    if (of > 0 && count / of > limit) {
      problems.push(`${what}: ${pct(count / of)} (${count} of ${of}; limit ${pct(limit)})`);
    }
  };
  over(g.rejected, g.modelCalls, L.rejectedOutputs, 'rejected outputs');
  over(g.partial, g.taskCalls, L.partial, 'partial results');
  over(g.timeouts, g.taskCalls, L.timeouts, 'timeouts');
  over(g.grounding, g.jobs, L.groundingRejections, 'grounding rejections per job');

  const baseline = baselines[g.promptVersion];
  if (
    g.keySource === 'platform' &&
    g.p95Ms !== undefined &&
    baseline?.modelId === g.modelId &&
    g.p95Ms > L.latencyFactor * baseline.medianMs
  ) {
    problems.push(
      `latency p95: ${Math.round(g.p95Ms)} ms (limit ${L.latencyFactor} × the eval's ${baseline.medianMs} ms)`,
    );
  }
  if (g.medianSpread !== undefined && g.medianSpread < L.minScoreSpread) {
    problems.push(`median score spread: ${g.medianSpread} (limit at least ${L.minScoreSpread})`);
  }
  if (g.task === 'relevance' && g.jobs > 0) {
    const share = g.lowScore / g.jobs;
    if (share < L.lowScoreShare.min || share > L.lowScoreShare.max) {
      problems.push(
        `hidden by a low score: ${pct(share)} of jobs (${g.lowScore} of ${g.jobs}; expected ${pct(L.lowScoreShare.min)}–${pct(L.lowScoreShare.max)})`,
      );
    }
  }
  return problems;
}

export interface Report {
  /** Email lines; empty: nothing to send. */
  lines: string[];
  checked: number;
  skipped: number;
}

/** Judges the day's groups. The dev-only `stub` provider is never judged. Pure. */
export function assessDay(rows: Row[], scoredJobs: number, baselines: LatencyBaselines): Report {
  const groups = rows.map(toGroup);
  const lines: string[] = [];
  let checked = 0;
  let skipped = 0;
  for (const g of groups) {
    if (g.provider === 'stub') continue;
    if (g.taskCalls < LLM_REPORT_LIMITS.minTaskCalls) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const problems = checkGroup(g, baselines);
    if (problems.length > 0) {
      lines.push(
        `${g.task} ${g.promptVersion} on ${g.modelId} (${g.keySource}, ${g.taskCalls} task calls):`,
        ...problems.map((p) => `  - ${p}`),
      );
    }
  }
  // The report sees only log lines: jobs scored without any line means it is blind.
  if (scoredJobs > 0 && groups.every((g) => g.taskCalls === 0)) {
    lines.push(
      `${scoredJobs} jobs were scored, but no LLM log lines were found: the report cannot see the model (check packages/llm/src/metrics.ts and the query).`,
    );
  }
  return { lines, checked, skipped };
}

export interface LlmReportDeps {
  stackName: string;
  baselines: LatencyBaselines;
  /** Runs a Logs Insights query over the LLM workers' log groups, from `start` to `end`. */
  query: (queryString: string, start: Date, end: Date) => Promise<Row[]>;
  publish: (subject: string, message: string) => Promise<void>;
  now: () => Date;
}

export async function runReport(deps: LlmReportDeps): Promise<Report> {
  const end = deps.now();
  const start = new Date(end.getTime() - REPORT_WINDOW_MS);
  const [rows, scored] = await Promise.all([
    deps.query(GROUPS_QUERY, start, end),
    deps.query(SCORED_QUERY, start, end),
  ]);
  const scoredJobs = scored[0] ? (num(scored[0], 'scoredJobs') ?? 0) : 0;
  const report = assessDay(rows, scoredJobs, deps.baselines);
  if (report.lines.length > 0) {
    await deps.publish(
      `[${deps.stackName}] LLM report: limits crossed`,
      [
        `LLM task calls from ${start.toISOString()} to ${end.toISOString()}.`,
        '',
        ...report.lines,
        '',
        'See docs/runbooks/alarms.md (Daily LLM report).',
      ].join('\n'),
    );
  }
  logger.info('LLM report', {
    groups: rows.length,
    checked: report.checked,
    skipped: report.skipped,
    problems: report.lines.length,
  });
  return report;
}

/** How long to wait for a query, and how often to ask. */
const QUERY_WAIT = { pollMs: 1_000, maxPolls: 60 };

let deps: LlmReportDeps | undefined;

function defaultDeps(): LlmReportDeps {
  const { LOG_GROUPS, LATENCY_BASELINES, ALARM_TOPIC_ARN, STACK_NAME } = process.env;
  if (!LOG_GROUPS || !LATENCY_BASELINES || !ALARM_TOPIC_ARN || !STACK_NAME) {
    throw new Error('LOG_GROUPS, LATENCY_BASELINES, ALARM_TOPIC_ARN, and STACK_NAME must be set');
  }
  const logGroupNames = z.array(z.string().min(1)).min(1).parse(JSON.parse(LOG_GROUPS));
  const baselines = z.record(z.string(), latencyBaseline).parse(JSON.parse(LATENCY_BASELINES));
  const logs = new CloudWatchLogsClient({});
  const sns = new SNSClient({});
  return {
    stackName: STACK_NAME,
    baselines,
    query: async (queryString, start, end) => {
      const { queryId } = await logs.send(
        new StartQueryCommand({
          logGroupNames,
          queryString,
          startTime: Math.floor(start.getTime() / 1000),
          endTime: Math.floor(end.getTime() / 1000),
        }),
      );
      for (let i = 0; i < QUERY_WAIT.maxPolls; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, QUERY_WAIT.pollMs));
        const res = await logs.send(new GetQueryResultsCommand({ queryId }));
        if (res.status === 'Complete') return res.results ?? [];
        if (res.status !== 'Running' && res.status !== 'Scheduled') {
          throw new Error(`Logs Insights query ended as ${res.status}`);
        }
      }
      throw new Error('Logs Insights query did not finish in time');
    },
    publish: async (subject, message) => {
      await sns.send(
        new PublishCommand({
          TopicArn: ALARM_TOPIC_ARN,
          Subject: subject.slice(0, 100),
          Message: message,
        }),
      );
    },
    now: () => new Date(),
  };
}

/** Scheduled once a day (shared stacks only). A failure fails the run: its alarm fires. */
export async function handler(_event: unknown, context: Context): Promise<void> {
  logger.addContext(context);
  deps ??= defaultDeps();
  await runReport(deps);
}
