import { describe, expect, it } from 'vitest';
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
  });
});
