import type { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_SETTINGS_SK,
  AiKeyNotFoundError,
  AiKeyNotUsableError,
  AiKeyRepository,
  ConcurrentUpdateError,
  KeyCheckLimitError,
  USAGE_DAY_TTL_SECONDS,
} from '../src/index.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TABLES = { aiKeys: 'AiKeys', usage: 'Usage', preferences: 'Preferences' };
const AUDIT = {
  table: 'Audit',
  entry: {
    auditId: '01J8ZQ4Y3N5W6X7Y8Z9A0B1C2E',
    name: 'ai_key.saved',
    entity: { type: 'ai_key', id: 'openai' },
    actor: 'user' as const,
    summary: 'x',
  },
};
const cancelled = (...codes: string[]) =>
  Object.assign(new Error('TransactionCanceledException'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

type Items = NonNullable<TransactWriteCommand['input']['TransactItems']>;

/** A client whose transactions answer with `onTransact`; Get and Query answer from `items`. */
function client(
  options: { onTransact?: (items: Items, n: number) => void; items?: Record<string, unknown> } = {},
) {
  const transactions: Items[] = [];
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof GetCommand) {
      const key = cmd.input.Key as Record<string, string>;
      return { Item: options.items?.[`${cmd.input.TableName}/${key.sk ?? key.provider}`] };
    }
    if (cmd instanceof QueryCommand) return { Items: Object.values(options.items ?? {}) };
    const items = (cmd as TransactWriteCommand).input.TransactItems as Items;
    transactions.push(items);
    options.onTransact?.(items, transactions.length);
    return {};
  });
  return { c: { send } as unknown as DynamoDBDocumentClient, transactions };
}

const repo = (c: DynamoDBDocumentClient) => new AiKeyRepository(c, TABLES, () => NOW);
const SAVE = {
  userId: USER,
  provider: 'openai' as const,
  ciphertext: new Uint8Array([1, 2, 3]),
  last4: 'abcd',
  modelId: 'gpt-test',
  checkId: 'C1',
  maxChecksPerDay: 5,
  audit: AUDIT,
};

