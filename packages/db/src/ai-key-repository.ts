import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  type AiKeyError,
  type AiKeyStatus,
  type AiProvider,
  type AiSource,
  utcDay,
} from '@jobdeputy/shared';
import { type AuditWrite, auditPut } from './audit-repository.js';
import { cancelledAt } from './client.js';
import { USAGE_DAY_TTL_SECONDS } from './crawl-repository.js';
import { ConcurrentUpdateError, transactWrite } from './transact.js';
import { getItem, putVersioned, type Versioned } from './versioned.js';

/**
 * `ai-keys` (T08b2, decision 0009): one item per user and provider. `ciphertext` is the key
 * encrypted with the cell's KMS key (encryption context `userId` and `provider`); only the
 * key-check worker and the LLM workers can decrypt it. Nothing else of the key is stored
 * except its last 4 characters.
 */
export interface AiKey {
  userId: string;
  provider: AiProvider;
  type: 'ai_key';
  ciphertext: Uint8Array;
  last4: string;
  modelId: string;
  status: AiKeyStatus;
  /** Why the key is `invalid`. */
  reason?: AiKeyError;
  /** The current check: a result is recorded only for the latest one. */
  checkId: string;
  consentAt: string;
  checkedAt?: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: 1;
}

/** What the API may show: never the ciphertext. */
export type AiKeySummary = Pick<
  AiKey,
  'provider' | 'last4' | 'modelId' | 'status' | 'reason' | 'checkedAt' | 'consentAt' | 'updatedAt'
>;

export class AiKeyNotFoundError extends Error {
  override name = 'AiKeyNotFoundError';
}

/** Today's key checks (saves and re-checks) are used up. */
export class KeyCheckLimitError extends Error {
  override name = 'KeyCheckLimitError';
}

/** The chosen default is a key that is missing or invalid. */
export class AiKeyNotUsableError extends Error {
  override name = 'AiKeyNotUsableError';
}

export interface AiKeyTables {
  aiKeys: string;
  usage: string;
  preferences: string;
}

/** `preferences` → `AI_SETTINGS`: the model source used when a run does not choose one. */
export type AiSettings = Versioned<{ defaultSource: AiSource }>;
export const AI_SETTINGS_SK = 'AI_SETTINGS';

const MAX_DELETE_ROUNDS = 3;

