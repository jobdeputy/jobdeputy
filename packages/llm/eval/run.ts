import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveModel } from '../src/models.js';
import { relevanceCases } from './cases/relevance.js';
import { smokeCases } from './cases/smoke.js';
import {
  compare,
  type EvalReport,
  evalRelevance,
  evalSmoke,
  summary,
  summaryText,
} from './harness.js';

// Runs the eval against the real platform model (costs money; about $0.01 for every task with
// 2 runs). Used by PRs that change a prompt, schema, or model, and by Nightly.
//   pnpm --filter @jobdeputy/llm eval [--task smoke|relevance|all] [--runs 2]
//     [--summary out.md] [--summary-text out.txt] [--update-baseline]

const { values } = parseArgs({
  options: {
    task: { type: 'string', default: 'all' },
    runs: { type: 'string', default: '2' },
    summary: { type: 'string' },
    'summary-text': { type: 'string' },
    'update-baseline': { type: 'boolean', default: false },
  },
});

const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be 1 to 5');

const region = process.env.AWS_REGION ?? 'us-east-1';
const source = resolveModel({ source: 'platform', region });
const suites: Record<string, () => Promise<EvalReport>> = {
  smoke: () => evalSmoke(smokeCases, source, runs),
  relevance: () => evalRelevance(relevanceCases, source, runs),
};
const chosen = values.task === 'all' ? Object.keys(suites) : [values.task as string];
for (const name of chosen) if (!suites[name]) throw new Error(`unknown task: ${name}`);

const markdown: string[] = [];
const plain: string[] = [];
let failed = false;
for (const name of chosen) {
  const report = await (suites[name] as () => Promise<EvalReport>)();
  const baselinePath = join(
    dirname(fileURLToPath(import.meta.url)),
    'baselines',
    `${report.promptVersion}.json`,
  );
  const baseline = existsSync(baselinePath)
    ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalReport)
    : undefined;
  const result = compare(report, baseline);
  const text = summary(report, baseline, result);
  console.log(text);
  markdown.push(text);
  // Plain text for the Nightly email (the Markdown table shows as raw pipes in mail).
  plain.push(summaryText(report, baseline, result));
  if (result.regressions.length > 0) failed = true;
  if (values['update-baseline']) {
    if (result.regressions.length > 0)
      throw new Error(`refusing to save a baseline with regressions (${name})`);
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify({ ...report, failures: [] }, null, 2)}\n`);
    console.log(`saved ${baselinePath}`);
  }
}
if (values.summary) writeFileSync(values.summary, `${markdown.join('\n\n')}\n`);
if (values['summary-text']) writeFileSync(values['summary-text'], `${plain.join('\n\n')}\n`);
process.exitCode = failed ? 1 : 0;
