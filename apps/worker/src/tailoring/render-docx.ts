import {
  type CoverLetter,
  type LetterBlock,
  letterBlocks,
  type ResumeBlock,
  resumeBlocks,
  type StructuredResume,
} from '@jobdeputy/shared';
import { BorderStyle, Document, LevelFormat, Packer, Paragraph, TextRun } from 'docx';

// #51 (decision 0015): a tailored résumé as a DOCX, for users who edit before sending. The
// same ATS-safe template as the PDF (render-pdf.ts), from the same blocks: one column, real
// paragraphs, Word's own bullet list, a standard font (Arial), no tables, text boxes, headers,
// or images. PR D: a cover letter the same way, from letterBlocks.

const FONT = 'Arial';
/** Half-points. */
const SIZE = 20;
/** Twips: US Letter, 0.75 inch margins. */
const PAGE = { width: 12_240, height: 15_840, margin: 1_080 };
const BULLETS = 'resume-bullets';

const run = (text: string, options: { bold?: boolean; size?: number } = {}) =>
  new TextRun({ text, font: FONT, size: options.size ?? SIZE, bold: options.bold ?? false });

function paragraph(b: ResumeBlock): Paragraph {
  switch (b.kind) {
    case 'name':
      return new Paragraph({
        children: [run(b.text, { bold: true, size: 36 })],
        spacing: { after: 40 },
      });
    case 'line':
      return new Paragraph({ children: [run(b.text)], spacing: { after: 20 } });
    case 'heading':
      return new Paragraph({
        children: [run(b.text.toUpperCase(), { bold: true, size: 22 })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '666666', space: 1 } },
      });
    case 'entry':
      return new Paragraph({ children: [run(b.text, { bold: true })], spacing: { before: 80 } });
    case 'meta':
      return new Paragraph({ children: [run(b.text)] });
    case 'bullet':
      return new Paragraph({
        children: [run(b.text)],
        numbering: { reference: BULLETS, level: 0 },
      });
    case 'paragraph':
      return new Paragraph({ children: [run(b.text)], spacing: { after: 40 } });
    case 'skills':
      return new Paragraph({
        children: [run(`${b.group}: `, { bold: true }), run(b.items)],
        spacing: { after: 20 },
      });
  }
}

const pageProperties = {
  page: {
    size: { width: PAGE.width, height: PAGE.height },
    margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
  },
};

/** The résumé as a DOCX file. */
export async function renderResumeDocx(resume: StructuredResume): Promise<Buffer> {
  const doc = new Document({
    title: `${resume.contact.name} – Résumé`,
    creator: resume.contact.name,
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: pageProperties,
        children: resumeBlocks(resume).map(paragraph),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Half-points: the letter's body is a size up from the résumé's. */
const LETTER_SIZE = 22;

function letterParagraph(b: LetterBlock): Paragraph {
  const text = (after: number, before = 0, bold = false, size = LETTER_SIZE) =>
    new Paragraph({ children: [run(b.text, { bold, size })], spacing: { before, after } });
  switch (b.kind) {
    case 'name':
      return text(40, 0, true, 32);
    case 'line':
      return text(0);
    case 'greeting':
      return text(200, 480);
    case 'paragraph':
      return text(200);
    case 'signoff':
      return text(40, 80);
    case 'signature':
      return text(0);
  }
}

/** A cover letter as a DOCX file, to edit before sending. */
export async function renderLetterDocx(letter: CoverLetter): Promise<Buffer> {
  const doc = new Document({
    title: `${letter.contact.name} – Cover letter`,
    creator: letter.contact.name,
    sections: [{ properties: pageProperties, children: letterBlocks(letter).map(letterParagraph) }],
  });
  return Packer.toBuffer(doc);
}
