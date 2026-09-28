import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { type Document, DocumentRepository, documentClient } from '@jobdeputy/db';
import { createLogger, documentKeys } from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { z } from 'zod';
import { withDeadline } from './deadline.js';
import { type Extracted, extractDocumentText, LIMITS, RejectedFileError } from './extract.js';

const logger = createLogger('document-worker');

/** Matches the queue's maxReceiveCount (3 tries, then the dead-letter queue). */
export const MAX_RECEIVES = 3;
const SAFETY_MARGIN_MS = 5_000;

export const MESSAGES = {
  threat: 'This file failed the malware scan and was deleted.',
  unscannable:
    'This file could not be scanned for malware (for example, it is password-protected). Please upload a different file.',
  scanFailed: 'The malware scan did not complete. Please upload the file again.',
  tooLarge: 'The file is larger than 5 MB.',
  processing: 'The file could not be processed. Please upload it again.',
} as const;

/** The GuardDuty Malware Protection for S3 "Object Scan Result" event (via EventBridge). */
const scanResultEvent = z.object({
  'detail-type': z.literal('GuardDuty Malware Protection Object Scan Result'),
  detail: z.object({
    s3ObjectDetails: z.object({
      bucketName: z.string(),
      objectKey: z.string(),
      eTag: z.string(),
    }),
    scanResultDetails: z.object({
      scanResultStatus: z.enum([
        'NO_THREATS_FOUND',
        'THREATS_FOUND',
        'UNSUPPORTED',
        'ACCESS_DENIED',
        'FAILED',
      ]),
    }),
  }),
});

const ORIGINAL_KEY = /^users\/([0-9a-f-]{36})\/documents\/([0-9A-HJKMNP-TV-Z]{26})\/original$/;

