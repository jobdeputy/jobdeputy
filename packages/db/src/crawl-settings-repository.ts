import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AuditWrite } from './audit-repository.js';
import { getItem, putVersioned, type Versioned } from './versioned.js';

/** `preferences` → `CRAWL_SETTINGS` (T06c): the user's own daily crawl limit, if any. */
export type CrawlSettings = Versioned<{ dailyLimit?: number }>;

const SK = 'CRAWL_SETTINGS';

export class CrawlSettingsRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(userId: string): Promise<CrawlSettings | undefined> {
    return getItem<{ dailyLimit?: number }>(this.client, this.tableName, userId, SK);
  }

  /**
   * Saves the user's limit (`null` = back to the default) if the item is still at
   * `expectedVersion` (0 = never saved), with its `crawl_limit.changed` audit entry in
   * the same transaction. Throws VersionConflictError otherwise.
   */
  save(
    userId: string,
    dailyLimit: number | null,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<CrawlSettings> {
    return putVersioned(
      this.client,
      this.tableName,
      { userId, sk: SK, type: 'crawl_settings' },
      dailyLimit !== null ? { dailyLimit } : {},
      expectedVersion,
      this.now(),
      audit,
    );
  }
}
