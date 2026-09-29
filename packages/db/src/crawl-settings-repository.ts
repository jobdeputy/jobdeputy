import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { type AuditInput, auditItem } from './audit-repository.js';
import { getItem, VersionConflictError, type Versioned } from './versioned.js';

/** `preferences` → `CRAWL_SETTINGS` (T06c): the user's own daily crawl limit, if any. */
export type CrawlSettings = Versioned<{ dailyLimit?: number }>;

const SK = 'CRAWL_SETTINGS';

export class CrawlSettingsRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: { preferences: string; audit: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(userId: string): Promise<CrawlSettings | undefined> {
    return getItem<{ dailyLimit?: number }>(this.client, this.tables.preferences, userId, SK);
  }

  /**
   * Saves the user's limit (`null` = back to the default) if the item is still at
   * `expectedVersion` (0 = never saved), with its `crawl_limit.changed` audit entry in
   * the same transaction. Throws VersionConflictError otherwise.
   */
  async save(
    userId: string,
    dailyLimit: number | null,
    expectedVersion: number,
    audit: Omit<AuditInput, 'userId'>,
  ): Promise<CrawlSettings> {
    const existing = await this.get(userId);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== expectedVersion) throw new VersionConflictError(currentVersion);

    const at = this.now();
    const item: CrawlSettings = {
      userId,
      sk: SK,
      type: 'crawl_settings',
      ...(dailyLimit !== null ? { dailyLimit } : {}),
      version: expectedVersion + 1,
      createdAt: existing?.createdAt ?? at.toISOString(),
      updatedAt: at.toISOString(),
      schemaVersion: 1,
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tables.preferences,
                Item: item,
                ConditionExpression:
                  expectedVersion === 0 ? 'attribute_not_exists(userId)' : 'version = :expected',
                ...(expectedVersion === 0
                  ? {}
                  : { ExpressionAttributeValues: { ':expected': expectedVersion } }),
              },
            },
            {
              Put: {
                TableName: this.tables.audit,
                Item: auditItem({ ...audit, userId }, at),
                ConditionExpression: 'attribute_not_exists(userId)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      // Someone saved between our read and write.
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        throw new VersionConflictError(-1);
      }
      throw error;
    }
    return item;
  }
}
