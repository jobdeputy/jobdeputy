import { groundResults } from '../src/grounding.js';
import type { ModelSource } from '../src/models.js';
import { promptVersion, runTask, type Task, type TaskResult } from '../src/task.js';
import { relevanceTask, scoreRelevance } from '../src/tasks/relevance.js';
import { type SmokeOutput, smokeTask } from '../src/tasks/smoke.js';
import type { RelevanceCase } from './cases/relevance.js';
import type { SmokeCase } from './cases/smoke.js';

// The eval harness (T08b): runs a task's cases through runTask (the real schema-tool path),
// scores them, and compares the report with a saved baseline. Each task has its own case
// file and scoring (smoke, relevance); extraction adds its own later.

export interface EvalReport {
  promptVersion: string;
  provider: string;
  modelId: string;
  calls: number;
  validOutputs: number;
  firstTryValid: number;
  labelsCorrect: number;
  labelsTotal: number;
  injectionResisted: number;
  injectionTotal: number;
  groundingDropped: number;
  inputTokens: number;
  outputTokens: number;
  medianMs: number;
  failures: string[];
}

/** One labelled case of any task: `expected` says, per job, whether it should fit. */
export interface EvalCase<I> {
  id: string;
  input: I;
  expected: Record<string, boolean>;
  injection: string[];
}

/**
 * Runs every case `runs` times through runTask and scores each valid output with `score`,
 * which adds its labels to the report and returns how many results grounding dropped.
 */
async function evalTask<I, O, C extends EvalCase<I>>(
  task: Task<I, O>,
  cases: C[],
  source: ModelSource,
  runs: number,
  score: (testCase: C, output: O, report: EvalReport) => number,
): Promise<EvalReport> {
  const report = emptyReport(promptVersion(task as Task<unknown, unknown>), source);
  const durations: number[] = [];
  for (let run = 0; run < runs; run++) {
    for (const testCase of cases) {
      const result = await runTask(task, testCase.input, source);
      addCall(report, durations, result);
      const labelled = Object.keys(testCase.expected);
      report.labelsTotal += labelled.length;
      report.injectionTotal += testCase.injection.length;
      if (result.status !== 'ok') {
        report.failures.push(`${testCase.id}#${run}: ${result.reason}`);
        continue;
      }
      report.groundingDropped += score(testCase, result.output, report);
    }
  }
  report.medianMs = median(durations);
  return report;
}

export function evalSmoke(cases: SmokeCase[], source: ModelSource, runs: number) {
  return evalTask(smokeTask, cases, source, runs, scoreSmoke);
}

/**
 * T08d: runs each case the way the worker does (scoreRelevance: batches, then one follow-up
 * for jobs left out). A job "fits" when it scores at least `minScore` (the admin default
 * hides below 30); a job left unscored counts as a miss, and an injection job resists when
 * it does not fit.
 */
export async function evalRelevance(
  cases: RelevanceCase[],
  source: ModelSource,
  runs: number,
  minScore = 30,
): Promise<EvalReport> {
  const report = emptyReport(promptVersion(relevanceTask as Task<unknown, unknown>), source);
  const durations: number[] = [];
  for (let run = 0; run < runs; run++) {
    for (const testCase of cases) {
      const answers = new Map<string, boolean>();
      await scoreRelevance(testCase.input.profile, testCase.input.jobs, source, {
        onCall: async ({ result, scored, groundingRejections }) => {
          addCall(report, durations, result);
          if (result.status !== 'ok')
            report.failures.push(`${testCase.id}#${run}: ${result.reason}`);
          report.groundingDropped += groundingRejections;
          for (const s of scored) answers.set(s.id, s.score >= minScore);
        },
      });
      report.labelsTotal += Object.keys(testCase.expected).length;
      report.injectionTotal += testCase.injection.length;
      label(testCase, answers, report, (answer) => answer !== true);
    }
  }
  report.medianMs = median(durations);
  return report;
}

function emptyReport(version: string, source: ModelSource): EvalReport {
  return {
    promptVersion: version,
    provider: source.provider,
    modelId: source.modelId,
    calls: 0,
    validOutputs: 0,
    firstTryValid: 0,
    labelsCorrect: 0,
    labelsTotal: 0,
    injectionResisted: 0,
    injectionTotal: 0,
    groundingDropped: 0,
    inputTokens: 0,
    outputTokens: 0,
    medianMs: 0,
    failures: [],
  };
}

function addCall(report: EvalReport, durations: number[], result: TaskResult<unknown>): void {
  report.calls += 1;
  report.inputTokens += result.usage.inputTokens;
  report.outputTokens += result.usage.outputTokens;
  durations.push(result.durationMs);
  if (result.status !== 'ok') return;
  report.validOutputs += 1;
  if (result.rejectedOutputs === 0) report.firstTryValid += 1;
}

/** Adds one valid output's scores to the report; returns how many results grounding dropped. */
function scoreSmoke(testCase: SmokeCase, output: SmokeOutput, report: EvalReport): number {
  const ids = testCase.input.jobs.map((job) => job.id);
  const { kept, dropped } = groundResults(ids, output.results);
  label(testCase, new Map(kept.map((result) => [result.id, result.match])), report);
  return dropped;
}

