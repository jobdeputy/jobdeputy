import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

type Item = Record<string, unknown>;

function conditionFailed(): Error {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

/**
 * In-memory stand-in for the userId/sk tables, supporting exactly the
 * conditions the repositories use. `beforePut` lets a test simulate a
 * concurrent write between a read and a write. Transactions (T06d) put the
 * item and its audit entry together: audit entries (any table named `audit`)
 * are collected in `audit`, and nothing is written if a condition fails.
 */
export function fakeTable() {
  const items = new Map<string, Item>();
  const audit: Item[] = [];
  /** `usage` counters (T06 review): itemCount per user and counter. */
  const counters = new Map<string, number>();
  const key = (k: Item) => `${k.userId}|${k.sk}`;
  const hooks: { beforePut?: () => void } = {};

  function putAllowed(input: PutCommand['input']): boolean {
    const existing = items.get(key(input.Item as Item));
    const cond = input.ConditionExpression;
    if (cond === 'attribute_not_exists(userId)' && existing) return false;
    if (cond === 'version = :expected') {
      const expected = input.ExpressionAttributeValues?.[':expected'];
      if (!existing || existing.version !== expected) return false;
    }
    return true;
  }

  const client = {
    send: async (cmd: unknown) => {
      if (cmd instanceof GetCommand && cmd.input.TableName === 'usage') {
        const count = counters.get(key(cmd.input.Key as Item));
        return { Item: count === undefined ? undefined : { itemCount: count } };
      }
      if (cmd instanceof UpdateCommand && cmd.input.TableName === 'usage') {
        // repairUsageCounter: set the count to what exists.
        counters.set(
          key(cmd.input.Key as Item),
          Number(cmd.input.ExpressionAttributeValues?.[':count']),
        );
        return {};
      }
      if (cmd instanceof GetCommand) {
        const item = items.get(key(cmd.input.Key as Item));
        return { Item: item ? structuredClone(item) : undefined };
      }
      if (cmd instanceof PutCommand) {
        hooks.beforePut?.();
        if (!putAllowed(cmd.input)) throw conditionFailed();
        const item = cmd.input.Item as Item;
        items.set(key(item), structuredClone(item));
        return {};
      }
      if (cmd instanceof TransactWriteCommand) {
        hooks.beforePut?.();
        const writes = cmd.input.TransactItems ?? [];
        const counterOk = (u: NonNullable<(typeof writes)[number]['Update']>) => {
          const values = u.ExpressionAttributeValues ?? {};
          const count = counters.get(key(u.Key as Item)) ?? 0;
          if (String(u.UpdateExpression).includes('+ :one')) return count < Number(values[':max']);
          return true;
        };
        const reasons = writes.map((w) => {
          if (w.Put?.TableName === 'audit') return 'None';
          if (w.Update?.TableName === 'usage')
            return counterOk(w.Update) ? 'None' : 'ConditionalCheckFailed';
          if (w.Put)
            return putAllowed(w.Put as PutCommand['input']) ? 'None' : 'ConditionalCheckFailed';
          if (w.Delete)
            return items.has(key(w.Delete.Key as Item)) ? 'None' : 'ConditionalCheckFailed';
          throw new Error('Unsupported transaction item');
        });
        if (reasons.includes('ConditionalCheckFailed')) {
          const e = new Error('Transaction cancelled');
          e.name = 'TransactionCanceledException';
          throw Object.assign(e, { CancellationReasons: reasons.map((Code) => ({ Code })) });
        }
        for (const w of writes) {
          if (w.Put?.TableName === 'audit') audit.push(structuredClone(w.Put.Item as Item));
          else if (w.Put) items.set(key(w.Put.Item as Item), structuredClone(w.Put.Item as Item));
          else if (w.Delete) items.delete(key(w.Delete.Key as Item));
          else if (w.Update?.TableName === 'usage') {
            const k = key(w.Update.Key as Item);
            const up = String(w.Update.UpdateExpression).includes('+ :one');
            counters.set(k, Math.max(0, (counters.get(k) ?? 0) + (up ? 1 : -1)));
          }
        }
        return {};
      }
      if (cmd instanceof QueryCommand) {
        const v = cmd.input.ExpressionAttributeValues ?? {};
        const found = [...items.values()].filter(
          (i) => i.userId === v[':u'] && String(i.sk).startsWith(String(v[':p'])),
        );
        return { Items: found.map((i) => structuredClone(i)) };
      }
      if (cmd instanceof DeleteCommand) {
        const k = key(cmd.input.Key as Item);
        if (!items.has(k)) throw conditionFailed();
        items.delete(k);
        return {};
      }
      throw new Error(`Unsupported command ${String(cmd)}`);
    },
  } as unknown as DynamoDBDocumentClient;

  return { client, items, audit, counters, hooks };
}
