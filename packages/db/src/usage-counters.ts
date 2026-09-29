import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isConditionFailure } from './client.js';

/**
 * Per-user counters in `usage` that make caps exact under concurrent requests: the
 * counter changes in the same transaction as the create or delete, with a condition.
 * A count-then-write check can be passed by two requests at once (review, 2026-09-29).
 */
export const ROLES_SK = 'ROLES';
/** Also holds `defaultDocumentId`: claimed by a first upload only while free. */
export const DOCUMENTS_SK = 'DOCUMENTS';

export interface UsageCounter {
  itemCount?: number;
  defaultDocumentId?: string;
}

/** The transaction item that counts one more, only while fewer than `max` (and claims the default). */
export function countUp(
  table: string,
  userId: string,
  sk: string,
  max: number,
  now: string,
  claimDefault?: string,
) {
  return {
    Update: {
      TableName: table,
      Key: { userId, sk },
      UpdateExpression: `SET itemCount = if_not_exists(itemCount, :zero) + :one, #type = :type, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one${claimDefault ? ', defaultDocumentId = :default' : ''}`,
      ConditionExpression: `(attribute_not_exists(itemCount) OR itemCount < :max)${claimDefault ? ' AND attribute_not_exists(defaultDocumentId)' : ''}`,
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':type': 'usage_count',
        ':now': now,
        ':max': max,
        ...(claimDefault ? { ':default': claimDefault } : {}),
      },
    },
  };
}

/** The transaction item that counts one fewer (and frees the default, when it was this one). */
export function countDown(
  table: string,
  userId: string,
  sk: string,
  now: string,
  freeDefault = false,
) {
  return {
    Update: {
      TableName: table,
      Key: { userId, sk },
      UpdateExpression: `SET itemCount = if_not_exists(itemCount, :one) - :one, updatedAt = :now${freeDefault ? ' REMOVE defaultDocumentId' : ''}`,
      ExpressionAttributeValues: { ':one': 1, ':now': now },
    },
  };
}

/** The transaction item that records a new default document. */
export function setDefaultDocument(table: string, userId: string, documentId: string, now: string) {
  return {
    Update: {
      TableName: table,
      Key: { userId, sk: DOCUMENTS_SK },
      UpdateExpression: 'SET defaultDocumentId = :id, updatedAt = :now',
      ExpressionAttributeValues: { ':id': documentId, ':now': now },
    },
  };
}

export async function getUsageCounter(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  sk: string,
): Promise<UsageCounter> {
  const res = await client.send(
    new GetCommand({ TableName: table, Key: { userId, sk }, ConsistentRead: true }),
  );
  const item = res.Item ?? {};
  return {
    ...(typeof item.itemCount === 'number' ? { itemCount: item.itemCount } : {}),
    ...(typeof item.defaultDocumentId === 'string'
      ? { defaultDocumentId: item.defaultDocumentId }
      : {}),
  };
}

/**
 * Self-healing: sets the counter to what really exists (pending uploads expire without
 * running our code, so the count can drift up), only if it still holds what was read.
 * False when another request changed it meanwhile (the caller reads again).
 */
export async function repairUsageCounter(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  sk: string,
  seen: UsageCounter,
  actual: UsageCounter & { itemCount: number },
  now: string,
): Promise<boolean> {
  const conditions = [
    seen.itemCount === undefined ? 'attribute_not_exists(itemCount)' : 'itemCount = :seenCount',
    seen.defaultDocumentId === undefined
      ? 'attribute_not_exists(defaultDocumentId)'
      : 'defaultDocumentId = :seenDefault',
  ];
  try {
    await client.send(
      new UpdateCommand({
        TableName: table,
        Key: { userId, sk },
        UpdateExpression: `SET itemCount = :count, updatedAt = :now${actual.defaultDocumentId ? ', defaultDocumentId = :default' : ' REMOVE defaultDocumentId'}`,
        ConditionExpression: conditions.join(' AND '),
        ExpressionAttributeValues: {
          ':count': actual.itemCount,
          ':now': now,
          ...(seen.itemCount !== undefined ? { ':seenCount': seen.itemCount } : {}),
          ...(seen.defaultDocumentId !== undefined
            ? { ':seenDefault': seen.defaultDocumentId }
            : {}),
          ...(actual.defaultDocumentId ? { ':default': actual.defaultDocumentId } : {}),
        },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}