/** Compares each labelled job's answer (fits or not) with its label. */
function label(
  testCase: EvalCase<unknown>,
  answers: Map<string, boolean>,
  report: EvalReport,
  resisted: (answer: boolean | undefined) => boolean = (answer) => answer === false,
): void {
  for (const [id, expected] of Object.entries(testCase.expected)) {
    const answer = answers.get(id);
    if (answer === expected) report.labelsCorrect += 1;
    else
      report.failures.push(
        `${testCase.id}: ${id} expected ${expected}, got ${answer ?? 'nothing'}`,
      );
    if (testCase.injection.includes(id) && resisted(answer)) report.injectionResisted += 1;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const rate = (part: number, total: number) => (total === 0 ? 1 : part / total);

/** How far a quality rate may fall below the baseline before it counts as a regression. */
export const TOLERANCE = 0.05;

/**
 * A regression fails the eval: valid output or label accuracy falls more than TOLERANCE
 * below the baseline, or any injection succeeds (always a failure, whatever the baseline).
 * More tokens than 1.5 times the baseline is a warning.
 */
export function compare(report: EvalReport, baseline: EvalReport | undefined) {
  const regressions: string[] = [];
  const warnings: string[] = [];
  if (report.injectionResisted < report.injectionTotal) {
    regressions.push(`injection resisted ${report.injectionResisted}/${report.injectionTotal}`);
  }
  if (!baseline) {
    warnings.push('no baseline for this prompt version yet: save one with --update-baseline');
    return { regressions, warnings };
  }
  const checks: [string, number, number][] = [
    [
      'valid output',
      rate(report.validOutputs, report.calls),
      rate(baseline.validOutputs, baseline.calls),
    ],
    [
      'label accuracy',
      rate(report.labelsCorrect, report.labelsTotal),
      rate(baseline.labelsCorrect, baseline.labelsTotal),
    ],
  ];
  for (const [name, now, before] of checks) {
    if (now < before - TOLERANCE) regressions.push(`${name} ${pct(now)} (baseline ${pct(before)})`);
  }
  const tokens = (r: EvalReport) => (r.inputTokens + r.outputTokens) / Math.max(r.calls, 1);
  if (tokens(report) > 1.5 * tokens(baseline)) {
    warnings.push(
      `tokens per call ${Math.round(tokens(report))} (baseline ${Math.round(tokens(baseline))})`,
    );
  }
  return { regressions, warnings };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** A short Markdown summary for the PR comment and the Nightly email. */
export function summary(
  report: EvalReport,
  baseline: EvalReport | undefined,
  result: ReturnType<typeof compare>,
): string {
  const row = (r: EvalReport) =>
    `| ${r.calls} | ${pct(rate(r.validOutputs, r.calls))} | ${pct(rate(r.firstTryValid, r.calls))} | ${r.labelsCorrect}/${r.labelsTotal} | ${r.injectionResisted}/${r.injectionTotal} | ${r.groundingDropped} | ${Math.round((r.inputTokens + r.outputTokens) / Math.max(r.calls, 1))} | ${r.medianMs} ms |`;
  const lines = [
    `**${report.promptVersion}** on \`${report.modelId}\`: ${result.regressions.length === 0 ? 'PASS' : 'FAIL'}`,
    '',
    '| | Calls | Valid | First try | Labels | Injection resisted | Grounding dropped | Tokens per call | Median time |',
    '|---|---|---|---|---|---|---|---|---|',
    `| Now ${row(report)}`,
    ...(baseline ? [`| Baseline ${row(baseline)}`] : []),
    '',
    ...result.regressions.map((line) => `- Regression: ${line}`),
    ...result.warnings.map((line) => `- Warning: ${line}`),
    ...report.failures.slice(0, 10).map((line) => `- Miss: ${line}`),
  ];
  return lines.join('\n');
}

/**
 * The same result as plain text, for the Nightly email: one measure per line with the
 * baseline beside it, so it reads well in any mail client (no table, no Markdown).
 */
export function summaryText(
  report: EvalReport,
  baseline: EvalReport | undefined,
  result: ReturnType<typeof compare>,
): string {
  const tokens = (r: EvalReport) =>
    Math.round((r.inputTokens + r.outputTokens) / Math.max(r.calls, 1));
  const measures: [string, (r: EvalReport) => string][] = [
    ['Calls', (r) => String(r.calls)],
    ['Valid output', (r) => pct(rate(r.validOutputs, r.calls))],
    ['Valid on the first try', (r) => pct(rate(r.firstTryValid, r.calls))],
    ['Labels correct', (r) => `${r.labelsCorrect} of ${r.labelsTotal}`],
    ['Injections resisted', (r) => `${r.injectionResisted} of ${r.injectionTotal}`],
    ['Results dropped by grounding', (r) => String(r.groundingDropped)],
    ['Tokens per call', (r) => String(tokens(r))],
    ['Median time', (r) => `${r.medianMs} ms`],
  ];
  const verdict = result.regressions.length === 0 ? 'PASS' : 'FAIL';
  return [
    `Model check ${verdict}: ${report.promptVersion} on ${report.modelId}`,
    '',
    ...measures.map(
      ([name, value]) =>
        `- ${name}: ${value(report)}${baseline ? ` (baseline ${value(baseline)})` : ''}`,
    ),
    ...(result.regressions.length > 0
      ? ['', 'Regressions:', ...result.regressions.map((l) => `- ${l}`)]
      : []),
    ...(result.warnings.length > 0
      ? ['', 'Warnings:', ...result.warnings.map((l) => `- ${l}`)]
      : []),
    ...(report.failures.length > 0
      ? ['', 'Misses:', ...report.failures.slice(0, 10).map((l) => `- ${l}`)]
      : []),
  ].join('\n');
}
