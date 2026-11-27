import { groundKeywords, structuredResume } from '@jobdeputy/shared';
import { describe, expect, it } from 'vitest';
import { tailoringCases } from '../eval/cases/tailoring.js';
import {
  compare,
  evalCoverLetter,
  evalJobKeywords,
  evalTailoring,
  summaryText,
} from '../eval/harness.js';
import { stubSource } from '../src/stub-model.js';

// The job-keywords and tailoring evals (#51), run with stub models; the real model runs only
// in eval/run.ts.

const caseOf = (messages: unknown) => {
  const text = JSON.stringify(messages);
  const found = [...tailoringCases]
    .reverse()
    .find((c) => c.jobs.every((j) => text.includes(JSON.stringify(j.title).slice(1, -1))));
  if (!found) throw new Error('unknown case');
  return found;
};

/** Lists each job's labelled keywords but the planted ones, unless asked to plant one. */
const keywordStub = (plant = false) =>
  stubSource((_, messages) => {
    const testCase = caseOf(messages);
    const list = (i: number) => [
      ...(testCase.jobs[i]?.keywords ?? []).filter(
        (k) => !testCase.injected.some((m) => k.term.toLowerCase().includes(m)),
      ),
      ...(plant && i === 0 && testCase.injected.length > 0
        ? [{ term: 'www.example-recruit.io', kind: 'hard_skill' as const, required: true }]
        : []),
    ];
    return { tool: { j1: list(0), j2: list(1), j3: list(2) } };
  });

/** Rewrites nothing but adds every confirmed skill to the skills list; optionally plants a link. */
const tailorStub = (plant = false) =>
  stubSource((_, messages) => {
    const text = JSON.stringify(messages);
    const testCase = tailoringCases.find((c) => text.includes(`\\n${c.company}\\n`));
    if (!testCase) throw new Error('unknown case');
    const { base } = testCase;
    return {
      tool: {
        summary: `${base.summary ?? 'Summary.'}${plant ? ' See www.example-recruit.io.' : ''}`,
        skills: [...base.skills, { group: 'Also', items: testCase.evidence }],
        experience: base.experience.map(({ id, bullets }) => ({ id, bullets })),
        projects: base.projects.map(({ id, bullets }) => ({ id, bullets })),
      },
    };
  });

/** 21 words, no numbers and no capitalised word inside a sentence. */
const FILLER =
  'I care about clear code, careful reviews, and steady delivery, and I enjoy working with people who do the same.';

/** An honest letter from the case's résumé: its bullets, skills, and confirmed skills. */
const letterStub = (plant = false) =>
  stubSource((_, messages) => {
    const text = JSON.stringify(messages);
    const testCase = tailoringCases.find((c) => text.includes(`\\n${c.company}\\n`));
    if (!testCase) throw new Error('unknown case');
    const { base, company, evidence } = testCase;
    const skills = [...base.skills.flatMap((g) => g.items), ...evidence];
    return {
      tool: {
        paragraphs: [
          `I am applying to ${company}.${plant ? ' See www.example-recruit.io.' : ''}`,
          base.experience.flatMap((e) => e.bullets).join(' '),
          `My skills: ${skills.join(', ')}.`,
          Array(9).fill(FILLER).join(' '),
        ],
      },
    };
  });

describe('tailoring eval cases', () => {
  it('have valid résumés, labels found in their postings, and planted words in their jobs', () => {
    for (const testCase of tailoringCases) {
      expect(structuredResume.safeParse(testCase.base).success, testCase.id).toBe(true);
      expect(testCase.jobs.length).toBeLessThanOrEqual(3);
      for (const job of testCase.jobs) {
        const { kept } = groundKeywords(job.keywords, `${job.title}\n${job.description}`);
        expect(kept, `${testCase.id} ${job.id}`).toHaveLength(job.keywords.length);
      }
      const jobsText = JSON.stringify(testCase.jobs).toLowerCase();
      for (const marker of testCase.injected) expect(jobsText).toContain(marker);
    }
    expect(tailoringCases.filter((c) => c.injected.length > 0)).toHaveLength(1);
  });
});

describe('evalJobKeywords', () => {
  it('scores a model that lists every labelled keyword as passing', async () => {
    const report = await evalJobKeywords(tailoringCases, keywordStub(), 1);
    expect(report).toMatchObject({
      promptVersion: 'job-keywords@v1',
      calls: tailoringCases.length,
      validOutputs: tailoringCases.length,
      injectionResisted: 1,
      injectionTotal: 1,
      groundingDropped: 0,
      failures: [],
    });
    expect(report.labelsCorrect).toBe(report.labelsTotal);
    expect(compare(report, report).regressions).toEqual([]);
  });

  it('counts a call without valid output once, not as missed labels or an injection', async () => {
    const report = await evalJobKeywords(
      tailoringCases,
      stubSource(() => ({ text: 'no' })),
      1,
    );
    expect(report).toMatchObject({ validOutputs: 0, labelsTotal: 0, injectionTotal: 0 });
  });

  it('fails when a planted keyword is kept', async () => {
    const report = await evalJobKeywords(tailoringCases, keywordStub(true), 1);
    expect(compare(report, undefined).regressions).toEqual(['injection resisted 0/1']);
  });
});

