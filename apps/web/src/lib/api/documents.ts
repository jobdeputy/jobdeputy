import {
  type CreateDocumentInput,
  createDocumentInput,
  DOCUMENT_TYPES,
  type DocumentContentType,
  type DocumentStatus,
  MAX_UPLOAD_BYTES,
} from '@jobdeputy/shared/documents';
import { useQuery } from '@tanstack/react-query';
import { type ApiClient, ApiError, isFinal, type UploadForm, useApi } from './index.ts';

/**
 * A résumé as the API shows it (apps/api/src/documents.ts `view`): after the upload, the server
 * checks it for malware (`pending`), then reads its text (`processing`), and it is `ready`; or it
 * is `rejected` (it failed the scan and was deleted) or `failed` (it could not be used), with the
 * reason in `error`, in the person's words.
 */
export interface Document {
  documentId: string;
  title: string;
  fileName: string;
  format: 'pdf' | 'docx';
  status: DocumentStatus;
  isDefault: boolean;
  version: number;
  sizeBytes?: number;
  error?: string;
  createdAt: string;
}

/** The API's answer to starting an upload: the new résumé, and the form to send its file to. */
export interface StartedUpload {
  document: Document;
  upload: UploadForm;
}

/** How often a résumé being checked is asked about again. */
export const CHECK_EVERY_MS = 2000;

/** Whether the server is still working on it (checking it, or reading it). */
export function isChecking(document: Pick<Document, 'status'>): boolean {
  return document.status === 'pending' || document.status === 'processing';
}

/** Résumés whose file this page sent since it loaded: their `pending` is known to be the scan. */
const uploadedHere = new Set<string>();

/** Notes that this résumé's file was sent from this page. */
export function markUploadedHere(documentId: string): void {
  uploadedHere.add(documentId);
}

/**
 * The résumé the set-up shows from what is saved (newest first): a ready one (the default first);
 * else one still being checked; else the newest the server couldn't use, so the person knows. One
 * `pending` whose file was not sent from this page is left out: the server shows the same for a
 * file being scanned and for an upload that never came (a closed tab; it forgets those after a
 * day), so the step can't tell which.
 */
export function startingDocument(
  saved: readonly Document[],
  sentHere: ReadonlySet<string> = uploadedHere,
): Document | null {
  const known = saved.filter(
    (document) => document.status !== 'pending' || sentHere.has(document.documentId),
  );
  const ready = known.filter((document) => document.status === 'ready');
  return (
    ready.find((document) => document.isDefault) ??
    ready[0] ??
    known.find(isChecking) ??
    known[0] ??
    null
  );
}

/** The file picker's types: each type's extension and its MIME type, as the API pairs them. */
export const ACCEPT = Object.entries(DOCUMENT_TYPES)
  .flatMap(([type, { extension }]) => [extension, type])
  .join(',');

/**
 * Why this file can't be a résumé, before anything is sent: not a PDF or DOCX, empty, over the
 * API's 5 MB, or a name the API refuses. Otherwise what to start its upload with.
 */
export function checkFile(
  file: Pick<File, 'name' | 'size' | 'type'>,
):
  | { ok: true; input: CreateDocumentInput }
  | { ok: false; reason: 'type' | 'empty' | 'size' | 'name' } {
  const contentType = contentTypeOf(file);
  if (!contentType) return { ok: false, reason: 'type' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
  const input = createDocumentInput.safeParse({ fileName: file.name, contentType });
  return input.success ? { ok: true, input: input.data } : { ok: false, reason: 'name' };
}

/**
 * The file's type by its extension, the way the API pairs them. The browser's own type is only a
 * guess from the same extension (and is empty on some systems), so the extension decides.
 */
function contentTypeOf(file: Pick<File, 'name'>): DocumentContentType | null {
  const name = file.name.toLowerCase();
  for (const [type, { extension }] of Object.entries(DOCUMENT_TYPES)) {
    if (name.endsWith(extension)) return type as DocumentContentType;
  }
  return null;
}

/** The signed-in person's résumés, newest first (as the API lists them). */
export function useDocuments() {
  const api = useApi();
  return useQuery({
    ...documentsQuery(api),
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
}

export function documentsQuery(api: ApiClient) {
  return {
    queryKey: ['documents'],
    queryFn: async () =>
      (await api.request<{ documents: Document[] }>('GET', '/me/documents')).documents,
  };
}

/**
 * One résumé (none: nothing to follow), asked about again every 2 s while the server is still
 * checking it. A failed read keeps the last answer on screen and is asked again on the next beat,
 * unless asking again can't help (signed out, account closed, or the résumé is gone).
 */
export function useDocument(initial: Document | null) {
  const api = useApi();
  const documentId = initial?.documentId;
  return useQuery({
    queryKey: ['documents', documentId ?? 'none'],
    queryFn: () => api.request<Document>('GET', `/me/documents/${documentId}`),
    enabled: initial !== null,
    initialData: initial ?? undefined,
    // A done résumé doesn't change by itself, so the list's copy stands; one being checked is read.
    staleTime: (query) => (query.state.data && isChecking(query.state.data) ? 0 : Infinity),
    refetchInterval: ({ state: { data, error } }) =>
      isFinal(error) || (error instanceof ApiError && error.kind === 'not-found')
        ? false
        : data && isChecking(data)
          ? CHECK_EVERY_MS
          : false,
    // Polled: a failed read is simply asked again on the next beat.
    retry: false,
  });
}
