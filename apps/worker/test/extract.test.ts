import { makeDocx, makeEicar, makePdf, makeZipBomb } from '@jobdeputy/test-fixtures';
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectKind, extractDocumentText, LIMITS, RejectedFileError } from '../src/extract.js';

describe('extractDocumentText', () => {
  it('extracts text from a PDF and counts pages', async () => {
    const r = await extractDocumentText(
      makePdf([['Ada Lovelace', 'Engineer'], ['Page two']]),
      'pdf',
    );
    expect(r.text).toContain('Ada Lovelace');
    expect(r.text).toContain('Page two');
    expect(r).toMatchObject({ pageCount: 2, noText: false, truncated: false });
  });

  it('extracts text from a DOCX', async () => {
    const r = await extractDocumentText(makeDocx(['Ada Lovelace', 'TypeScript & AWS']), 'docx');
    expect(r.text).toContain('TypeScript & AWS');
    expect(r.noText).toBe(false);
  });

  it('marks a PDF without a text layer as "no text", not as an error', async () => {
    const r = await extractDocumentText(makePdf([[]]), 'pdf');
    expect(r).toMatchObject({ noText: true, charCount: 0, pageCount: 1 });
  });

  it.each([
    ['an empty file', new Uint8Array(), 'pdf', 'empty'],
    ['a text file named .pdf', strToU8('just text'), 'pdf', 'not a valid PDF'],
    ['a DOCX declared as PDF', makeDocx(['x']), 'pdf', 'not a valid PDF'],
    ['a PDF declared as DOCX', makePdf([['x']]), 'docx', 'not a valid DOCX'],
    ['the EICAR string', makeEicar(), 'pdf', 'not a valid PDF'],
    ['a broken PDF', strToU8('%PDF-1.4 garbage'), 'pdf', 'not a readable PDF'],
    ['a zip without a Word document', strToU8('PK\u0003\u0004 not really'), 'docx', 'DOCX'],
    ['a decompression bomb', makeZipBomb(60), 'docx', 'unsafe size'],
  ] as const)('rejects %s', async (_, bytes, declared, message) => {
    await expect(extractDocumentText(bytes, declared)).rejects.toThrow(RejectedFileError);
    await expect(extractDocumentText(bytes, declared)).rejects.toThrow(message);
  });

  it('rejects files over 5 MB before parsing', async () => {
    const big = new Uint8Array(LIMITS.maxBytes + 1);
    big.set(strToU8('%PDF-'));
    await expect(extractDocumentText(big, 'pdf')).rejects.toThrow('larger than 5 MB');
  });

  it('rejects PDFs over the page limit', async () => {
    const pages = Array.from({ length: LIMITS.maxPages + 1 }, (_, i) => [`Page ${i}`]);
    await expect(extractDocumentText(makePdf(pages), 'pdf')).rejects.toThrow('limit is 20');
  });

  it('caps stored text', async () => {
    const docx = makeDocx(Array.from({ length: 3000 }, () => 'x'.repeat(90)));
    const r = await extractDocumentText(docx, 'docx');
    expect(r.charCount).toBe(LIMITS.maxTextChars);
    expect(r.truncated).toBe(true);
  });

  it("never consumes the caller's bytes", async () => {
    const pdf = makePdf([['Ada']]);
    await extractDocumentText(pdf, 'pdf');
    expect(pdf.length).toBeGreaterThan(0);
  });

  it('detects types from signatures only', () => {
    expect(detectKind(strToU8('%PDF-1.7'))).toBe('pdf');
    expect(detectKind(makeDocx(['x']))).toBe('docx');
    expect(detectKind(strToU8('<html>'))).toBeUndefined();
  });
});
