import type { DynamoDBDocumentClient, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { cancelledAt } from './client.js';
import { transactWrite } from './transact.js';

/** The item changed since the caller read it (another tab or device saved first). */
export class VersionConflictError extends Error {
  override name = 'VersionConflictError';
  constructor(readonly currentVersion: number) {
    super(`Version conflict: the current version is ${currentVersion}`);
  }
}

/** Fields every stored item carries (docs/data-model.md, conventions). */
export interface Stored {
  userId: string;
  sk: string;
  type: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

export type Versioned<T> = T & Stored;

export async function getItem<T>(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  sk: string,
): Promise<Versioned<T> | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: table, Key: { userId, sk }, ConsistentRead: true }),
  );
  return res.Item as Versioned<T> | undefined;
}

/**
 * Replaces an item only if it is still at `expectedVersion` (0 = must not exist yet),
 * so concurrent saves can never silently overwrite each other, and records `audit` in
 * the same transaction (T06d).
 */
export async function putVersioned<T extends object>(
  client: DynamoDBDocumentClient,
  table: string,
  key: { userId: string; sk: string; type: string },
  fields: T,
  expectedVersion: number,
  now: Date,
  audit: AuditWrite,
  /** More writes in the same transaction (for example a counter); they follow item and audit. */
  extra: NonNullable<TransactWriteCommandInput['TransactItems']> = [],
): Promise<Versioned<T>> {
  const existing = await getItem<T>(client, table, key.userId, key.sk);
  const currentVersion = existing?.version ?? 0;
  if (currentVersion !== expectedVersion) throw new VersionConflictError(currentVersion);

  const item = {
    ...fields,
    ...key,
    version: expectedVersion + 1,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    schemaVersion: 1,
  } as Versioned<T>;
  try {
    await transactWrite(client, {
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: item,
            ConditionExpression:
              expectedVersion === 0 ? 'attribute_not_exists(userId)' : 'version = :expected',
            ...(expectedVersion === 0
              ? {}
              : { ExpressionAttributeValues: { ':expected': expectedVersion } }),
          },
        },
        auditPut(audit, key.userId, now),
        ...extra,
      ],
    });
  } catch (error) {
    // Someone saved between our read and write.
    if (cancelledAt(error, 0)) throw new VersionConflictError(-1);
    throw error;
  }
  return item;
}
