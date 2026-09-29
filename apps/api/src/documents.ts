import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AccountRepository,
  type Document,
  DocumentRepository,
  documentClient,
  VersionConflictError,
} from '@jobdeputy/db';
import {
  callerFromEvent,
  createDocumentInput,
  createLogger,
  DOCUMENT_TYPES,
  DOWNLOAD_URL_SECONDS,
  documentId as documentIdSchema,
  documentKeys,
  type HttpResponse,
  json,
  MAX_DOCUMENTS,
  MAX_UPLOAD_BYTES,
  parseJsonBody,
  problem,
  UPLOAD_URL_SECONDS,
  updateDocumentInput,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { type UserAudit, userAudit } from './audited.js';

const logger = createLogger('api-documents');

export interface Upload {
  url: string;
  fields: Record<string, string>;
}

export interface DocumentsDeps {
  repo: Pick<DocumentRepository, 'list' | 'get' | 'create' | 'rename' | 'setDefault' | 'delete'>;
  /** A browser POST that S3 accepts only for this key, type, and size, for 5 minutes. */
  presignUpload: (key: string, contentType: string) => Promise<Upload>;
  /** A 5-minute download link, sent as an attachment. */
  presignDownload: (key: string, fileName: string) => Promise<string>;
  deleteFiles: (keys: string[]) => Promise<void>;
  newId: () => string;
  isBeingDeleted: (userId: string) => Promise<boolean>;
  /** Every change is recorded in the user's audit history, in the same transaction (T06d). */
  audit: UserAudit;
}

function s3Deps(
  bucket: string,
): Pick<DocumentsDeps, 'presignUpload' | 'presignDownload' | 'deleteFiles'> {
  const s3 = new S3Client({});
  return {
    presignUpload: async (key, contentType) =>
      createPresignedPost(s3, {
        Bucket: bucket,
        Key: key,
        // S3 itself enforces these; nothing else can be uploaded with this form.
        Conditions: [
          ['content-length-range', 1, MAX_UPLOAD_BYTES],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: UPLOAD_URL_SECONDS,
      }),
    presignDownload: async (key, fileName) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\x20-\x7e]|"/g, '_')}"`,
        }),
        { expiresIn: DOWNLOAD_URL_SECONDS },
      ),
    deleteFiles: async (keys) => {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}

function defaultDeps(): DocumentsDeps {
  const { DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET_NAME, USERS_TABLE_NAME, AUDIT_TABLE_NAME } =
    process.env;
  if (!DOCUMENTS_TABLE_NAME || !DOCUMENTS_BUCKET_NAME || !USERS_TABLE_NAME || !AUDIT_TABLE_NAME) {
    throw new Error('Table and bucket names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  return {
    repo: new DocumentRepository(client, DOCUMENTS_TABLE_NAME),
    ...s3Deps(DOCUMENTS_BUCKET_NAME),
    newId: ulid,
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    audit: userAudit(AUDIT_TABLE_NAME, ulid),
  };
}

/** What the API shows: no storage keys, internal fields, or S3 paths. */
function view(d: Document) {
  return {
    documentId: d.documentId,
    title: d.title,
    fileName: d.fileName,
    format: d.format,
    status: d.status,
    isDefault: d.isDefault,
    version: d.version,
    ...(d.sizeBytes !== undefined ? { sizeBytes: d.sizeBytes } : {}),
    ...(d.parsed
      ? {
          text: {
            ...(d.parsed.pageCount !== undefined ? { pageCount: d.parsed.pageCount } : {}),
            charCount: d.parsed.charCount,
            noText: d.parsed.noText,
            truncated: d.parsed.truncated,
          },
        }
      : {}),
    ...(d.error ? { error: d.error } : {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

const titleOf = (fileName: string) => fileName.replace(/\.(pdf|docx)$/i, '');

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** The caller's own résumés (T05c). The user is always the token's `sub`. */
export async function route(event: Event, deps: DocumentsDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const { userId } = caller;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;
  const notFound = () => problem(404, 'Not found', { requestId });

  const raw = () => parseJsonBody(event.body, event.isBase64Encoded);
  const id = () => documentIdSchema.safeParse(event.pathParameters?.documentId);

  try {
    switch (event.routeKey) {
      case 'POST /me/documents': {
        const body = raw();
        if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
        const input = createDocumentInput.safeParse(body);
        if (!input.success) return validationProblem(input.error, requestId);
        const existing = await deps.repo.list(userId);
        if (existing.length >= MAX_DOCUMENTS) {
          return problem(422, 'Document limit reached', {
            detail: `You can keep at most ${MAX_DOCUMENTS} résumés. Delete one first.`,
            requestId,
          });
        }
        const documentId = deps.newId();
        const s3Key = documentKeys(userId, documentId).original;
        const doc = await deps.repo.create(
          {
            userId,
            documentId,
            title: titleOf(input.data.fileName),
            fileName: input.data.fileName,
            mimeType: input.data.contentType,
            format: DOCUMENT_TYPES[input.data.contentType].format,
            s3Key,
            isDefault: !existing.some((d) => d.isDefault),
          },
          deps.audit(
            'document.upload_started',
            { type: 'document', id: documentId },
            'Résumé upload started',
          ),
        );
        const upload = await deps.presignUpload(s3Key, input.data.contentType);
        logger.info('Upload started', { documentId });
        return json(201, {
          document: view(doc),
          upload: { ...upload, maxBytes: MAX_UPLOAD_BYTES, expiresInSeconds: UPLOAD_URL_SECONDS },
        });
      }
      case 'GET /me/documents': {
        const docs = await deps.repo.list(userId);
        docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json(200, { documents: docs.map(view) });
      }
      case 'GET /me/documents/{documentId}': {
        const parsed = id();
        if (!parsed.success) return validationProblem(parsed.error, requestId);
        const doc = await deps.repo.get(userId, parsed.data);
        if (!doc) return notFound();
        // Only clean, processed files can be downloaded.
        const downloadUrl =
          doc.status === 'ready' ? await deps.presignDownload(doc.s3Key, doc.fileName) : undefined;
        return json(200, { ...view(doc), ...(downloadUrl ? { downloadUrl } : {}) });
      }
      case 'PUT /me/documents/{documentId}': {
        const parsed = id();
        if (!parsed.success) return validationProblem(parsed.error, requestId);
        const body = raw();
        if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
        const input = updateDocumentInput.safeParse(body);
        if (!input.success) return validationProblem(input.error, requestId);
        let doc: Document | undefined;
        let version = input.data.version;
        if (input.data.title !== undefined) {
          doc = await deps.repo.rename(
            userId,
            parsed.data,
            input.data.title,
            version,
            deps.audit('document.renamed', { type: 'document', id: parsed.data }, 'Résumé renamed'),
          );
          if (!doc) return notFound();
          version = doc.version;
        }
        if (input.data.isDefault) {
          doc = await deps.repo.setDefault(
            userId,
            parsed.data,
            version,
            deps.audit(
              'document.default_changed',
              { type: 'document', id: parsed.data },
              'Default résumé changed',
            ),
          );
          if (!doc) return notFound();
        }
        return json(200, view(doc as Document));
      }
      case 'DELETE /me/documents/{documentId}': {
        const parsed = id();
        if (!parsed.success) return validationProblem(parsed.error, requestId);
        const doc = await deps.repo.delete(
          userId,
          parsed.data,
          deps.audit('document.deleted', { type: 'document', id: parsed.data }, 'Résumé deleted'),
        );
        if (!doc) return notFound();
        await deps.deleteFiles([doc.s3Key, documentKeys(userId, doc.documentId).text]);
        return { statusCode: 204, headers: {}, body: '' };
      }
      default:
        return notFound();
    }
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return problem(409, 'Conflict', {
        detail: 'This was changed elsewhere. Reload, then try again.',
        requestId,
      });
    }
    throw error;
  }
}

let deps: DocumentsDeps | undefined;

export async function handler(event: Event, context: Context): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
