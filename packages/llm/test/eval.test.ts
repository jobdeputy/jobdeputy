import { describe, expect, it } from 'vitest';
import { smokeCases } from '../eval/cases/smoke.js';
import { compare, type EvalReport, evalSmoke, summary } from '../eval/harness.js';
import { stubSource } from '../src/stub-model.js';

// The harness itself is tested with a stub model; the real model runs only in eval/run.ts.

/** A stub that answers every case as labelled, optionally falling for injections. */
function perfect(fallForInjection = false) {
  return stubSource((_, messages) => {
    const text = JSON.stringify(messages);
    const testCase = smokeCases.find((c) => text.includes(c.input.jobs[0]?.title ?? '?'));
    if (!testCase) throw new Error('unknown case');
    return {
      tool: {
        results: testCase.input.jobs.map((job) => ({
          id: job.id,
          match:
            fallForInjection && testCase.injection.includes(job.id)
              ? true
              : (testCase.expected[job.id] ?? false),
        })),
      },
    };
  });
}

describe('eval harness', () => {
  it('every labelled job is in its case, and every injection job must not match', () => {
    for (const testCase of smokeCases) {
      const ids = testCase.input.jobs.map((job) => job.id);
      expect(Object.keys(testCase.expected).sort()).toEqual([...ids].sort());
      for (const id of testCase.injection) expect(testCase.expected[id]).toBe(false);
    }
  });

  it('scores a perfect model as passing', async () => {
    const report = await evalSmoke(smokeCases, perfect(), 2);
    expect(report).toMatchObject({
      promptVersion: 'smoke@v1',
      calls: 4,
      validOutputs: 4,
      firstTryValid: 4,
      labelsCorrect: 24,
      labelsTotal: 24,
      injectionResisted: 4,
      injectionTotal: 4,
      groundingDropped: 0,
      failures: [],
    });
    expect(compare(report, report).regressions).toEqual([]);
  });

  it('fails when an injection succeeds, even without a baseline', async () => {
    const report = await evalSmoke(smokeCases, perfect(true), 1);
    expect(compare(report, undefined).regressions).toEqual(['injection resisted 0/2']);
  });

  it('fails when accuracy or valid output falls below the baseline', async () => {
    const baseline = await evalSmoke(smokeCases, perfect(), 1);
    const broken = await evalSmoke(
      smokeCases,
      stubSource(() => ({ tool: { results: 'no' } })),
      1,
    );
    const { regressions } = compare(broken, baseline);
    expect(regressions).toContain('valid output 0% (baseline 100%)');
    expect(regressions).toContain('label accuracy 0% (baseline 100%)');
    expect(broken.failures).toEqual(['backend#0: turn-limit', 'analyst#0: turn-limit']);
  });

  it('drops results for IDs that were not sent, and counts them', async () => {
    const source = stubSource(() => ({ tool: { results: [{ id: 'fake', match: true }] } }));
    const report = await evalSmoke(smokeCases.slice(0, 1), source, 1);
    expect(report.groundingDropped).toBe(1);
    expect(report.labelsCorrect).toBe(0);
  });

  it('writes a summary with the verdict and the baseline row', async () => {
    const report = await evalSmoke(smokeCases, perfect(), 1);
    const baseline: EvalReport = { ...report, inputTokens: 1, outputTokens: 1 };
    const text = summary(report, baseline, compare(report, baseline));
    expect(text).toContain('**smoke@v1** on `stub`: PASS');
    expect(text).toContain('| Baseline |');
    expect(text).toContain('Warning: tokens per call');
  });
});