describe('save', () => {
  it('stores the key as checking, with its audit entry and one daily check, in one transaction', async () => {
    const { c, transactions } = client();
    const saved = await repo(c).save(SAVE);
    expect(saved).toEqual({
      provider: 'openai',
      last4: 'abcd',
      modelId: 'gpt-test',
      status: 'checking',
      consentAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const [key, audit, counter] = transactions[0] ?? [];
    expect(key?.Update).toMatchObject({
      TableName: 'AiKeys',
      Key: { userId: USER, provider: 'openai' },
      ExpressionAttributeValues: {
        ':ciphertext': SAVE.ciphertext,
        ':checking': 'checking',
        ':checkId': 'C1',
      },
    });
    expect(key?.Update?.UpdateExpression).toContain('REMOVE #reason, checkedAt');
    expect(audit?.Put?.TableName).toBe('Audit');
    expect(counter?.Update).toMatchObject({
      TableName: 'Usage',
      Key: { userId: USER, sk: 'DAY#2026-09-30' },
      ConditionExpression: 'attribute_not_exists(keyChecks) OR keyChecks < :max',
      ExpressionAttributeValues: {
        ':max': 5,
        ':ttl': Math.floor(NOW.getTime() / 1000) + USAGE_DAY_TTL_SECONDS,
      },
    });
  });

  it('refuses when today’s checks are used up', async () => {
    const { c } = client({
      onTransact: () => {
        throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await expect(repo(c).save(SAVE)).rejects.toBeInstanceOf(KeyCheckLimitError);
  });
});

describe('requestCheck', () => {
  const input = {
    userId: USER,
    provider: 'openai' as const,
    checkId: 'C2',
    maxChecksPerDay: 5,
    audit: AUDIT,
  };

  it('sets the key back to checking, only if it exists, and counts the check', async () => {
    const { c, transactions } = client();
    await repo(c).requestCheck(input);
    const [key, , counter] = transactions[0] ?? [];
    expect(key?.Update).toMatchObject({
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: { ':checking': 'checking', ':checkId': 'C2' },
    });
    expect(counter?.Update?.TableName).toBe('Usage');
  });

  it('reports a missing key, even when DynamoDB names only the counter', async () => {
    const missing = client({
      onTransact: () => {
        throw cancelled('ConditionalCheckFailed', 'None', 'None');
      },
    });
    await expect(repo(missing.c).requestCheck(input)).rejects.toBeInstanceOf(AiKeyNotFoundError);
    const onlyCounter = client({
      onTransact: () => {
        throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await expect(repo(onlyCounter.c).requestCheck(input)).rejects.toBeInstanceOf(
      AiKeyNotFoundError,
    );
  });

  it('reports the daily limit when the key exists', async () => {
    const { c } = client({
      items: { 'AiKeys/openai': { userId: USER, provider: 'openai' } },
      onTransact: () => {
        throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await expect(repo(c).requestCheck(input)).rejects.toBeInstanceOf(KeyCheckLimitError);
  });
});

describe('delete', () => {
  const input = { userId: USER, provider: 'openai' as const, audit: AUDIT };

  it('deletes the key and checks the default does not point to it', async () => {
    const { c, transactions } = client();
    expect(await repo(c).delete(input)).toEqual({ defaultReset: false });
    const [key, , settings] = transactions[0] ?? [];
    expect(key?.Delete).toMatchObject({ Key: { userId: USER, provider: 'openai' } });
    expect(settings?.ConditionCheck).toMatchObject({
      TableName: 'Preferences',
      Key: { userId: USER, sk: AI_SETTINGS_SK },
      ConditionExpression: 'attribute_not_exists(userId) OR defaultSource <> :provider',
    });
  });

  it('sets the default back to platform when it was this key', async () => {
    const { c, transactions } = client({
      items: { [`Preferences/${AI_SETTINGS_SK}`]: { defaultSource: 'openai', version: 4 } },
    });
    expect(await repo(c).delete(input)).toEqual({ defaultReset: true });
    expect(transactions[0]?.[2]?.Update).toMatchObject({
      ConditionExpression: 'version = :seen',
      ExpressionAttributeValues: { ':platform': 'platform', ':seen': 4, ':next': 5 },
    });
  });

  it('reads the default again when it changed meanwhile, a bounded number of times', async () => {
    const retried = client({
      onTransact: (_, n) => {
        if (n === 1) throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await repo(retried.c).delete(input);
    expect(retried.transactions).toHaveLength(2);

    const always = client({
      onTransact: () => {
        throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await expect(repo(always.c).delete(input)).rejects.toBeInstanceOf(ConcurrentUpdateError);
    expect(always.transactions).toHaveLength(3);
  });

  it('reports a missing key', async () => {
    const { c } = client({
      onTransact: () => {
        throw cancelled('ConditionalCheckFailed', 'None', 'None');
      },
    });
    await expect(repo(c).delete(input)).rejects.toBeInstanceOf(AiKeyNotFoundError);
  });
});

describe('recordCheck', () => {
  const base = { userId: USER, provider: 'openai' as const, checkId: 'C1', audit: AUDIT };

  it('records the result only for the current check', async () => {
    const { c, transactions } = client();
    expect(
      await repo(c).recordCheck({ ...base, result: { status: 'invalid', reason: 'rejected' } }),
    ).toBe(true);
    expect(transactions[0]?.[0]?.Update).toMatchObject({
      ConditionExpression: 'checkId = :checkId AND #status = :checking',
      ExpressionAttributeValues: { ':status': 'invalid', ':reason': 'rejected', ':checkId': 'C1' },
    });
    await repo(c).recordCheck({ ...base, result: { status: 'valid' } });
    expect(transactions[1]?.[0]?.Update?.UpdateExpression).toContain('REMOVE #reason');
  });

  it('records nothing when the key was deleted, replaced, or checked again', async () => {
    const { c } = client({
      onTransact: () => {
        throw cancelled('ConditionalCheckFailed', 'None');
      },
    });
    expect(await repo(c).recordCheck({ ...base, result: { status: 'valid' } })).toBe(false);
  });
});

describe('list', () => {
  it('never returns the ciphertext', async () => {
    const { c } = client({
      items: {
        'AiKeys/openai': {
          userId: USER,
          provider: 'openai',
          ciphertext: new Uint8Array([9]),
          last4: 'abcd',
          modelId: 'gpt-test',
          status: 'invalid',
          reason: 'rejected',
          checkId: 'C1',
          consentAt: 'a',
          updatedAt: 'b',
        },
      },
    });
    const keys = await repo(c).list(USER);
    expect(keys).toEqual([
      {
        provider: 'openai',
        last4: 'abcd',
        modelId: 'gpt-test',
        status: 'invalid',
        reason: 'rejected',
        consentAt: 'a',
        updatedAt: 'b',
      },
    ]);
  });
});

describe('saveSettings', () => {
  it('requires a usable key for a provider, in the same transaction', async () => {
    const { c, transactions } = client();
    await repo(c).saveSettings(USER, 'anthropic', 0, AUDIT);
    expect(transactions[0]?.[2]?.ConditionCheck).toMatchObject({
      TableName: 'AiKeys',
      Key: { userId: USER, provider: 'anthropic' },
      ConditionExpression: 'attribute_exists(userId) AND #status <> :invalid',
    });
  });

  it('needs no key for the platform model or none', async () => {
    for (const source of ['platform', 'none'] as const) {
      const { c, transactions } = client();
      await repo(c).saveSettings(USER, source, 0, AUDIT);
      expect(transactions[0]).toHaveLength(2);
    }
  });

  it('refuses a missing or invalid key', async () => {
    const { c } = client({
      onTransact: () => {
        throw cancelled('None', 'None', 'ConditionalCheckFailed');
      },
    });
    await expect(repo(c).saveSettings(USER, 'openai', 0, AUDIT)).rejects.toBeInstanceOf(
      AiKeyNotUsableError,
    );
  });
});
