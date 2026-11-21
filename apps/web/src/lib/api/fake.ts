import {
  createDocumentInput,
  DOCUMENT_TYPES,
  MAX_DOCUMENTS,
  MAX_UPLOAD_BYTES,
} from '@jobdeputy/shared/documents';
import { createRoleInput, MAX_ROLES, profileInput } from '@jobdeputy/shared/profile';
import { type ApiClient, ApiError, type UploadForm, type UploadOptions } from './client.ts';

/** Where the fake's upload forms point: nothing is sent anywhere. */
const UPLOAD_URL = 'https://fake-upload.invalid/';

/**
 * What the fake's server check makes of a file, by its name (the worker's own words,
 * apps/worker/src/document-worker.ts): "malware" in the name fails the scan, "unreadable" can't be
 * read; anything else is ready. "still-checking" never gets past the malware check (a screen
 * shot of the deputy at work needs a frame that holds).
 */
const OUTCOMES = [
  {
    match: /malware/i,
    status: 'rejected',
    error: 'This file failed the malware scan and was deleted.',
  },
  {
    match: /unreadable/i,
    status: 'failed',
    error: 'The file could not be processed. Please upload it again.',
  },
] as const;

/** Counted across every fake, so a résumé's ID is never reused on a page (as ULIDs aren't). */
let lastDocument = 0;

interface FakeDocument {
  view: Record<string, unknown> & { documentId: string; fileName: string };
  /** When its file arrived; the server check runs from then. */
  uploadedAt?: number;
}

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far as the API
 * does (apps/api/src/profile.ts): no profile yet is the defaults at version 0, not a 404; a saved
 * one carries what the server adds (email, homeCell, createdAt, updatedAt); a save with a stale
 * version is a conflict, and a save the API's (strict) schema refuses is refused. Target roles
 * list oldest first, stop at the API's limit (422), and a role already gone is not found. It keeps
 * each account's data apart (by whoever `user` says is signed in); anything else is not found. It
 * forgets everything on reload. Résumés list newest first and stop at 10 (422); an uploaded file
 * is checked for malware for `checkMs`, read for `checkMs` more, then is ready (or not: see
 * `OUTCOMES`); a file over 5 MB is refused by the form, as S3 refuses it.
 */
