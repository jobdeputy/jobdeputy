import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { isConditionFailure } from './client.js';

/**
 * `usage` → `COMPANY#<companyKey>` (T08c): the jobs shown for one company, at most the
 * user's per-company limit. Replaced whole by each crawl that ranks the company, only
 * if nobody changed it meanwhile (`version`), so two crawls at once stay exact.
 */
export interface ShownJobs {
  /** jobId → what it was ranked by: role priority `p`, `postedAt` `t`, T08d LLM score `s`. */
  shown: Record<string, { p: number; t?: string; s?: number }>;
  /** 0 when the item does not exist yet. */
  version: number;
}

export class ShownConflictError extends Error {
  override name = 'ShownConflictError';
}

export const companySk = (companyKey: string) => `COMPANY#${companyKey}`;

export class CompanyLimitRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(userId: string, companyKey: string): Promise<ShownJobs> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { userId, sk: companySk(companyKey) },
        ConsistentRead: true,
      }),
    );
    const item = res.Item;
    return {
      shown: (item?.shown as ShownJobs['shown']) ?? {},
      version: (item?.version as number) ?? 0,
    };
  }

  /** Replaces the shown jobs if the item is still at `expectedVersion`; else ShownConflictError. */
  async put(
    userId: string,
    companyKey: string,
    shown: ShownJobs['shown'],
    expectedVersion: number,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            userId,
            sk: companySk(companyKey),
            type: 'company_shown',
            companyKey,
            shown,
            version: expectedVersion + 1,
            updatedAt: this.now().toISOString(),
            schemaVersion: 1,
          },
          ConditionExpression:
            expectedVersion === 0 ? 'attribute_not_exists(userId)' : 'version = :expected',
          ...(expectedVersion === 0
            ? {}
            : { ExpressionAttributeValues: { ':expected': expectedVersion } }),
        }),
      );
    } catch (error) {
      if (isConditionFailure(error)) throw new ShownConflictError(companyKey);
      throw error;
    }
  }

  /** Closed jobs free their places (and a crawl ranking the company meanwhile starts again). */
  async release(userId: string, companyKey: string, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    const names: Record<string, string> = { '#shown': 'shown' };
    const paths = jobIds.map((id, i) => {
      names[`#j${i}`] = id;
      return `#shown.#j${i}`;
    });
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { userId, sk: companySk(companyKey) },
          UpdateExpression: `REMOVE ${paths.join(', ')} SET version = version + :one, updatedAt = :now`,
          ConditionExpression: 'attribute_exists(#shown)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: { ':one': 1, ':now': this.now().toISOString() },
        }),
      );
    } catch (error) {
      // Nothing shown for this company yet: nothing to free.
      if (!isConditionFailure(error)) throw error;
    }
  }
}
