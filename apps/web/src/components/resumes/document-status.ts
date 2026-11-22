import { copy, fill } from '@/copy/index.ts';
import { type Document, wasUploadedHere } from '@/lib/api/documents.ts';

// What a résumé's line says about it: the set-up's step 3 and the Résumés page (#33).

/** Under a résumé's name: its stage while the server checks it, its kind and size once ready. */
export function statusLine(document: Document): string {
  const text = copy.setUp.resume;
  if (document.status === 'pending') {
    // Not sent from here: being scanned, or an upload that never came; the server can't tell.
    return wasUploadedHere(document.documentId) ? stageLine('checking') : text.notReady;
  }
  if (document.status === 'processing') return stageLine('reading');
  if (document.status !== 'ready') return text.notUsed;
  const format = document.format.toUpperCase();
  return document.sizeBytes === undefined
    ? format
    : fill(text.readyLine, { format, size: sizeText(document.sizeBytes) });
}

const STAGES = ['uploading', 'checking', 'reading'] as const;

export function stageLine(stage: (typeof STAGES)[number]): string {
  const text = copy.setUp.resume;
  return fill(text.stage, {
    stage: text.stages[stage],
    current: String(STAGES.indexOf(stage) + 1),
  });
}

const kilobytes = new Intl.NumberFormat(copy.locale, {
  style: 'unit',
  unit: 'kilobyte',
  maximumFractionDigits: 0,
});
const megabytes = new Intl.NumberFormat(copy.locale, {
  style: 'unit',
  unit: 'megabyte',
  maximumFractionDigits: 1,
});

/** A file's size as people read it: "180 kB", "2.4 MB" (in 1,024s, as the 5 MB limit counts). */
export function sizeText(bytes: number): string {
  return bytes < 1024 * 1024
    ? kilobytes.format(Math.max(1, Math.round(bytes / 1024)))
    : megabytes.format(bytes / (1024 * 1024));
}
