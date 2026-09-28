import { strToU8, zipSync } from 'fflate';

/**
 * Synthetic test files built in code. Never commit or use real résumés.
 */

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A valid one-page-per-entry PDF whose pages contain the given lines as real text. */
export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: pages, 3: font; then per page: page object + content stream.
  const fontId = 3;
  let next = 4;
  const pageObjects: string[] = [];
  for (const lines of pages) {
    const pageId = next++;
    const contentId = next++;
    pageIds.push(pageId);
    const ops = lines
      .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${escapePdfText(line)}) Tj ET`)
      .join('\n');
    pageObjects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageObjects[contentId] = `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`;
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let id = 4; id < next; id++) objects[id] = pageObjects[id] as string;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < next; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

/** A minimal valid DOCX with one paragraph per line. */
export function makeDocx(lines: string[]): Uint8Array {
  const xmlEscape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = lines.map((l) => `<w:p><w:r><w:t>${xmlEscape(l)}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
  });
}

/** A ZIP that expands to `megabytes` of zeros: a decompression-bomb stand-in named like a DOCX. */
export function makeZipBomb(megabytes: number): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': new Uint8Array(megabytes * 1024 * 1024),
    },
    { level: 9 },
  );
}

/**
 * The industry-standard EICAR anti-virus test file (harmless; every scanner
 * reports it as a threat). Assembled at runtime so no file in the repository
 * trips a developer's local anti-virus.
 */
export function makeEicar(): Uint8Array {
  const parts = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'];
  return strToU8(parts.join(''));
}
