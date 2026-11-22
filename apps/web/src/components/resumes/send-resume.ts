import { MAX_DOCUMENTS } from '@jobdeputy/shared/documents';
import { type RefObject, useEffect } from 'react';
import { refusalText } from '@/components/setup/parts.tsx';
import { copy, fill } from '@/copy/index.ts';
import { type Document, markUploadedHere, type StartedUpload } from '@/lib/api/documents.ts';
import { type ApiClient, ApiError, isFinal } from '@/lib/api/index.ts';

// Sending a résumé's file (#33): shared by Set it up step 3 and the Résumés page. The file is
// checked here first (`checkFile`), then started with the API (`POST /me/documents`) and sent to
// the presigned form, its progress reported as it goes.

/** How a send ended: in (the server checks it now), stopped by the person, or not, with why. */
export type Sent =
  | { kind: 'sent'; document: Document }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

/**
 * Starts the upload and sends the file. One started but never finished is deleted (it would wait a
 * day as an upload that never came). One that got in is noted as sent from here, so its `pending`
 * is known to be the scan.
 */
export async function sendResume(
  api: ApiClient,
  file: File,
  input: { fileName: string; contentType: string },
  { signal, onProgress }: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<Sent> {
  let started: StartedUpload | undefined;
  try {
    started = await api.request<StartedUpload>('POST', '/me/documents', input);
    if (signal.aborted) throw signal.reason;
    await api.upload(started.upload, file, { signal, onProgress });
  } catch (failure) {
    if (started) {
      const { documentId } = started.document;
      api.request('DELETE', `/me/documents/${documentId}`).catch(() => undefined);
    }
    if (signal.aborted) return { kind: 'cancelled' };
    return { kind: 'failed', reason: uploadRefusal(failure, started === undefined) };
  }
  const document: Document = { ...started.document, status: 'pending', sizeBytes: file.size };
  markUploadedHere(document.documentId);
  return { kind: 'sent', document };
}

/** Why a picked file can't be used, by what `checkFile` found. */
export function pickRefusal(reason: 'type' | 'empty' | 'size' | 'name', name: string): string {
  const text = copy.setUp.resume;
  const line = { type: text.wrongType, empty: text.empty, size: text.tooLarge, name: text.badName };
  return fill(line[reason], { name });
}

/** Why an upload didn't happen: refused when starting it (`starting`), or while sending it. */
function uploadRefusal(failure: unknown, starting: boolean): string {
  const text = copy.setUp.resume;
  if (!(failure instanceof ApiError)) return text.uploadFailed;
  if (starting && failure.status === 422) return fill(text.full, { max: String(MAX_DOCUMENTS) });
  if (starting && failure.kind === 'invalid') return text.badName;
  if (!starting && failure.kind === 'invalid') return text.uploadRefused;
  if (isFinal(failure) || failure.kind === 'too-many') return refusalText(failure);
  return text.uploadFailed;
}

/**
 * A file dropped beside the zone would be opened by the browser, leaving the app: anywhere else on
 * the page, a drop does nothing (and is shown as not allowed, rather than seeming to be taken).
 */
export function useDropOnlyOn(zone: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      if (zone.current?.contains(event.target as Node | null)) return;
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    };
    globalThis.document.addEventListener('dragover', refuse);
    globalThis.document.addEventListener('drop', refuse);
    return () => {
      globalThis.document.removeEventListener('dragover', refuse);
      globalThis.document.removeEventListener('drop', refuse);
    };
  }, [zone]);
}
