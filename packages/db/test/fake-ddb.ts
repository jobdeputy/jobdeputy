import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

type Item = Record<string, unknown>;

function conditionFailed(): Error {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
}

/**
 * In-memory stand-in for the userId/sk tables, supporting exactly the
 * conditions the repositories use. `beforePut` lets a test simulate a
 * concurrent write between a read and a write.
 */
export function fakeTable() {
  const items = new Map<string, Item>();
  const key = (k: Item) => `${k.userId}|${k.sk}`;
  const hooks: { beforePut?: () => void } = {};

  const client = {
    send: async (cmd: unknown) => {
      if (cmd instanceof GetCommand) {
        const item = items.get(key(cmd.input.Key as Item));
        return { Item: item ? structuredClone(item) : undefined };
      }
      if (cmd instanceof PutCommand) {
        hooks.beforePut?.();
        const item = cmd.input.Item as Item;
        const existing = items.get(key(item));
        const cond = cmd.input.ConditionExpression;
        if (cond === 'attribute_not_exists(userId)' && existing) throw conditionFailed();
        if (cond === 'version = :expected') {
          const expected = cmd.input.ExpressionAttributeValues?.[':expected'];
          if (!existing || existing.version !== expected) throw conditionFailed();
        }
        items.set(key(item), structuredClone(item));
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

  return { client, items, hooks };
}
