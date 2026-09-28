import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { isConditionFailure } from './client.js';

/** `users` → `DELETION` (docs/data-model.md): the account-deletion request (T12). */
export interface DeletionRequest {
  userId: string;
  sk: 'DELETION';
  type: 'deletion';
  /** Cognito username, needed to sign out and delete the login. */
  username: string;
  status: 'queued' | 'deleting' | 'done';
  requestedAt: string;
  updatedAt: string;
  /** Outlives any access token (1 hour), so writes stay blocked; then DynamoDB removes it. */
  ttl: number;
  schemaVersion: 1;
}

export const DELETION_SK = 'DELETION';
const DELETION_TTL_SECONDS = 2 * 60 * 60;

export class AccountRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly usersTable: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDeletion(userId: string): Promise<DeletionRequest | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.usersTable,
        Key: { userId, sk: DELETION_SK },
        ConsistentRead: true,
      }),
    );
    return res.Item as DeletionRequest | undefined;
  }

  /** One read, on write requests only: is this account being deleted? */
  async isBeingDeleted(userId: string): Promise<boolean> {
    return (await this.getDeletion(userId)) !== undefined;
  }

  /** Idempotent: a second request returns the first one. */
  async requestDeletion(userId: string, username: string): Promise<DeletionRequest> {
    const at = this.now();
    const item: DeletionRequest = {
      userId,
      sk: DELETION_SK,
      type: 'deletion',
      username,
      status: 'queued',
      requestedAt: at.toISOString(),
      updatedAt: at.toISOString(),
      ttl: Math.floor(at.getTime() / 1000) + DELETION_TTL_SECONDS,
      schemaVersion: 1,
    };
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.usersTable,
          Item: item,
          ConditionExpression: 'attribute_not_exists(userId)',
        }),
      );
      return item;
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      return (await this.getDeletion(userId)) ?? item;
    }
  }

  async setDeletionStatus(userId: string, status: DeletionRequest['status']): Promise<void> {
    await this.client
      .send(
        new UpdateCommand({
          TableName: this.usersTable,
          Key: { userId, sk: DELETION_SK },
          UpdateExpression: 'SET #status = :s, updatedAt = :now',
          ConditionExpression: 'attribute_exists(userId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':s': status, ':now': this.now().toISOString() },
        }),
      )
      .catch((error: unknown) => {
        if (!isConditionFailure(error)) throw error;
      });
  }
}

/** A table whose partition key is `userId` (all user data, docs/data-model.md). */
export interface UserTable {
  name: string;
  sortKey: string;
}

const MAX_BATCH = 25;
const MAX_UNPROCESSED_RETRIES = 5;

/**
 * Deletes every item under `userId` in each table, page by page. Keeps only the
 * `DELETION` request in `users` (it must outlive tokens to keep blocking writes).
 * Safe to repeat: deleting what is gone is not an error. Returns the count deleted.
 */
export async function eraseUserItems(
  client: DynamoDBDocumentClient,
  tables: UserTable[],
  userId: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<number> {
  let deleted = 0;
  for (const table of tables) {
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await client.send(
        new QueryCommand({
          TableName: table.name,
          KeyConditionExpression: 'userId = :u',
          ExpressionAttributeValues: { ':u': userId },
          ProjectionExpression: '#pk, #sk',
          ExpressionAttributeNames: { '#pk': 'userId', '#sk': table.sortKey },
          ConsistentRead: true,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      const keys = (page.Items ?? []).filter((k) => k[table.sortKey] !== DELETION_SK);
      for (let i = 0; i < keys.length; i += MAX_BATCH) {
        let requests = keys.slice(i, i + MAX_BATCH).map((Key) => ({ DeleteRequest: { Key } }));
        for (let attempt = 0; requests.length > 0; attempt++) {
          if (attempt > MAX_UNPROCESSED_RETRIES)
            throw new Error(`Could not delete all items in ${table.name}`);
          if (attempt > 0) await sleep(100 * 2 ** attempt);
          const res = await client.send(
            new BatchWriteCommand({ RequestItems: { [table.name]: requests } }),
          );
          const left = res.UnprocessedItems?.[table.name] ?? [];
          deleted += requests.length - left.length;
          requests = left as typeof requests;
        }
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
  }
  return deleted;
}