export class AiKeyRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tables: AiKeyTables,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The daily check counter (exact under concurrent requests), at index 2 of each transaction. */
  private countCheck(userId: string, at: Date, max: number) {
    return {
      Update: {
        TableName: this.tables.usage,
        Key: { userId, sk: `DAY#${utcDay(at)}` },
        UpdateExpression:
          'SET keyChecks = if_not_exists(keyChecks, :zero) + :one, #type = :day, #ttl = :ttl, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one',
        ConditionExpression: 'attribute_not_exists(keyChecks) OR keyChecks < :max',
        ExpressionAttributeNames: { '#type': 'type', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':day': 'usage_day',
          ':ttl': Math.floor(at.getTime() / 1000) + USAGE_DAY_TTL_SECONDS,
          ':now': at.toISOString(),
          ':max': max,
        },
      },
    };
  }

  /**
   * Saves (or replaces) the user's key for a provider as `checking`, with its audit entry and
   * one of today's checks, in one transaction. Throws KeyCheckLimitError when today's checks
   * are used up (nothing is saved then).
   */
  async save(input: {
    userId: string;
    provider: AiProvider;
    ciphertext: Uint8Array;
    last4: string;
    modelId: string;
    checkId: string;
    maxChecksPerDay: number;
    audit: AuditWrite;
  }): Promise<AiKeySummary> {
    const at = this.now();
    const now = at.toISOString();
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.aiKeys,
              Key: { userId: input.userId, provider: input.provider },
              UpdateExpression:
                'SET #type = :type, ciphertext = :ciphertext, last4 = :last4, modelId = :modelId, #status = :checking, checkId = :checkId, consentAt = :now, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one REMOVE #reason, checkedAt',
              ExpressionAttributeNames: {
                '#type': 'type',
                '#status': 'status',
                '#reason': 'reason',
              },
              ExpressionAttributeValues: {
                ':type': 'ai_key',
                ':ciphertext': input.ciphertext,
                ':last4': input.last4,
                ':modelId': input.modelId,
                ':checking': 'checking',
                ':checkId': input.checkId,
                ':now': now,
                ':one': 1,
              },
            },
          },
          auditPut(input.audit, input.userId, at),
          this.countCheck(input.userId, at, input.maxChecksPerDay),
        ],
      });
    } catch (error) {
      if (cancelledAt(error, 2)) throw new KeyCheckLimitError();
      throw error;
    }
    return {
      provider: input.provider,
      last4: input.last4,
      modelId: input.modelId,
      status: 'checking',
      consentAt: now,
      updatedAt: now,
    };
  }

  /**
   * Starts a new check of a saved key (counted like a save). Throws AiKeyNotFoundError when
   * there is no key, and KeyCheckLimitError when today's checks are used up.
   */
  async requestCheck(input: {
    userId: string;
    provider: AiProvider;
    checkId: string;
    maxChecksPerDay: number;
    audit: AuditWrite;
  }): Promise<void> {
    const at = this.now();
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.aiKeys,
              Key: { userId: input.userId, provider: input.provider },
              UpdateExpression:
                'SET #status = :checking, checkId = :checkId, updatedAt = :now REMOVE #reason',
              ConditionExpression: 'attribute_exists(userId)',
              ExpressionAttributeNames: { '#status': 'status', '#reason': 'reason' },
              ExpressionAttributeValues: {
                ':checking': 'checking',
                ':checkId': input.checkId,
                ':now': at.toISOString(),
              },
            },
          },
          auditPut(input.audit, input.userId, at),
          this.countCheck(input.userId, at, input.maxChecksPerDay),
        ],
      });
    } catch (error) {
      // DynamoDB does not always report every failed condition: a missing key wins.
      if (cancelledAt(error, 0)) throw new AiKeyNotFoundError();
      if (cancelledAt(error, 2)) {
        if (!(await this.get(input.userId, input.provider))) throw new AiKeyNotFoundError();
        throw new KeyCheckLimitError();
      }
      throw error;
    }
  }

  /**
   * Deletes the key with its audit entry. When it was the default model source, the default
   * goes back to `platform` in the same transaction; a concurrent change of the default is
   * read again (bounded). Throws AiKeyNotFoundError when there is no key.
   */
  async delete(input: { userId: string; provider: AiProvider; audit: AuditWrite }): Promise<{
    defaultReset: boolean;
  }> {
    for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
      const at = this.now();
      const settings = await getItem<{ defaultSource: AiSource }>(
        this.client,
        this.tables.preferences,
        input.userId,
        AI_SETTINGS_SK,
      );
      const isDefault = settings?.defaultSource === input.provider;
      const settingsItem = isDefault
        ? {
            Update: {
              TableName: this.tables.preferences,
              Key: { userId: input.userId, sk: AI_SETTINGS_SK },
              UpdateExpression: 'SET defaultSource = :platform, version = :next, updatedAt = :now',
              ConditionExpression: 'version = :seen',
              ExpressionAttributeValues: {
                ':platform': 'platform',
                ':next': (settings?.version ?? 0) + 1,
                ':seen': settings?.version ?? 0,
                ':now': at.toISOString(),
              },
            },
          }
        : {
            ConditionCheck: {
              TableName: this.tables.preferences,
              Key: { userId: input.userId, sk: AI_SETTINGS_SK },
              ConditionExpression: 'attribute_not_exists(userId) OR defaultSource <> :provider',
              ExpressionAttributeValues: { ':provider': input.provider },
            },
          };
      try {
        await transactWrite(this.client, {
          TransactItems: [
            {
              Delete: {
                TableName: this.tables.aiKeys,
                Key: { userId: input.userId, provider: input.provider },
                ConditionExpression: 'attribute_exists(userId)',
              },
            },
            auditPut(input.audit, input.userId, at),
            settingsItem,
          ],
        });
        return { defaultReset: isDefault };
      } catch (error) {
        if (cancelledAt(error, 0)) throw new AiKeyNotFoundError();
        if (!cancelledAt(error, 2)) throw error;
        // The default changed meanwhile: read it again.
      }
    }
    throw new ConcurrentUpdateError();
  }

  async get(userId: string, provider: AiProvider): Promise<AiKey | undefined> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.tables.aiKeys,
        Key: { userId, provider },
        ConsistentRead: true,
      }),
    );
    return res.Item as AiKey | undefined;
  }

  /** The user's keys, without their ciphertext (at most one per provider). */
  async list(userId: string): Promise<AiKeySummary[]> {
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tables.aiKeys,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ConsistentRead: true,
      }),
    );
    return ((res.Items ?? []) as AiKey[]).map(summary);
  }

  /**
   * Records a check's result, only if the key is still at that check (not deleted, replaced,
   * or checked again meanwhile), with its audit entry. False when it was not recorded.
   */
  async recordCheck(input: {
    userId: string;
    provider: AiProvider;
    checkId: string;
    result: { status: 'valid' } | { status: 'invalid'; reason: AiKeyError };
    audit: AuditWrite;
  }): Promise<boolean> {
    const at = this.now();
    const invalid = input.result.status === 'invalid';
    try {
      await transactWrite(this.client, {
        TransactItems: [
          {
            Update: {
              TableName: this.tables.aiKeys,
              Key: { userId: input.userId, provider: input.provider },
              UpdateExpression: invalid
                ? 'SET #status = :status, #reason = :reason, checkedAt = :now, updatedAt = :now'
                : 'SET #status = :status, checkedAt = :now, updatedAt = :now REMOVE #reason',
              ConditionExpression: 'checkId = :checkId AND #status = :checking',
              ExpressionAttributeNames: { '#status': 'status', '#reason': 'reason' },
              ExpressionAttributeValues: {
                ':status': input.result.status,
                ':checkId': input.checkId,
                ':checking': 'checking',
                ':now': at.toISOString(),
                ...(input.result.status === 'invalid' ? { ':reason': input.result.reason } : {}),
              },
            },
          },
          auditPut(input.audit, input.userId, at),
        ],
      });
      return true;
    } catch (error) {
      if (cancelledAt(error, 0)) return false;
      throw error;
    }
  }

  getSettings(userId: string): Promise<AiSettings | undefined> {
    return getItem<{ defaultSource: AiSource }>(
      this.client,
      this.tables.preferences,
      userId,
      AI_SETTINGS_SK,
    );
  }

  /**
   * Saves the default model source if the settings are still at `expectedVersion`. A
   * provider must have a saved key that is not `invalid`, checked in the same transaction.
   * Throws VersionConflictError or AiKeyNotUsableError.
   */
  async saveSettings(
    userId: string,
    defaultSource: AiSource,
    expectedVersion: number,
    audit: AuditWrite,
  ): Promise<AiSettings> {
    const keyCheck =
      defaultSource === 'platform'
        ? []
        : [
            {
              ConditionCheck: {
                TableName: this.tables.aiKeys,
                Key: { userId, provider: defaultSource },
                ConditionExpression: 'attribute_exists(userId) AND #status <> :invalid',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':invalid': 'invalid' },
              },
            },
          ];
    try {
      return await putVersioned(
        this.client,
        this.tables.preferences,
        { userId, sk: AI_SETTINGS_SK, type: 'ai_settings' },
        { defaultSource },
        expectedVersion,
        this.now(),
        audit,
        keyCheck,
      );
    } catch (error) {
      if (cancelledAt(error, 2)) throw new AiKeyNotUsableError();
      throw error;
    }
  }
}

function summary(key: AiKey): AiKeySummary {
  return {
    provider: key.provider,
    last4: key.last4,
    modelId: key.modelId,
    status: key.status,
    ...(key.reason ? { reason: key.reason } : {}),
    ...(key.checkedAt ? { checkedAt: key.checkedAt } : {}),
    consentAt: key.consentAt,
    updatedAt: key.updatedAt,
  };
}
