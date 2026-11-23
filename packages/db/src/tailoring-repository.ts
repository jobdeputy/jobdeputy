import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BatchWriteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  type AiSource,
  type JobKeyword,
  type StructuredResume,
  type TailoringError,
  utcMonth,
} from '@jobdeputy/shared';
import { decodeTime } from 'ulid';
import { type AiUsageRecord, aiUsageUpdate } from './ai-usage-repository.js';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { cancelledAt, isConditionFailure } from './client.js';
import { transactWrite } from './transact.js';

/**
 * #51 (decision 0015): a tailored résumé, one version for a company: a `documents` item with
 * `origin: generated` (docs/data-model.md). The API creates it `queued`; the documents stream
 * starts the tailoring worker, which makes the files and ends it `ready` or `failed`.
 */
export interface GeneratedDocument {
  userId: string;
  documentId: string;
  type: 'document';
  kind: 'resume';
  origin: 'generated';
  status: 'queued' | 'processing' | 'ready' | 'failed';
  title: string;
  /** The PDF's download name ("Sam Example – Example Cloud.pdf"); set when ready. */
  fileName?: string;
  companyKey: string;
  companyName?: string;
  /** The company's shown jobs when the run was asked for (at most 3), best first. */
  jobIds: string[];
  /** The uploaded résumé it was made from. */
  baseDocumentId: string;
  aiSource: AiSource;
  /** Counted against the free platform allowance (given back when no model call was made). */
  platformRun: boolean;
  tailoring: TailoringRun;
  generation?: Generation;
  /** The PDF (the default download); set when ready. */
  s3Key?: string;
  sizeBytes?: number;
  error?: TailoringError;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export interface TailoringRun {
  /** Task calls stored so far, across retries of the message (decision 0002: at most 5). */
  calls: number;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  /** ok: every job reaches the threshold; partial: kept below it (decision 0015). */
  result?: 'ok' | 'partial';
  scores?: JobScoreRecord[];
  /** Share of the base résumé's text its structured copy covers (0–1). */
  coverage?: number;
  /**
   * The kept draft's scores and result, saved (with `resume.json` in S3) before the files are
   * rendered: a retry renders this draft instead of calling the model again.
   */
  drafted?: boolean;
  /** The kept draft itself, with `drafted`: a retry renders exactly this résumé. */
  draftResume?: StructuredResume;
  /** `tailor-resume@v1`, and the score's code version. */
  promptVersion?: string;
  scoreVersion?: number;
}

export interface JobScoreRecord {
  jobId: string;
  /** The base résumé's score and the tailored one's (null: no keyword that counts). */
  base: number | null;
  tailored: number | null;
  missingProven: string[];
  missingUnproven: string[];
}

export interface Generation {
  keySource: 'platform' | 'own';
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** A job's keywords, cached by its description hash (decision 0015). */
export interface JobKeywordsCache {
  descriptionHash: string;
  promptVersion: string;
  terms: JobKeyword[];
}

export interface FinishInput {
  userId: string;
  documentId: string;
  companyKey: string;
  outcome:
    | {
        status: 'ready';
        s3Key: string;
        sizeBytes: number;
        fileName: string;
        tailoring: Pick<
          TailoringRun,
          'result' | 'scores' | 'coverage' | 'promptVersion' | 'scoreVersion'
        >;
      }
    | { status: 'failed'; error: TailoringError; giveBack: boolean };
  audit: AuditWrite;
}

export interface TailoringTables {
  documents: string;
  usage: string;
  audit: string;
  jobs: string;
}

/** The month's free tailoring runs are used up. */
export class TailoringAllowanceError extends Error {
  override name = 'TailoringAllowanceError';
}
/** A run for this company is already queued or running. */
export class TailoringBusyError extends Error {
  override name = 'TailoringBusyError';
  constructor(readonly activeId: string) {
    super('A tailoring run for this company is already in progress');
  }
}
/**
 * Another delivery of the same message stored a call meanwhile: this delivery stops without
 * ending the run, and its message is tried again (by then the run has moved on or ended).
 */
export class TailoringConflictError extends Error {
  override name = 'TailoringConflictError';
}

const lockSk = (companyKey: string) => `TAILOR#${companyKey}`;
const DOC_ITEM = 0;
const MONTH_ITEM = 2;
const LOCK_ITEM = 3;

export class TailoringRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: TailoringTables,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Asks for a run, in one transaction: the queued version, its audit entry, the free
   * platform allowance (a string set of document IDs in `MONTH#`, only while it has room), and
   * the company's lock (one run at a time; a lock older than `staleMs` is taken over).
   */
  async request(
    doc: Omit<
      GeneratedDocument,
      | 'type'
      | 'kind'
      | 'origin'
      | 'status'
      | 'tailoring'
      | 'createdAt'
      | 'updatedAt'
      | 'schemaVersion'
    >,
    audit: AuditWrite,
    limits: { perMonth: number; staleMs: number },
  ): Promise<GeneratedDocument> {
    const at = this.now();
    const now = at.toISOString();
    const item: GeneratedDocument = {
      ...doc,
      type: 'document',
      kind: 'resume',
      origin: 'generated',
      status: 'queued',
      tailoring: { calls: 0, attempts: 0 },
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };
    const { userId, documentId } = doc;
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Put: {
              TableName: this.tables.documents,
              Item: item,
              ConditionExpression: 'attribute_not_exists(userId)',
            },
          },
          auditPut(audit, userId, at),
          {
            Update: {
              TableName: this.tables.usage,
              Key: { userId, sk: `MONTH#${utcMonth(at)}` },
              UpdateExpression: `SET #type = :month, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one${doc.platformRun ? ' ADD tailoringRunIds :id' : ''}`,
              ...(doc.platformRun
                ? {
                    ConditionExpression:
                      'attribute_not_exists(tailoringRunIds) OR size(tailoringRunIds) < :perMonth',
                  }
                : {}),
              ExpressionAttributeNames: { '#type': 'type' },
              ExpressionAttributeValues: {
                ':month': 'usage_month',
                ':now': now,
                ':one': 1,
                ...(doc.platformRun
                  ? { ':id': new Set([documentId]), ':perMonth': limits.perMonth }
                  : {}),
              },
            },
          },
          {
            Update: {
              TableName: this.tables.usage,
              Key: { userId, sk: lockSk(doc.companyKey) },
              UpdateExpression:
                'SET activeId = :id, activeSince = :now, companyKey = :company, #type = :lock, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
              ConditionExpression: 'attribute_not_exists(activeId) OR activeSince < :stale',
              ExpressionAttributeNames: { '#type': 'type' },
              ExpressionAttributeValues: {
                ':id': documentId,
                ':now': now,
                ':company': doc.companyKey,
                ':lock': 'usage_tailoring',
                ':one': 1,
                ':stale': new Date(at.getTime() - limits.staleMs).toISOString(),
              },
            },
          },
        ],
      });
      return item;
    } catch (error) {
      if (cancelledAt(error, MONTH_ITEM)) throw new TailoringAllowanceError();
      if (cancelledAt(error, LOCK_ITEM)) {
        const lock = await this.lock(userId, doc.companyKey);
        throw new TailoringBusyError(lock ?? '');
      }
      if (cancelledAt(error, DOC_ITEM)) throw new Error('Document ID already used');
      throw error;
    }
  }

  /** The run holding the company's lock, if any. */
  async lock(userId: string, companyKey: string): Promise<string | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.usage,
        Key: { userId, sk: lockSk(companyKey) },
        ConsistentRead: true,
      }),
    );
    return res.Item?.activeId as string | undefined;
  }

  /** The free runs used this month. */
  async platformRunsUsed(userId: string, at: Date): Promise<number> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.usage,
        Key: { userId, sk: `MONTH#${utcMonth(at)}` },
        ConsistentRead: true,
      }),
    );
    const ids = res.Item?.tailoringRunIds;
    return ids instanceof Set ? ids.size : 0;
  }

  async get(userId: string, documentId: string): Promise<GeneratedDocument | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.documents,
        Key: { userId, documentId },
        ConsistentRead: true,
      }),
    );
    const item = res.Item as GeneratedDocument | undefined;
    return item?.origin === 'generated' ? item : undefined;
  }

  /** The versions for one company (or every company), newest first. */
  async list(userId: string, companyKey?: string): Promise<GeneratedDocument[]> {
    const items: GeneratedDocument[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.tables.documents,
          KeyConditionExpression: 'userId = :u',
          FilterExpression: companyKey
            ? 'origin = :generated AND companyKey = :company'
            : 'origin = :generated',
          ExpressionAttributeValues: {
            ':u': userId,
            ':generated': 'generated',
            ...(companyKey ? { ':company': companyKey } : {}),
          },
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      items.push(...((res.Items ?? []) as GeneratedDocument[]));
      start = res.LastEvaluatedKey;
    } while (start);
    // ULIDs sort by time.
    return items.sort((a, b) => b.documentId.localeCompare(a.documentId));
  }

  /**
   * Claims an attempt: a queued or processing version becomes processing, `attempts` + 1.
   * Undefined when it has ended (a replayed or duplicate message).
   */
  async claim(userId: string, documentId: string): Promise<GeneratedDocument | undefined> {
    const now = this.now().toISOString();
    try {
      const res = await this.client.send(
        new UpdateCommand({
          TableName: this.tables.documents,
          Key: { userId, documentId },
          UpdateExpression:
            'SET #status = :processing, tailoring.attempts = tailoring.attempts + :one, tailoring.startedAt = if_not_exists(tailoring.startedAt, :now), updatedAt = :now',
          ConditionExpression: 'origin = :generated AND #status IN (:queued, :processing)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':processing': 'processing',
            ':queued': 'queued',
            ':generated': 'generated',
            ':one': 1,
            ':now': now,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes as GeneratedDocument;
    } catch (error) {
      if (isConditionFailure(error)) return undefined;
      throw error;
    }
  }

  /**
   * Stores one task call: the run's call count and `generation` totals, and the tokens in
   * `usage`, in one transaction; only if the run is still at `callsBefore` calls (else
   * TailoringConflictError), so a retried message never counts a call twice.
   */
  async saveCall(input: {
    userId: string;
    documentId: string;
    callsBefore: number;
    generation: Generation;
    usage: AiUsageRecord;
  }): Promise<void> {
    const at = this.now();
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.documents,
              Key: { userId: input.userId, documentId: input.documentId },
              UpdateExpression:
                'SET tailoring.calls = :calls, generation = :generation, updatedAt = :now',
              ConditionExpression: '#status = :processing AND tailoring.calls = :before',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':calls': input.callsBefore + 1,
                ':generation': input.generation,
                ':now': at.toISOString(),
                ':processing': 'processing',
                ':before': input.callsBefore,
              },
            },
          },
          aiUsageUpdate(this.tables.usage, input.userId, at, input.usage),
        ],
      });
    } catch (error) {
      if (cancelledAt(error, 0)) throw new TailoringConflictError();
      throw error;
    }
  }

  /**
   * Ends a run, in one transaction: the version `ready` (with its files and scores) or
   * `failed`; the company's lock freed (only while it is still this run's: a stale lock may
   * have been taken over by a newer run, which keeps it); and the audit entry. A platform run
   * that made no model call is given back. False if the run had ended already.
   */
  async finish(input: FinishInput): Promise<boolean> {
    try {
      await this.end(input, true);
    } catch (error) {
      if (cancelledAt(error, 0)) return false;
      if (!cancelledAt(error, 1)) throw error;
      try {
        await this.end(input, false);
      } catch (again) {
        if (cancelledAt(again, 0)) return false;
        throw again;
      }
    }
    if (input.outcome.status === 'failed' && input.outcome.giveBack) {
      await this.giveBack(input.userId, input.documentId);
    }
    return true;
  }

  private async end(input: FinishInput, freeLock: boolean): Promise<void> {
    const { userId, documentId, outcome } = input;
    const at = this.now();
    const now = at.toISOString();
    const ready = outcome.status === 'ready';
    const sets = [
      '#status = :status',
      'tailoring.finishedAt = :now',
      'updatedAt = :now',
      ...(ready
        ? [
            's3Key = :s3Key',
            'sizeBytes = :size',
            'fileName = :fileName',
            'tailoring.#result = :result',
            'tailoring.scores = :scores',
            'tailoring.promptVersion = :promptVersion',
            'tailoring.scoreVersion = :scoreVersion',
            ...(outcome.tailoring.coverage !== undefined ? ['tailoring.coverage = :coverage'] : []),
          ]
        : ['#error = :error']),
    ];
    await transactWrite(this.client, {
      TransactItems: [
        {
          Update: {
            TableName: this.tables.documents,
            Key: { userId, documentId },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ConditionExpression: '#status IN (:queued, :processing)',
            ExpressionAttributeNames: {
              '#status': 'status',
              ...(ready ? { '#result': 'result' } : { '#error': 'error' }),
            },
            ExpressionAttributeValues: {
              ':status': outcome.status,
              ':now': now,
              ':queued': 'queued',
              ':processing': 'processing',
              ...(ready
                ? {
                    ':s3Key': outcome.s3Key,
                    ':size': outcome.sizeBytes,
                    ':fileName': outcome.fileName,
                    ':result': outcome.tailoring.result,
                    ':scores': outcome.tailoring.scores,
                    ':promptVersion': outcome.tailoring.promptVersion,
                    ':scoreVersion': outcome.tailoring.scoreVersion,
                    ...(outcome.tailoring.coverage !== undefined
                      ? { ':coverage': outcome.tailoring.coverage }
                      : {}),
                  }
                : { ':error': outcome.error }),
            },
          },
        },
        ...(freeLock
          ? [
              {
                Update: {
                  TableName: this.tables.usage,
                  Key: { userId, sk: lockSk(input.companyKey) },
                  UpdateExpression: 'REMOVE activeId, activeSince SET updatedAt = :now',
                  ConditionExpression: 'activeId = :id',
                  ExpressionAttributeValues: { ':id': documentId, ':now': now },
                },
              },
            ]
          : []),
        auditPut(input.audit, userId, at),
      ],
    });
  }

  /**
   * Gives a free run back (a string set: idempotent). In the month the run was asked for:
   * its ID is a ULID, so its own time says which month that was. Only where the run was
   * counted: an item without the set is never created or touched.
   */
  private async giveBack(userId: string, documentId: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.usage,
          Key: { userId, sk: `MONTH#${utcMonth(new Date(decodeTime(documentId)))}` },
          UpdateExpression: 'DELETE tailoringRunIds :id SET updatedAt = :now',
          ConditionExpression: 'contains(tailoringRunIds, :one)',
          ExpressionAttributeValues: {
            ':id': new Set([documentId]),
            ':one': documentId,
            ':now': this.now().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  /**
   * Keeps the chosen draft on the version (the résumé, its scores, and the company's name),
   * once per run and only while it is processing: a retry renders it rather than tailoring
   * again. False when the run had ended or another delivery kept its own draft first.
   */
  async saveDraft(
    userId: string,
    documentId: string,
    draft: Pick<TailoringRun, 'result' | 'scores' | 'coverage' | 'promptVersion' | 'scoreVersion'>,
    resume: StructuredResume,
    companyName: string,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.documents,
          Key: { userId, documentId },
          UpdateExpression: `SET tailoring.drafted = :true, tailoring.draftResume = :resume, tailoring.#result = :result, tailoring.scores = :scores, tailoring.promptVersion = :promptVersion, tailoring.scoreVersion = :scoreVersion${draft.coverage !== undefined ? ', tailoring.coverage = :coverage' : ''}, companyName = if_not_exists(companyName, :company), updatedAt = :now`,
          // One draft per run: a duplicate delivery's later draft is refused.
          ConditionExpression: '#status = :processing AND attribute_not_exists(tailoring.drafted)',
          ExpressionAttributeNames: { '#status': 'status', '#result': 'result' },
          ExpressionAttributeValues: {
            ':true': true,
            ':resume': resume,
            ':result': draft.result,
            ':scores': draft.scores,
            ':promptVersion': draft.promptVersion,
            ':scoreVersion': draft.scoreVersion,
            ...(draft.coverage !== undefined ? { ':coverage': draft.coverage } : {}),
            ':company': companyName,
            ':now': this.now().toISOString(),
            ':processing': 'processing',
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  /** Caches a job's grounded keywords; skipped when the job has gone. */
  async saveKeywords(userId: string, jobId: string, keywords: JobKeywordsCache): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tables.jobs,
          Key: { userId, jobId },
          UpdateExpression: 'SET keywords = :keywords, updatedAt = :now',
          ConditionExpression: 'attribute_exists(userId)',
          ExpressionAttributeValues: {
            ':keywords': keywords,
            ':now': this.now().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
  }

  /** Points each job at the version made for it, with its score; jobs that have gone are skipped. */
  async saveMatches(
    userId: string,
    documentId: string,
    scores: JobScoreRecord[],
    scoreVersion: number,
  ): Promise<void> {
    const now = this.now().toISOString();
    for (const s of scores) {
      try {
        await this.client.send(
          new UpdateCommand({
            TableName: this.tables.jobs,
            Key: { userId, jobId: s.jobId },
            UpdateExpression: 'SET #match = :match, materials = :materials, updatedAt = :now',
            ConditionExpression: 'attribute_exists(userId)',
            ExpressionAttributeNames: { '#match': 'match' },
            ExpressionAttributeValues: {
              ':match': {
                resumeDocumentId: documentId,
                score: s.tailored,
                base: s.base,
                missing: [...s.missingProven, ...s.missingUnproven],
                version: scoreVersion,
                scoredAt: now,
              },
              ':materials': { resumeDocumentId: documentId },
              ':now': now,
            },
          }),
        );
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
      }
    }
  }

  /** Deletes version items (their files are the caller's), 25 at a time. */
  async deleteVersions(userId: string, documentIds: string[]): Promise<void> {
    for (let i = 0; i < documentIds.length; i += 25) {
      let requests = documentIds.slice(i, i + 25).map((documentId) => ({
        DeleteRequest: { Key: { userId, documentId } },
      }));
      for (let round = 0; requests.length > 0 && round < 5; round++) {
        const res = await this.client.send(
          new BatchWriteCommand({ RequestItems: { [this.tables.documents]: requests } }),
        );
        requests = (res.UnprocessedItems?.[this.tables.documents] ?? []) as typeof requests;
      }
      if (requests.length > 0) throw new Error('Could not delete old versions');
    }
  }
}
