import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DocumentFormat, DocumentStatus } from '@jobdeputy/shared';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { cancelledAt } from './client.js';
import { ConcurrentUpdateError, transactWrite } from './transact.js';
import {
  countDown,
  countUp,
  DOCUMENTS_SK,
  getUsageCounter,
  repairUsageCounter,
} from './usage-counters.js';
import { VersionConflictError } from './versioned.js';

/** `documents` (docs/data-model.md). Keys: `userId`, `documentId`. */
export interface Document {
  userId: string;
  documentId: string;
  type: 'document';
  kind: 'resume';
  origin: 'uploaded';
  title: string;
  fileName: string;
  mimeType: string;
  format: DocumentFormat;
  s3Key: string;
  status: DocumentStatus;
  isDefault: boolean;
  /** Bumped by user edits (title, default) only; the worker's status changes do not conflict with them. */
  version: number;
  /** S3 ETag of the file being or last processed; re-uploads change it. */
  eTag?: string;
  sizeBytes?: number;
  parsed?: {
    textS3Key: string;
    pageCount?: number;
    charCount: number;
    noText: boolean;
    truncated: boolean;
  };
  /** Shown to the user when rejected or failed. */
  error?: string;
  /** Set only while pending: an upload that never arrives expires after 1 day. */
  ttl?: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

const PENDING_TTL_SECONDS = 24 * 60 * 60;

/** The user already has the most documents allowed. */
export class DocumentLimitError extends Error {
  override name = 'DocumentLimitError';
}
const MAX_ERROR_LENGTH = 300;

export class DocumentRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
    /** `usage`: the document counter and default marker. Needed to create, delete, and switch the default. */
    private readonly usageTable?: string,
  ) {}

  private usage(): string {
    if (!this.usageTable) throw new Error('DocumentRepository needs the usage table for this');
    return this.usageTable;
  }

  async list(userId: string): Promise<Document[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
        ConsistentRead: true,
      }),
    );
    return (res.Items ?? []) as Document[];
  }

  async get(userId: string, documentId: string): Promise<Document | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { userId, documentId },
        ConsistentRead: true,
      }),
    );
    return res.Item as Document | undefined;
  }

  /**
   * Creates a pending document, counted in the same transaction, only while fewer than
   * `maxDocuments` exist. The first document becomes the default, but only if it claims
   * the default marker in the same transaction: of two first uploads at once, exactly one
   * is the default. Pending uploads that never arrive expire without running our code, so
   * a counter that disagrees with what exists is corrected once, then the create retried.
   */
  async create(
    fields: Pick<
      Document,
      'userId' | 'documentId' | 'title' | 'fileName' | 'mimeType' | 'format' | 's3Key'
    >,
    audit: AuditWrite,
    maxDocuments: number,
  ): Promise<Document> {
    const usage = this.usage();
    const { userId, documentId } = fields;
    for (let round = 0; round < 3; round += 1) {
      const existing = await this.list(userId);
      if (existing.length >= maxDocuments) throw new DocumentLimitError();
      const isDefault = !existing.some((d) => d.isDefault);
      const at = this.now();
      const doc: Document = {
        ...fields,
        isDefault,
        type: 'document',
        kind: 'resume',
        origin: 'uploaded',
        status: 'pending',
        version: 1,
        ttl: Math.floor(at.getTime() / 1000) + PENDING_TTL_SECONDS,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        schemaVersion: 1,
      };
      try {
        await transactWrite(this.client, {
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: doc,
                ConditionExpression: 'attribute_not_exists(userId)',
              },
            },
            auditPut(audit, userId, at),
            countUp(
              usage,
              userId,
              DOCUMENTS_SK,
              maxDocuments,
              at.toISOString(),
              isDefault ? documentId : undefined,
            ),
          ],
        });
        return doc;
      } catch (error) {
        if (!cancelledAt(error, 2)) throw error;
        // The cap or the default marker disagreed: read both, and correct them to
        // what exists (a no-op when another upload simply won the default).
        const seen = await getUsageCounter(this.client, usage, userId, DOCUMENTS_SK);
        const now = await this.list(userId);
        if (now.length >= maxDocuments) throw new DocumentLimitError();
        const actualDefault = now.find((d) => d.isDefault)?.documentId;
        await repairUsageCounter(
          this.client,
          usage,
          userId,
          DOCUMENTS_SK,
          seen,
          { itemCount: now.length, ...(actualDefault ? { defaultDocumentId: actualDefault } : {}) },
          at.toISOString(),
        );
      }
    }
    throw new ConcurrentUpdateError('Documents were changed at the same moment');
  }

  /**
   * Claims a clean, scanned file for processing: a pending document, or a
   * re-upload (different ETag). Undefined for duplicates and stale events.
   */
  async startProcessing(
    userId: string,
    documentId: string,
    eTag: string,
    sizeBytes: number,
  ): Promise<Document | undefined> {
    return this.update(
      userId,
      documentId,
      'SET #status = :processing, eTag = :etag, sizeBytes = :size, updatedAt = :now REMOVE #ttl, #error, parsed',
      '(#status = :pending OR eTag <> :etag)',
      { ':processing': 'processing', ':pending': 'pending', ':etag': eTag, ':size': sizeBytes },
      { '#ttl': 'ttl', '#error': 'error' },
      undefined,
    );
  }

  /** Only for the file it processed: a newer upload (different ETag) wins. */
  async markReady(
    userId: string,
    documentId: string,
    eTag: string,
    parsed: NonNullable<Document['parsed']>,
    audit: AuditWrite,
  ): Promise<Document | undefined> {
    return this.update(
      userId,
      documentId,
      'SET #status = :ready, parsed = :parsed, updatedAt = :now',
      'eTag = :etag',
      { ':ready': 'ready', ':parsed': parsed, ':etag': eTag },
      {},
      audit,
    );
  }

  async markFailed(
    userId: string,
    documentId: string,
    reason: string,
    audit: AuditWrite,
    eTag?: string,
  ): Promise<Document | undefined> {
    return this.update(
      userId,
      documentId,
      'SET #status = :failed, #error = :error, updatedAt = :now REMOVE parsed, #ttl',
      eTag ? 'eTag = :etag' : 'attribute_exists(userId)',
      {
        ':failed': 'failed',
        ':error': reason.slice(0, MAX_ERROR_LENGTH),
        ...(eTag ? { ':etag': eTag } : {}),
      },
      { '#error': 'error', '#ttl': 'ttl' },
      audit,
    );
  }

  /** A threat always wins, whatever the current status. */
  async markRejected(
    userId: string,
    documentId: string,
    reason: string,
    audit: AuditWrite,
  ): Promise<Document | undefined> {
    return this.update(
      userId,
      documentId,
      'SET #status = :rejected, #error = :error, updatedAt = :now REMOVE parsed, eTag, #ttl',
      'attribute_exists(userId)',
      { ':rejected': 'rejected', ':error': reason.slice(0, MAX_ERROR_LENGTH) },
      { '#error': 'error', '#ttl': 'ttl' },
      audit,
    );
  }

  /** Renames; throws VersionConflictError on a stale version. Undefined if missing. */
  async rename(
    userId: string,
    documentId: string,
    title: string,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Document | undefined> {
    const current = await this.get(userId, documentId);
    if (!current) return undefined;
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    const updated = await this.update(
      userId,
      documentId,
      'SET title = :title, version = version + :one, updatedAt = :now',
      'version = :expected',
      { ':title': title, ':one': 1, ':expected': expectedVersion },
      {},
      audit,
    );
    if (!updated) throw new VersionConflictError(-1);
    return updated;
  }

  /** Makes one document the default and clears any other default, atomically. */
  async setDefault(
    userId: string,
    documentId: string,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<Document | undefined> {
    // The marker is read FIRST, then the list. The transaction requires the marker to be
    // unchanged, so a switch that lands after this read makes this one a conflict (409);
    // and when this one succeeds, the list it un-defaults from is at least as new as the
    // marker. (Reading the list first let a switch land in between: the marker condition
    // passed on a stale list, leaving two defaults. Caught by the concurrency test in CI.)
    const usage = this.usage();
    const seen = (await getUsageCounter(this.client, usage, userId, DOCUMENTS_SK))
      .defaultDocumentId;
    const all = await this.list(userId);
    const target = all.find((d) => d.documentId === documentId);
    if (!target) return undefined;
    if (target.version !== expectedVersion) throw new VersionConflictError(target.version);
    const now = this.now().toISOString();
    const others = all.filter((d) => d.isDefault && d.documentId !== documentId);
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { userId, documentId },
              UpdateExpression: 'SET isDefault = :true, version = version + :one, updatedAt = :now',
              ConditionExpression: 'version = :expected',
              ExpressionAttributeValues: {
                ':true': true,
                ':one': 1,
                ':now': now,
                ':expected': expectedVersion,
              },
            },
          },
          ...others.map((d) => ({
            Update: {
              TableName: this.tableName,
              Key: { userId, documentId: d.documentId },
              UpdateExpression: 'SET isDefault = :false, updatedAt = :now',
              ConditionExpression: 'attribute_exists(userId)',
              ExpressionAttributeValues: { ':false': false, ':now': now },
            },
          })),
          auditPut(audit, userId, this.now()),
          {
            Update: {
              TableName: usage,
              Key: { userId, sk: DOCUMENTS_SK },
              UpdateExpression: 'SET defaultDocumentId = :id, updatedAt = :now',
              ConditionExpression:
                seen === undefined
                  ? 'attribute_not_exists(defaultDocumentId)'
                  : 'defaultDocumentId = :seen',
              ExpressionAttributeValues: {
                ':id': documentId,
                ':now': now,
                ...(seen !== undefined ? { ':seen': seen } : {}),
              },
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        throw new VersionConflictError(-1);
      }
      throw error;
    }
    return { ...target, isDefault: true, version: expectedVersion + 1, updatedAt: now };
  }

  /**
   * Deletes and returns the item (so its files can be removed), with its audit entry in
   * the same transaction. Undefined if missing.
   */
  async delete(
    userId: string,
    documentId: string,
    audit: AuditWrite,
  ): Promise<Document | undefined> {
    const current = await this.get(userId, documentId);
    if (!current) return undefined;
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Delete: {
              TableName: this.tableName,
              Key: { userId, documentId },
              ConditionExpression: 'attribute_exists(userId)',
            },
          },
          auditPut(audit, userId, this.now()),
          countDown(
            this.usage(),
            userId,
            DOCUMENTS_SK,
            this.now().toISOString(),
            current.isDefault,
          ),
        ],
      });
      return current;
    } catch (error) {
      if (cancelledAt(error, 0)) return undefined;
      throw error;
    }
  }

  /**
   * A conditional update, recorded in the audit history in the same transaction when
   * `audit` is given (every change a user sees; not internal steps). Returns the item
   * after the update, or undefined when the condition failed.
   */
  private async update(
    userId: string,
    documentId: string,
    updateExpression: string,
    condition: string,
    values: Record<string, unknown>,
    names: Record<string, string>,
    audit: AuditWrite | undefined,
  ): Promise<Document | undefined> {
    const allNames = { '#status': 'status', ...names };
    const expressions = `${updateExpression} ${condition}`;
    // DynamoDB rejects unused placeholders, and an empty map: send only the ones used.
    const usedNames = Object.fromEntries(
      Object.entries(allNames).filter(([k]) => expressions.includes(k)),
    );
    const at = this.now();
    const write = {
      TableName: this.tableName,
      Key: { userId, documentId },
      UpdateExpression: updateExpression,
      ConditionExpression:
        condition === 'attribute_exists(userId)'
          ? condition
          : `attribute_exists(userId) AND ${condition}`,
      ...(Object.keys(usedNames).length > 0 ? { ExpressionAttributeNames: usedNames } : {}),
      ExpressionAttributeValues: { ':now': at.toISOString(), ...values },
    };
    try {
      await transactWrite(this.client, {
        TransactItems: [{ Update: write }, ...(audit ? [auditPut(audit, userId, at)] : [])],
      });
    } catch (error) {
      if (cancelledAt(error, 0)) return undefined;
      throw error;
    }
    // Transactions return no attributes: read the result (consistent).
    return this.get(userId, documentId);
  }
}