export interface Storage {
  /** The file's bytes, or undefined if it changed (ETag mismatch) or is gone. */
  get(key: string, eTag: string): Promise<Uint8Array | undefined>;
  putText(key: string, text: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export interface DocumentDeps {
  repo: Pick<
    DocumentRepository,
    'get' | 'startProcessing' | 'markReady' | 'markFailed' | 'markRejected'
  >;
  storage: Storage;
  extract: (bytes: Uint8Array, format: Document['format']) => Promise<Extracted>;
  remainingMs: () => number;
}

export type Outcome =
  | 'ready'
  | 'rejected'
  | 'failed'
  | 'ignored'
  | 'orphan'
  | 'duplicate'
  | 'stale';

/** Handles one scan result. Throws only for transient errors that deserve a retry. */
export async function handleScanResult(body: unknown, deps: DocumentDeps): Promise<Outcome> {
  const event = scanResultEvent.safeParse(body);
  if (!event.success) {
    logger.error('Unexpected message shape');
    throw new Error('Malformed message');
  }
  const { objectKey, eTag } = event.data.detail.s3ObjectDetails;
  const status = event.data.detail.scanResultDetails.scanResultStatus;
  const match = ORIGINAL_KEY.exec(objectKey);
  // Our own extracted text and GuardDuty's validation object are scanned too; nothing to do.
  if (!match) return 'ignored';
  const [, userId, documentId] = match as unknown as [string, string, string];
  const { text: textKey } = documentKeys(userId, documentId);
  const keys = [objectKey, textKey];
  const ctx = { userId, documentId, scan: status };

  const doc = await deps.repo.get(userId, documentId);
  if (!doc) {
    // Uploaded after the document was deleted (or never created): keep nothing.
    await deps.storage.delete(keys);
    logger.info('Removed a file with no document', ctx);
    return 'orphan';
  }

  if (status === 'THREATS_FOUND') {
    await deps.storage.delete(keys);
    await deps.repo.markRejected(userId, documentId, MESSAGES.threat);
    logger.warn('Malware found; file deleted', ctx);
    return 'rejected';
  }
  if (status !== 'NO_THREATS_FOUND') {
    // Never keep a file we could not scan.
    await deps.storage.delete(keys);
    const reason = status === 'FAILED' ? MESSAGES.scanFailed : MESSAGES.unscannable;
    await deps.repo.markFailed(userId, documentId, reason);
    logger.warn('File could not be scanned; deleted', ctx);
    return 'failed';
  }

  const bytes = await deps.storage.get(objectKey, eTag);
  if (!bytes) return 'stale'; // replaced or deleted since the scan; a newer event follows
  if (!(await deps.repo.startProcessing(userId, documentId, eTag, bytes.length)))
    return 'duplicate';

  if (bytes.length > LIMITS.maxBytes) {
    await deps.storage.delete(keys);
    await deps.repo.markFailed(userId, documentId, MESSAGES.tooLarge, eTag);
    return 'failed';
  }

  let extracted: Extracted;
  try {
    extracted = await withDeadline(
      deps.extract(bytes, doc.format),
      deps.remainingMs() - SAFETY_MARGIN_MS,
    );
  } catch (error) {
    if (error instanceof RejectedFileError) {
      await deps.storage.delete(keys);
      await deps.repo.markFailed(userId, documentId, error.message, eTag);
      logger.info('File rejected', { ...ctx, reason: error.message });
      return 'failed';
    }
    throw error;
  }

  await deps.storage.putText(textKey, extracted.text);
  const ready = await deps.repo.markReady(userId, documentId, eTag, {
    textS3Key: textKey,
    ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
    charCount: extracted.charCount,
    noText: extracted.noText,
    truncated: extracted.truncated,
  });
  if (!ready) {
    // Deleted meanwhile (or superseded by a newer upload, which rewrites the text).
    if (!(await deps.repo.get(userId, documentId))) await deps.storage.delete(keys);
    return 'stale';
  }
  logger.info('Document ready', { ...ctx, pages: extracted.pageCount, chars: extracted.charCount });
  return 'ready';
}

export async function processRecord(record: SQSRecord, deps: DocumentDeps): Promise<Outcome> {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch {
    throw new Error('Malformed message');
  }
  try {
    return await handleScanResult(body, deps);
  } catch (error) {
    const receiveCount = Number(record.attributes.ApproximateReceiveCount);
    const parsed = scanResultEvent.safeParse(body);
    const match = parsed.success
      ? ORIGINAL_KEY.exec(parsed.data.detail.s3ObjectDetails.objectKey)
      : null;
    if (receiveCount >= MAX_RECEIVES && match?.[1] && match[2]) {
      await deps.repo.markFailed(match[1], match[2], MESSAGES.processing).catch(() => undefined);
    }
    logger.warn('Attempt failed', { receiveCount, reason: (error as Error).message });
    throw error;
  }
}

function s3Storage(bucket: string): Storage {
  const s3 = new S3Client({});
  return {
    async get(key, eTag) {
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: eTag }),
        );
        return await res.Body?.transformToByteArray();
      } catch (error) {
        const name = (error as Error).name;
        if (name === 'PreconditionFailed' || name === 'NoSuchKey') return undefined;
        throw error;
      }
    },
    async putText(key, text) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: text,
          ContentType: 'text/plain; charset=utf-8',
        }),
      );
    },
    async delete(keys) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}

let deps: DocumentDeps | undefined;
let currentContext: Context | undefined;
const processor = new BatchProcessor(EventType.SQS);

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  currentContext = context;
  if (!deps) {
    const { DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET_NAME } = process.env;
    if (!DOCUMENTS_TABLE_NAME || !DOCUMENTS_BUCKET_NAME)
      throw new Error('Table and bucket names must be set');
    deps = {
      repo: new DocumentRepository(documentClient(), DOCUMENTS_TABLE_NAME),
      storage: s3Storage(DOCUMENTS_BUCKET_NAME),
      extract: extractDocumentText,
      remainingMs: () => currentContext?.getRemainingTimeInMillis() ?? 60_000,
    };
  }
  const current = deps;
  return processPartialResponse(event, (r: SQSRecord) => processRecord(r, current), processor, {
    context,
  });
}
