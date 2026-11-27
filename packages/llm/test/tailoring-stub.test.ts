import { describe, expect, it } from 'vitest';
import { writeCoverLetter } from '../src/tasks/cover-letter.js';
import { extractJobKeywords } from '../src/tasks/job-keywords.js';
import { structureResume } from '../src/tasks/structure-resume.js';
import { tailorResume } from '../src/tasks/tailor-resume.js';
import { stubTailoringSource } from '../src/tasks/tailoring-stub.js';

// The dev stub (integration tests) through the real task functions: a whole tailoring run
// with no provider, the way the deployed worker makes it.
const text = [
  'Sam Example',
  'Backend developer',
  'Software Engineer, Example Logistics',
  '• Built REST APIs in TypeScript.',
  'Skills: TypeScript, Node.js',
  'Education: University of Example',
].join('\n');

describe('stubTailoringSource', () => {
  it('structures, lists keywords, and tailors honestly, one call each', async () => {
    const source = stubTailoringSource('stub-model');
    const structured = await structureResume(text, 'Profile Name', source);
    expect(structured.result.status).toBe('ok');
    expect(structured.grounded?.rejections).toBe(0);
    const base = structured.grounded?.resume;
    expect(base).toMatchObject({
      contact: { name: 'Sam Example', headline: 'Backend developer' },
      skills: [{ group: 'Skills', items: ['TypeScript', 'Node.js'] }],
      experience: [
        {
          id: 'e1',
          title: 'Software Engineer',
          employer: 'Example Logistics',
          bullets: ['Built REST APIs in TypeScript.'],
        },
      ],
      education: [{ id: 'd1', school: 'University of Example' }],
    });
    if (!base) throw new Error('no base');

    const keywords = await extractJobKeywords(
      [
        {
          title: 'Backend Engineer',
          description: 'Build the APIs of Example Test Co.\nTypeScript\nAWS',
        },
      ],
      source,
    );
    expect(keywords.keywords[0]?.map((k) => k.term)).toEqual([
      'Backend Engineer',
      'APIs',
      'TypeScript',
      'AWS',
    ]);

    const run = await tailorResume(
      {
        company: 'Example Test Co',
        base,
        evidence: [],
        jobs: [{ id: 'j1', title: 'Backend Engineer', keywords: keywords.keywords[0] ?? [] }],
      },
      source,
    );
    expect(run.attempts).toHaveLength(1);
    expect(run.best?.issues).toEqual([]);
    expect(run.status).toBe('partial');
    expect(run.best?.scores).toEqual([
      expect.objectContaining({ base: 55, tailored: 55, missingProven: [] }),
    ]);

    // PR D: a cover letter that passes every honesty check on its first call.
    const letter = await writeCoverLetter(
      {
        company: 'Example Test Co',
        resume: base,
        evidence: [],
        job: {
          title: 'Backend Engineer',
          description: 'Build the APIs of Example Test Co.\nTypeScript\nAWS',
          keywords: keywords.keywords[0] ?? [],
        },
      },
      source,
    );
    expect(letter.attempts.map((a) => a.issues)).toEqual([[]]);
    expect(letter.status).toBe('ok');
    expect(letter.best?.paragraphs?.[0]).toBe(
      'I am writing to apply for the Backend Engineer role at Example Test Co. The role fits the work I have done so far, and I would like to bring that work to your team.',
    );
    expect(letter.best?.paragraphs?.join(' ')).toContain('Built REST APIs in TypeScript.');
  });
});