export function createFakeApi({
  delay = 200,
  checkMs = 1500,
  user = async () => 'someone@example.com',
}: {
  delay?: number;
  /** How long each stage of the server's check of an uploaded file takes. */
  checkMs?: number;
  /** Who is signed in; nobody is refused as the API would (401). */
  user?: () => Promise<string | null>;
} = {}): ApiClient {
  const profiles = new Map<string, Record<string, unknown>>();
  const roles = new Map<string, Record<string, unknown>[]>();
  const documents = new Map<string, FakeDocument[]>();
  let lastRole = 0;

  /** A résumé as the API shows it now: its status moves on with time once its file is in. */
  function documentView({ view, uploadedAt }: FakeDocument): Record<string, unknown> {
    if (uploadedAt === undefined) return view;
    const since = Date.now() - uploadedAt;
    if (since < checkMs || /still-checking/i.test(view.fileName)) {
      return { ...view, status: 'pending' };
    }
    if (since < 2 * checkMs) return { ...view, status: 'processing' };
    const outcome = OUTCOMES.find(({ match }) => match.test(view.fileName));
    return outcome
      ? { ...view, status: outcome.status, error: outcome.error }
      : { ...view, status: 'ready' };
  }

  return {
    async upload(form: UploadForm, file: Blob, { onProgress, signal }: UploadOptions = {}) {
      // Sent in four parts, so the progress is seen moving.
      for (const part of [0.25, 0.5, 0.75]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (signal?.aborted) throw signal.reason;
        onProgress?.(part);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal?.aborted) throw signal.reason;
      if (!form.url.startsWith(UPLOAD_URL)) throw new ApiError('invalid', { status: 403 });
      if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError('invalid', { status: 400 });
      }
      const key = form.fields.key;
      for (const mine of documents.values()) {
        const document = mine.find(({ view }) => view.documentId === key);
        if (document) {
          document.uploadedAt = Date.now();
          document.view = { ...document.view, sizeBytes: file.size };
        }
      }
      onProgress?.(1);
    },
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const me = await user();
      if (!me) throw new ApiError('signed-out', { status: 401 });
      const saved = profiles.get(me);
      if (path === '/me/profile' && method === 'GET') {
        return (saved ?? {
          version: 0,
          email: me,
          homeCell: 'iad',
          skills: [],
          languages: [],
          links: { other: [] },
        }) as T;
      }
      if (path === '/me/profile' && method === 'PUT') {
        // The API's own (strict) schema: a field it does not take is refused, as there.
        const checked = profileInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        const { version, ...fields } = checked.data;
        const current = typeof saved?.version === 'number' ? saved.version : 0;
        if (version !== current) throw new ApiError('conflict', { status: 409, code: 'conflict' });
        const now = new Date().toISOString();
        const next = {
          ...fields,
          version: current + 1,
          email: me,
          homeCell: 'iad',
          createdAt: (saved?.createdAt as string | undefined) ?? now,
          updatedAt: now,
        };
        profiles.set(me, next);
        return next as T;
      }
      const mine = roles.get(me) ?? [];
      if (path === '/me/roles' && method === 'GET') return { roles: mine } as T;
      if (path === '/me/roles' && method === 'POST') {
        const checked = createRoleInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        if (mine.length >= MAX_ROLES) throw new ApiError('invalid', { status: 422 });
        const now = new Date().toISOString();
        lastRole += 1;
        // A ULID's shape (26 Crockford characters), counting up so the list stays oldest first.
        const roleId = String(lastRole).padStart(26, '0');
        const role = { ...checked.data, roleId, version: 1, createdAt: now, updatedAt: now };
        roles.set(me, [...mine, role]);
        return role as T;
      }
      const myDocuments = documents.get(me) ?? [];
      if (path === '/me/documents' && method === 'GET') {
        return { documents: myDocuments.map(documentView).reverse() } as T;
      }
      if (path === '/me/documents' && method === 'POST') {
        const checked = createDocumentInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        if (myDocuments.length >= MAX_DOCUMENTS) throw new ApiError('invalid', { status: 422 });
        const now = new Date().toISOString();
        lastDocument += 1;
        const documentId = String(lastDocument).padStart(26, '0');
        const { fileName, contentType } = checked.data;
        const view = {
          documentId,
          title: fileName.replace(/\.(pdf|docx)$/i, ''),
          fileName,
          format: DOCUMENT_TYPES[contentType].format,
          status: 'pending',
          // As the API: the default when there is none (the first, or after the default went).
          isDefault: !myDocuments.some(({ view }) => view.isDefault),
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        documents.set(me, [...myDocuments, { view }]);
        return {
          document: view,
          upload: {
            url: UPLOAD_URL,
            fields: { key: documentId, 'Content-Type': contentType },
            maxBytes: MAX_UPLOAD_BYTES,
            expiresInSeconds: 300,
          },
        } as T;
      }
      const documentId = /^\/me\/documents\/([^/]+)$/.exec(path)?.[1];
      const document = myDocuments.find(({ view }) => view.documentId === documentId);
      if (document && method === 'GET') return documentView(document) as T;
      if (document && method === 'DELETE') {
        documents.set(
          me,
          myDocuments.filter((each) => each !== document),
        );
        return undefined as T;
      }
      const roleId = /^\/me\/roles\/([^/]+)$/.exec(path)?.[1];
      if (roleId && method === 'DELETE' && mine.some((role) => role.roleId === roleId)) {
        roles.set(
          me,
          mine.filter((role) => role.roleId !== roleId),
        );
        return undefined as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}

/** A body the API's schema refuses: a 400 naming each wrong field. */
function refused(issues: { path: PropertyKey[]; message: string }[]): ApiError {
  return new ApiError('invalid', {
    status: 400,
    fieldErrors: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}
