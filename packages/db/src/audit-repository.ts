import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

/**
 * `audit` (docs/data-model.md, 0007): the user's audit history. Keys: `userId`,
 * `auditId` (ULID, so entries sort by time). Written in the same transaction as the
 * action it records, never changed, erased only with the account.
 */
export interface AuditEntry {
  userId: string;
  auditId: string;
  type: 'audit';
  /** For example `crawl.requested`. */
  name: string;
  entity: { type: string; id: string };
  actor: 'user' | 'system';
  /** Short and safe to show: IDs and host names, never page content or personal details. */
  summary: string;
  detail?: Record<string, string | number | boolean>;
  ttl: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

export const AUDIT_TTL_SECONDS = 365 * 24 * 60 * 60;

export type AuditInput = Pick<
  AuditEntry,
  'userId' | 'auditId' | 'name' | 'entity' | 'actor' | 'summary'
> &
  Pick<Partial<AuditEntry>, 'detail'>;

/**
 * The audit entry a write must record (T06d): which table, and the entry without the
 * user (the write's own user is used). Repositories put it in the same transaction as
 * the write, so an action is never recorded without happening, or the other way round.
 */
export interface AuditWrite {
  table: string;
  entry: Omit<AuditInput, 'userId'>;
}

/** The `Put` of an audit entry, for a `TransactWriteItems` list. */
export function auditPut(write: AuditWrite, userId: string, at: Date) {
  return {
    Put: {
      TableName: write.table,
      Item: auditItem({ ...write.entry, userId }, at),
      ConditionExpression: 'attribute_not_exists(userId)',
    },
  };
}

/** An entry ready to `Put` inside the caller's transaction. */
export function auditItem(input: AuditInput, at: Date): AuditEntry {
  return {
    ...input,
    type: 'audit',
    ttl: Math.floor(at.getTime() / 1000) + AUDIT_TTL_SECONDS,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    schemaVersion: 1,
  };
}

export interface Page<T> {
  items: T[];
  /** The last key returned, when more may follow. */
  next?: string;
}

/** Newest first, `limit` at a time, continuing after the key `after`. */
export async function queryNewestFirst<T>(
  client: DynamoDBDocumentClient,
  tableName: string,
  sortKey: string,
  userId: string,
  limit: number,
  after?: string,
): Promise<Page<T>> {
  const res = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
      ScanIndexForward: false,
      Limit: limit,
      ...(after !== undefined ? { ExclusiveStartKey: { userId, [sortKey]: after } } : {}),
    }),
  );
  const last = res.LastEvaluatedKey?.[sortKey];
  return {
    items: (res.Items ?? []) as T[],
    ...(typeof last === 'string' ? { next: last } : {}),
  };
}

export class AuditRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  list(userId: string, limit: number, after?: string): Promise<Page<AuditEntry>> {
    return queryNewestFirst(this.client, this.tableName, 'auditId', userId, limit, after);
  }
}
