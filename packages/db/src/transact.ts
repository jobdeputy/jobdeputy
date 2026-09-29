import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TransactWriteCommand, type TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * When two transactions touch the same item at the same moment, DynamoDB cancels one
 * with `TransactionConflict` (not a failed condition), and the SDK does not retry it.
 * Found on real AWS (2026-09-29): concurrent crawl submits share the user's usage
 * counters, and a double-clicked save hit the same item, so requests failed with 500.
 */
export const TRANSACTION_RETRY = {
  /** The first try plus up to 3 retries. */
  maxAttempts: 4,
  /** "Full jitter": each wait is random between 0 and base × 2^retry, at most capMs. */
  baseMs: 25,
  capMs: 400,
} as const;

/** Still conflicting after every retry: the caller answers 409 "try again", never 500. */
export class ConcurrentUpdateError extends Error {
  override name = 'ConcurrentUpdateError';
}

export interface RetryOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function reasons(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return undefined;
  const list = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return (list ?? []).map((r) => r.Code ?? 'None');
}

/** Only a pure conflict is retried: a failed condition is an answer, not a race to wait out. */
export function isTransactionConflict(error: unknown): boolean {
  const codes = reasons(error) ?? [];
  return codes.includes('TransactionConflict') && !codes.includes('ConditionalCheckFailed');
}

/** The wait before retry `retry` (1-based): random in [0, min(cap, base × 2^retry)]. */
export function jitteredDelay(retry: number, random: () => number = Math.random): number {
  return Math.floor(
    random() * Math.min(TRANSACTION_RETRY.capMs, TRANSACTION_RETRY.baseMs * 2 ** retry),
  );
}

/**
 * Sends a transaction, retrying pure conflicts with jitter up to `maxAttempts` in total;
 * then throws ConcurrentUpdateError. Every other outcome, including a failed condition,
 * is returned or thrown as it is. Safe to repeat: a cancelled transaction wrote nothing.
 */
export async function transactWrite(
  client: DynamoDBDocumentClient,
  input: TransactWriteCommandInput,
  options: RetryOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? TRANSACTION_RETRY.maxAttempts;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.send(new TransactWriteCommand(input));
      return;
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt >= maxAttempts) {
        throw new ConcurrentUpdateError(
          'Another change to the same data was saved at the same moment',
          {
            cause: error,
          },
        );
      }
      await sleep(jitteredDelay(attempt, options.random));
    }
  }
}
