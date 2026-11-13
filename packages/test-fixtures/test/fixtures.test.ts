import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { makeDocx, makeEicar, makePdf, makeZipBomb } from '../src/index.js';

describe('fixtures', () => {
  it('builds a PDF with a header, pages, and a trailer', () => {
    const pdf = strFromU8(makePdf([['Hello (world)'], ['Page two']]));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('builds a DOCX zip with the document part', () => {
    const files = unzipSync(makeDocx(['A & B']));
    expect(strFromU8(files['word/document.xml'] as Uint8Array)).toContain('A &amp; B');
  });

  it('builds a small zip that expands a lot', () => {
    expect(makeZipBomb(20).length).toBeLessThan(100_000);
  });

  it('builds the 68-byte EICAR test string', () => {
    expect(makeEicar().length).toBe(68);
  });
});
