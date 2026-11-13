import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let shared: DynamoDBDocumentClient | undefined;

/** One client per Lambda container, reused across invocations. */
export function documentClient(): DynamoDBDocumentClient {
  shared ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return shared;
}

export function isConditionFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

/** A transaction was cancelled because the condition on item `index` failed. */
export function cancelledAt(error: unknown, index: number): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] })
    .CancellationReasons;
  return reasons?.[index]?.Code === 'ConditionalCheckFailed';
}
