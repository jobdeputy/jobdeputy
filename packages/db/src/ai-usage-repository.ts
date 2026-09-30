import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { utcMonth } from '@jobdeputy/shared';

/**
 * T08b3 (decision 0009): the user's AI token use, in `usage`, one item per month, key source,
 * provider, and model: `AI#<yyyy-mm>#<keySource>#<provider>#<modelId>`. Totals, plus the
 * same per task (`task_<name>_calls`, …). Replaces the planned `MONTH#` `llmCalls` and tokens.
 */
export interface AiUsageEntry {
  keySource: 'platform' | 'own';
  provider: string;
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  runs: number;
  byTask: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

export interface AiUsageRecord {
  keySource: 'platform' | 'own';
  provider: string;
  modelId: string;
  task: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** 1 on the first task call of a run (for example a crawl's AI work), else 0. */
  runs?: number;
}

const TASK = /^[a-z][a-z0-9-]{0,31}$/;
const taskField = (task: string, field: string) => `task_${task.replaceAll('-', '_')}_${field}`;

export function aiUsageSk(
  month: string,
  record: Pick<AiUsageRecord, 'keySource' | 'provider' | 'modelId'>,
) {
  return `AI#${month}#${record.keySource}#${record.provider}#${record.modelId}`;
}

/**
 * The transaction item that adds one task call's usage. The caller puts it in the same
 * transaction as the stored result, so a retried message never counts twice.
 */
export function aiUsageUpdate(table: string, userId: string, at: Date, record: AiUsageRecord) {
  if (!TASK.test(record.task)) throw new Error(`invalid task: ${record.task}`);
  const counts = {
    calls: record.calls,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
  };
  const names: Record<string, string> = { '#type': 'type' };
  const values: Record<string, unknown> = {
    ':type': 'usage_ai',
    ':keySource': record.keySource,
    ':provider': record.provider,
    ':modelId': record.modelId,
    ':month': utcMonth(at),
    ':now': at.toISOString(),
    ':one': 1,
    ':runs': record.runs ?? 0,
  };
  const adds = ['#runs :runs'];
  for (const [field, value] of Object.entries(counts)) {
    names[`#${field}`] = field;
    names[`#task_${field}`] = taskField(record.task, field);
    values[`:${field}`] = value;
    adds.push(`#${field} :${field}`, `#task_${field} :${field}`);
  }
  return {
    Update: {
      TableName: table,
      Key: { userId, sk: aiUsageSk(utcMonth(at), record) },
      UpdateExpression: `ADD ${adds.join(', ')} SET #type = :type, #keySource = :keySource, #provider = :provider, #modelId = :modelId, #month = :month, createdAt = if_not_exists(createdAt, :now), updatedAt = :now, schemaVersion = :one`,
      ExpressionAttributeNames: {
        ...names,
        '#month': 'month',
        '#runs': 'runs',
        '#keySource': 'keySource',
        '#provider': 'provider',
        '#modelId': 'modelId',
      },
      ExpressionAttributeValues: values,
    },
  };
}

/** The user's usage in a month, one entry per key source, provider, and model. */
export async function listAiUsage(
  client: DynamoDBDocumentClient,
  table: string,
  userId: string,
  month: string,
): Promise<AiUsageEntry[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'userId = :userId AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':userId': userId, ':prefix': `AI#${month}#` },
      ConsistentRead: true,
    }),
  );
  return (res.Items ?? []).map((item) => {
    const byTask: AiUsageEntry['byTask'] = {};
    for (const [key, value] of Object.entries(item)) {
      const match = /^task_(.+)_(calls|inputTokens|outputTokens)$/.exec(key);
      if (!match?.[1] || !match[2] || typeof value !== 'number') continue;
      const task = match[1].replaceAll('_', '-');
      byTask[task] ??= { calls: 0, inputTokens: 0, outputTokens: 0 };
      byTask[task][match[2] as 'calls'] = value;
    }
    return {
      keySource: item.keySource,
      provider: item.provider,
      modelId: item.modelId,
      calls: Number(item.calls ?? 0),
      inputTokens: Number(item.inputTokens ?? 0),
      outputTokens: Number(item.outputTokens ?? 0),
      runs: Number(item.runs ?? 0),
      byTask,
    };
  });
}
