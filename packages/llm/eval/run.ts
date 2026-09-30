import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveModel } from '../src/models.js';
import { smokeCases } from './cases/smoke.js';
import { compare, type EvalReport, evalSmoke, summary, summaryText } from './harness.js';

// Runs the eval against the real platform model (costs money; about $0.001 for smoke with 2
// runs). Used by PRs that change a prompt, schema, or model, and by Nightly.
//   pnpm --filter @jobdeputy/llm eval [--runs 2] [--summary out.md] [--summary-text out.txt]
//     [--update-baseline]

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '2' },
    summary: { type: 'string' },
    'summary-text': { type: 'string' },
    'update-baseline': { type: 'boolean', default: false },
  },
});

const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be 1 to 5');

const region = process.env.AWS_REGION ?? 'us-east-1';
const report = await evalSmoke(smokeCases, resolveModel({ source: 'platform', region }), runs);

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
if (values.summary) writeFileSync(values.summary, `${text}\n`);
// Plain text for the Nightly email (the Markdown table shows as raw pipes in mail).
if (values['summary-text']) {
  writeFileSync(values['summary-text'], `${summaryText(report, baseline, result)}\n`);
}

if (values['update-baseline']) {
  if (result.regressions.length > 0)
    throw new Error('refusing to save a baseline with regressions');
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify({ ...report, failures: [] }, null, 2)}\n`);
  console.log(`saved ${baselinePath}`);
}
process.exitCode = result.regressions.length === 0 ? 0 : 1;