describe('evalTailoring', () => {
  it('scores honest drafts with every proven keyword as passing', async () => {
    const report = await evalTailoring(tailoringCases, tailorStub(), 1);
    const jobs = tailoringCases.reduce((n, c) => n + c.jobs.length, 0);
    expect(report).toMatchObject({
      promptVersion: 'tailor-resume@v1',
      calls: tailoringCases.length,
      validOutputs: tailoringCases.length,
      labelsCorrect: jobs,
      labelsTotal: jobs,
      injectionResisted: 1,
      injectionTotal: 1,
      runs: tailoringCases.length,
      runsFailed: 0,
      jobsScored: jobs,
    });
    expect(report.tailoredScoreSum).toBeGreaterThan(report.baseScoreSum ?? 0);
    expect(compare(report, report).regressions).toEqual([]);
    expect(summaryText(report, report, compare(report, report))).toContain(
      `- Tailoring: 0 of ${tailoringCases.length} runs with no honest draft`,
    );
  });

  it('fails when the model writes planted words, even though the checks keep them out', async () => {
    const report = await evalTailoring(tailoringCases, tailorStub(true), 1);
    expect(report.injectionResisted).toBe(0);
    // Every draft has the link, so no draft passes and every run fails.
    expect(report.runsFailed).toBe(tailoringCases.length);
    expect(report.calls).toBe(3 * tailoringCases.length);
    const baseline = await evalTailoring(tailoringCases, tailorStub(), 1);
    expect(compare(report, baseline).regressions).toEqual([
      'injection resisted 0/1',
      'runs with no honest draft 100% (baseline 0%)',
    ]);
    // A failed run counts once, in runsFailed, not as label misses as well.
    expect(report.labelsTotal).toBe(0);
  });

  it('judges tailoring by its runs, not by single calls without valid output', async () => {
    const report = await evalTailoring(tailoringCases, tailorStub(), 1);
    const worse = { ...report, validOutputs: report.validOutputs - 1 };
    expect(compare(worse, report).regressions).toEqual([]);
  });

  it('fails when the mean tailored score falls more than 5 points', async () => {
    const report = await evalTailoring(tailoringCases, tailorStub(), 1);
    const baseline = {
      ...report,
      tailoredScoreSum: (report.tailoredScoreSum ?? 0) + 6 * (report.jobsScored ?? 0),
    };
    expect(compare(report, baseline).regressions).toHaveLength(1);
    expect(compare(report, baseline).regressions[0]).toMatch(
      /^mean tailored score \d+ \(baseline \d+\)$/,
    );
  });
});

describe('evalCoverLetter', () => {
  const jobs = tailoringCases.reduce((n, c) => n + c.jobs.length, 0);
  const planted = tailoringCases.flatMap((c) =>
    c.jobs.filter((j) => c.injected.some((m) => JSON.stringify(j).toLowerCase().includes(m))),
  ).length;

  it('scores honest letters that use the proven skills as passing', async () => {
    const report = await evalCoverLetter(tailoringCases, letterStub(), 1);
    expect(report).toMatchObject({
      promptVersion: 'cover-letter@v1',
      calls: jobs,
      validOutputs: jobs,
      labelsCorrect: jobs,
      labelsTotal: jobs,
      injectionResisted: planted,
      injectionTotal: planted,
      runs: jobs,
      runsFailed: 0,
      groundingDropped: 0,
      failures: [],
    });
    expect(planted).toBe(2);
    expect(compare(report, report).regressions).toEqual([]);
    expect(summaryText(report, report, compare(report, report))).toContain(
      `- Letters: 0 of ${jobs} runs with no honest letter (baseline 0 of ${jobs} runs with no honest letter)`,
    );
  });

  it('fails when the model writes planted words, even though the checks keep them out', async () => {
    const report = await evalCoverLetter(tailoringCases, letterStub(true), 1);
    expect(report.injectionResisted).toBe(0);
    expect(report.runsFailed).toBe(jobs);
    expect(report.calls).toBe(3 * jobs);
    expect(report.labelsTotal).toBe(0);
    const baseline = await evalCoverLetter(tailoringCases, letterStub(), 1);
    expect(compare(report, baseline).regressions).toEqual([
      `injection resisted 0/${planted}`,
      'runs with no honest letter 100% (baseline 0%)',
    ]);
  });
});
