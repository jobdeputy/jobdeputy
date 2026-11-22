import { type ResumeBlock, resumeBlocks, type StructuredResume } from '@jobdeputy/shared';
import pdfmake, { type Content } from 'pdfmake';
import robotoBold from 'pdfmake/fonts/Roboto/Roboto-Medium.ttf';
import robotoRegular from 'pdfmake/fonts/Roboto/Roboto-Regular.ttf';

// #51 (decision 0015): a tailored résumé as a PDF, the default download. One ATS-safe
// template: a single column, standard headings, real selectable text in an embedded font
// (Roboto covers Latin, Greek, and Cyrillic names), no tables, images, or columns. Laid out
// from the same blocks as the DOCX and the in-app preview (resumeBlocks).

type DocumentDefinition = Parameters<typeof pdfmake.createPdf>[0];

// Nothing a document names is ever read: no files, no URLs. The fonts are given as bytes.
pdfmake.setLocalAccessPolicy(() => false);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setFonts({
  Roboto: {
    normal: Buffer.from(robotoRegular),
    bold: Buffer.from(robotoBold),
    italics: Buffer.from(robotoRegular),
    bolditalics: Buffer.from(robotoBold),
  },
});

/** US Letter, 0.75 inch margins (US cell first, 0013). */
const MARGIN = 54;
const LETTER_WIDTH = 612;
const RULE = '#666666';
/**
 * Ligatures off: with them, "fi" and "fl" became one glyph that text extraction read back
 * as "f" ("Certifed"), so an ATS would miss the keyword. fontkit takes a map to turn
 * default features off (the types list only the array form, which can only turn them on).
 */
const NO_LIGATURES = { liga: false, clig: false } as unknown as ['liga'];

function block(b: ResumeBlock): Content {
  switch (b.kind) {
    case 'name':
      return { text: b.text, fontSize: 18, bold: true, margin: [0, 0, 0, 2] };
    case 'line':
      return { text: b.text, margin: [0, 0, 0, 1] };
    case 'heading':
      return {
        stack: [
          { text: b.text.toUpperCase(), fontSize: 11, bold: true },
          {
            canvas: [
              {
                type: 'line',
                x1: 0,
                y1: 2,
                x2: LETTER_WIDTH - 2 * MARGIN,
                y2: 2,
                lineWidth: 0.5,
                lineColor: RULE,
              },
            ],
          },
        ],
        margin: [0, 10, 0, 4],
      };
    case 'entry':
      return { text: b.text, bold: true, margin: [0, 4, 0, 0] };
    case 'meta':
      return { text: b.text, color: '#333333' };
    case 'bullet':
      return { ul: [b.text], margin: [6, 1, 0, 0] };
    case 'paragraph':
      return { text: b.text, margin: [0, 0, 0, 2] };
    case 'skills':
      return { text: [{ text: `${b.group}: `, bold: true }, b.items], margin: [0, 0, 0, 1] };
  }
}

/** The résumé as a PDF file. */
export async function renderResumePdf(resume: StructuredResume): Promise<Buffer> {
  const doc: DocumentDefinition = {
    pageSize: 'LETTER',
    pageMargins: MARGIN,
    info: { title: `${resume.contact.name} – Résumé`, author: resume.contact.name },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.15, fontFeatures: NO_LIGATURES },
    content: resumeBlocks(resume).map(block),
  };
  return pdfmake.createPdf(doc).getBuffer();
}
