import { inflateSync } from 'node:zlib';
import {
  type CoverLetter,
  letterBlocks,
  resumeBlocks,
  type StructuredResume,
} from '@jobdeputy/shared';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractDocumentText } from '../src/extract.js';
import { renderLetterDocx, renderResumeDocx } from '../src/tailoring/render-docx.js';
import { renderLetterPdf, renderResumePdf } from '../src/tailoring/render-pdf.js';

const resume: StructuredResume = {
  contact: {
    name: 'Łukasz Ελένη Example',
    headline: 'Backend engineer',
    email: 'sam@example.com',
    phone: '(555) 010-1234',
    location: 'Austin, TX',
    links: ['github.com/sam-example'],
  },
  summary: 'Backend engineer with 5 years building APIs on AWS serverless with Node.js.',
  skills: [
    { group: 'Languages', items: ['TypeScript', 'C++', 'SQL'] },
    { group: 'Cloud', items: ['AWS Lambda', 'DynamoDB'] },
  ],
  experience: [
    {
      id: 'e1',
      employer: 'Example Logistics',
      title: 'Software Engineer',
      location: 'Austin, TX',
      start: 'Mar 2022',
      end: 'Present',
      bullets: [
        'Built REST APIs in Node.js and TypeScript on AWS Lambda serving 2 million requests a day, with retries, idempotency keys, and alarms for every queue.',
        'Cut p99 latency by 40% by moving order tracking to DynamoDB.',
        'Certified the official workflow for financial filings.',
      ],
    },
  ],
  education: [
    {
      id: 'd1',
      school: 'University of Example',
      degree: 'BSc',
      field: 'Computer Science',
      end: '2019',
      details: [],
    },
  ],
  certifications: [{ id: 'c1', name: 'AWS Certified Developer – Associate', issuer: 'AWS' }],
  projects: [{ id: 'p1', name: 'Queue monitor', bullets: ['Open-source CLI for SQS depth.'] }],
};

/** Every line of the template, as the reader sees it, in order. */
const expectedLines = resumeBlocks(resume).map((b) =>
  b.kind === 'skills'
    ? `${b.group}: ${b.items}`
    : b.kind === 'heading'
      ? b.text.toUpperCase()
      : b.text,
);

/** Every compressed stream in a PDF, inflated. */
function streams(pdf: Buffer): string[] {
  const out: string[] = [];
  const raw = pdf.toString('latin1');
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf('endstream', start);
    try {
      out.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
    } catch {
      // Not compressed with Flate (font data, for example).
    }
  }
  return out;
}

const words = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Each expected line appears, after the one before it. */
function expectInOrder(text: string, lines: string[] = expectedLines) {
  const flat = words(text);
  let from = 0;
  for (const line of lines) {
    const at = flat.indexOf(words(line), from);
    expect(at, `"${line}" (in order)`).toBeGreaterThanOrEqual(from);
    from = at + words(line).length;
  }
}

describe('renderResumePdf', () => {
  it('is a PDF whose text layer reads every line in order, accents and Greek included', async () => {
    const pdf = await renderResumePdf(resume);
    const read = await extractDocumentText(new Uint8Array(pdf), 'pdf');
    expect(read.noText).toBe(false);
    expect(read.pageCount).toBe(1);
    expectInOrder(read.text);
    expect(read.text).toContain('Certified the official workflow for financial filings.');
  });

  it('draws no ligatures: every glyph is one letter, so any parser reads "fi" as "fi"', async () => {
    // Some parsers read a ligature glyph back as "f" ("Certifed"); pdf.js does not, so the
    // test reads the font's own glyph-to-text map (ToUnicode), where a ligature is one glyph
    // mapped to two letters.
    const pdf = await renderResumePdf(resume);
    const maps = streams(pdf).filter((s) => s.includes('begincmap'));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) expect(map).not.toMatch(/<0066 00(?:69|6c|66)/i);
  });

  it('embeds its font, has its title, and draws no images', async () => {
    const pdf = (await renderResumePdf(resume)).toString('latin1');
    expect(pdf).toMatch(/\/FontFile2 /);
    expect(pdf).toContain('Roboto');
    expect(pdf).not.toMatch(/\/Subtype \/Image/);
    // The document's title (pdfkit writes it as an object of its own).
    expect(pdf).toMatch(/\/Title \d+ 0 R/);
  });

  it('runs onto a second page for a long résumé, still in order', async () => {
    const long: StructuredResume = {
      ...resume,
      experience: Array.from({ length: 8 }, (_, i) => ({
        id: `e${i + 1}`,
        employer: `Example Company ${i + 1}`,
        title: 'Software Engineer',
        bullets: Array.from({ length: 8 }, (_, k) => `Shipped feature ${i}-${k} for the team.`),
      })),
    };
    const read = await extractDocumentText(new Uint8Array(await renderResumePdf(long)), 'pdf');
    expect(read.pageCount).toBeGreaterThan(1);
    expect(read.text).toContain('Shipped feature 7-7 for the team.');
  });
});

describe('renderResumeDocx', () => {
  it('is a DOCX whose text reads every line in order', async () => {
    const docx = await renderResumeDocx(resume);
    const read = await extractDocumentText(new Uint8Array(docx), 'docx');
    expect(read.noText).toBe(false);
    expectInOrder(read.text);
  });

  it('uses real bullet lists and Arial, with no tables, images, or text boxes', async () => {
    const files = unzipSync(new Uint8Array(await renderResumeDocx(resume)));
    const xml = strFromU8(files['word/document.xml'] as Uint8Array);
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).not.toMatch(/<w:tbl>|<w:drawing>|<w:txbxContent>/);
    expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(false);
  });
});

// #51 PR D: the cover letter, from the same blocks in both files.
const letter: CoverLetter = {
  contact: resume.contact,
  company: 'Example Cloud',
  jobTitle: 'Backend Engineer',
  paragraphs: [
    'I am applying for the Backend Engineer role at Example Cloud, where the team builds APIs.',
    'At Example Logistics I built REST APIs in Node.js and TypeScript on AWS Lambda.',
    'Thank you for reading my letter.',
  ],
};
const letterLines = letterBlocks(letter).map((b) => b.text);

describe('renderLetterPdf and renderLetterDocx', () => {
  it('lays out the header, greeting, body, sign-off, and name, in order', () => {
    expect(letterBlocks(letter).map((b) => b.kind)).toEqual([
      'name',
      'line',
      'greeting',
      'paragraph',
      'paragraph',
      'paragraph',
      'signoff',
      'signature',
    ]);
    expect(letterLines[1]).toBe(
      'sam@example.com | (555) 010-1234 | Austin, TX | github.com/sam-example',
    );
  });

  it('is a PDF whose text reads every line in order, with its title', async () => {
    const pdf = await renderLetterPdf(letter);
    const read = await extractDocumentText(new Uint8Array(pdf), 'pdf');
    expect(read.noText).toBe(false);
    expectInOrder(read.text, letterLines);
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('is a DOCX whose text reads every line in order, in Arial, with no tables', async () => {
    const docx = await renderLetterDocx(letter);
    const read = await extractDocumentText(new Uint8Array(docx), 'docx');
    expectInOrder(read.text, letterLines);
    const xml = strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml'] as Uint8Array);
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).not.toMatch(/<w:tbl>|<w:drawing>|<w:txbxContent>/);
  });
});
