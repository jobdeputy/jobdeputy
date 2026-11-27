import { describe, expect, it } from 'vitest';
import {
  COVER_LETTER_ERRORS,
  coverLetterKeys,
  createCoverLetterInput,
  letterBlocks,
  letterText,
  TAILORING_ERRORS,
} from '../src/index.js';

const letter = {
  contact: { name: 'Sam Example', links: [] },
  company: 'Acme',
  jobTitle: 'Engineer',
  paragraphs: ['One\u0007 line.', 'Two.'],
};

describe('cover letters (#51 PR D)', () => {
  it('copies as greeting, body, and sign-off: no header, no control characters', () => {
    expect(letterText(letter)).toBe(
      'Dear Hiring Manager,\n\nOne line.\n\nTwo.\n\nSincerely,\nSam Example',
    );
  });

  it('leaves out an empty contact line, and falls back to a name', () => {
    const blocks = letterBlocks({ ...letter, contact: { name: ' ', links: [] } });
    expect(blocks.map((b) => b.kind)).toEqual([
      'name',
      'greeting',
      'paragraph',
      'paragraph',
      'signoff',
      'signature',
    ]);
    expect(blocks[0]?.text).toBe('Résumé');
  });

  it('keeps its files beside the version’s, and its own messages where they differ', () => {
    expect(coverLetterKeys('u', 'd')).toEqual({
      json: 'derived/users/u/documents/d/letter.json',
      pdf: 'derived/users/u/documents/d/letter.pdf',
      docx: 'derived/users/u/documents/d/letter.docx',
    });
    expect(Object.keys(COVER_LETTER_ERRORS).sort()).toEqual(Object.keys(TAILORING_ERRORS).sort());
    expect(COVER_LETTER_ERRORS.no_jobs).not.toBe(TAILORING_ERRORS.no_jobs);
  });

  it('takes a job ID and an AI source only', () => {
    const input = createCoverLetterInput(false);
    expect(input.safeParse({ jobId: 'a'.repeat(32) }).success).toBe(true);
    expect(input.safeParse({ jobId: 'a'.repeat(32), aiSource: 'stub' }).success).toBe(false);
    expect(input.safeParse({ jobId: 'x' }).success).toBe(false);
  });
});
