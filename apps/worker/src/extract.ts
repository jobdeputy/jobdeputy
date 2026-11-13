import { unzipSync } from 'fflate';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

/** T05 decision: PDF and DOCX only, 5 MB, 20 pages. */
export const LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxPages: 20,
  /** DOCX is a ZIP: cap what it expands to (decompression bombs). */
  maxUnzippedBytes: 50 * 1024 * 1024,
  maxZipEntries: 2000,
  /** Stored text is capped so one résumé cannot bloat storage. */
  maxTextChars: 200_000,
} as const;

export type DocumentKind = 'pdf' | 'docx';

/** The user's file is unusable; retrying cannot help. The message is shown to the user. */
export class RejectedFileError extends Error {
  override name = 'RejectedFileError';
}

export interface Extracted {
  text: string;
  pageCount?: number;
  charCount: number;
  /** True when the file has no text layer (for example a scanned image PDF). */
  noText: boolean;
  truncated: boolean;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** Detects the real type from the file's signature; the declared type is never trusted. */
export function detectKind(bytes: Uint8Array): DocumentKind | undefined {
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  return undefined;
}

function finish(raw: string, pageCount?: number): Extracted {
  const normalized = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips NUL bytes from extracted text on purpose.
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = normalized.length > LIMITS.maxTextChars;
  const text = truncated ? normalized.slice(0, LIMITS.maxTextChars) : normalized;
  return {
    text,
    ...(pageCount !== undefined ? { pageCount } : {}),
    charCount: text.length,
    noText: text.length === 0,
    truncated,
  };
}

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // The bundled pdf.js has no script-evaluation path (removed after CVE-2024-4367),
    // and no fonts or resources are fetched from the network.
    // pdf.js takes ownership of (detaches) the buffer it is given, so pass a copy.
    pdf = await getDocumentProxy(bytes.slice(), { useSystemFonts: false });
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'PasswordException')
      throw new RejectedFileError('This PDF is password-protected.');
    throw new RejectedFileError('This file is not a readable PDF.');
  }
  try {
    if (pdf.numPages > LIMITS.maxPages) {
      throw new RejectedFileError(
        `This PDF has ${pdf.numPages} pages; the limit is ${LIMITS.maxPages}.`,
      );
    }
    const { text } = await extractText(pdf, { mergePages: true });
    return finish(text, pdf.numPages);
  } finally {
    await pdf.cleanup();
  }
}

function checkZip(bytes: Uint8Array): void {
  let total = 0;
  let entries = 0;
  let hasDocument = false;
  try {
    // The filter sees each entry's declared size without decompressing anything.
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        total += file.originalSize;
        if (file.name === 'word/document.xml') hasDocument = true;
        return false;
      },
    });
  } catch {
    throw new RejectedFileError('This file is not a readable DOCX.');
  }
  if (entries > LIMITS.maxZipEntries || total > LIMITS.maxUnzippedBytes) {
    throw new RejectedFileError('This DOCX expands to an unsafe size.');
  }
  if (!hasDocument) throw new RejectedFileError('This file is not a Word (DOCX) document.');
}

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  checkZip(bytes);
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return finish(result.value);
  } catch {
    throw new RejectedFileError('This file is not a readable DOCX.');
  }
}

/**
 * Checks the file against the declared type and the limits, then extracts plain text.
 * Throws RejectedFileError for anything the user must fix.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  declared: DocumentKind,
): Promise<Extracted> {
  if (bytes.length === 0) throw new RejectedFileError('The file is empty.');
  if (bytes.length > LIMITS.maxBytes) throw new RejectedFileError('The file is larger than 5 MB.');
  const actual = detectKind(bytes);
  if (actual !== declared) {
    throw new RejectedFileError(`The file content is not a valid ${declared.toUpperCase()}.`);
  }
  return actual === 'pdf' ? extractPdf(bytes) : extractDocx(bytes);
}
