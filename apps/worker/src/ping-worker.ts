import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { ChangeMessageVisibilityCommand, SQSClient } from '@aws-sdk/client-sqs';
import { documentClient, type PingRepository, PingRepository as Repo } from '@jobdeputy/db';
import { createLogger, type PingJobMessage, pingJobMessage } from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { withDeadline } from './deadline.js';

const logger = createLogger('worker');

/** Matches the queue's maxReceiveCount (T04 decision: 3 tries, then the dead-letter queue). */
export const MAX_RECEIVES = 3;
/** Seconds before retry 2 and retry 3. */
export const RETRY_BACKOFF_SECONDS = [10, 30] as const;
/** Stop work this long before Lambda's own timeout. */
export const SAFETY_MARGIN_MS = 5_000;

type Repository = Pick<
  PingRepository,
  'markRunning' | 'completeWithSideEffect' | 'recordAttemptError' | 'markFailed'
>;

export type RunResult = { outcome: 'succeeded' | 'skipped' };

/** One attempt at a ping job. Throws to ask for a retry. */
export async function runPingJob(message: PingJobMessage, repo: Repository): Promise<RunResult> {
  const job = await repo.markRunning(message.id);
  if (!job) {
    logger.info('Job missing or already final; skipping', { jobId: message.id });
    return { outcome: 'skipped' };
  }
  if (job.fail) throw new Error('Forced failure (dev test flag)');
  const done = await repo.completeWithSideEffect(message.id);
  return { outcome: done ? 'succeeded' : 'skipped' };
}

export interface RecordDeps {
  repo: Repository;
  run: (message: PingJobMessage) => Promise<RunResult>;
  delayRetry: (record: SQSRecord, seconds: number) => Promise<void>;
  remainingMs: () => number;
}

export async function processRecord(record: SQSRecord, deps: RecordDeps): Promise<RunResult> {
  const parsed = pingJobMessage.safeParse(safeJson(record.body));
  if (!parsed.success) {
    // Nothing to retry: let it fail through to the dead-letter queue for inspection.
    logger.error('Malformed message', { messageId: record.messageId });
    throw new Error('Malformed message');
  }
  const { id } = parsed.data;
  const receiveCount = Number(record.attributes.ApproximateReceiveCount);
  try {
    return await withDeadline(deps.run(parsed.data), deps.remainingMs() - SAFETY_MARGIN_MS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (receiveCount >= MAX_RECEIVES) {
      logger.error('Job failed on its last attempt', { jobId: id, receiveCount, reason });
      await deps.repo.markFailed(id, reason);
      // Visible again at once, so SQS moves it to the dead-letter queue now
      // instead of after the full visibility timeout.
      await deps.delayRetry(record, 0).catch(() => undefined);
    } else {
      logger.warn('Attempt failed; will retry', { jobId: id, receiveCount, reason });
      await deps.repo.recordAttemptError(id, reason);
      const backoff = RETRY_BACKOFF_SECONDS[receiveCount - 1];
      if (backoff !== undefined) await deps.delayRetry(record, backoff).catch(() => undefined);
    }
    throw error;
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function queueUrlFromArn(arn: string): string {
  const [, , , region, account, name] = arn.split(':');
  return `https://sqs.${region}.amazonaws.com/${account}/${name}`;
}

let deps: RecordDeps | undefined;
let idempotencyConfig: IdempotencyConfig | undefined;
let currentContext: Context | undefined;
const processor = new BatchProcessor(EventType.SQS);

function defaultDeps(): { deps: RecordDeps; config: IdempotencyConfig } {
  const tableName = process.env.PING_TABLE_NAME;
  const idempotencyTable = process.env.IDEMPOTENCY_TABLE_NAME;
  if (!tableName || !idempotencyTable) throw new Error('Table names are not set');
  const repo = new Repo(documentClient(), tableName);
  const sqs = new SQSClient({});
  const config = new IdempotencyConfig({ eventKeyJmesPath: 'id', expiresAfterSeconds: 3600 });
  const run = makeIdempotent((message: PingJobMessage) => runPingJob(message, repo), {
    persistenceStore: new DynamoDBPersistenceLayer({ tableName: idempotencyTable }),
    config,
  });
  return {
    config,
    deps: {
      repo,
      run,
      remainingMs: () => currentContext?.getRemainingTimeInMillis() ?? 30_000,
      delayRetry: async (record, seconds) => {
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrlFromArn(record.eventSourceARN),
            ReceiptHandle: record.receiptHandle,
            VisibilityTimeout: seconds,
          }),
        );
      },
    },
  };
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  currentContext = context;
  if (!deps) {
    const built = defaultDeps();
    deps = built.deps;
    idempotencyConfig = built.config;
  }
  idempotencyConfig?.registerLambdaContext(context);
  const current = deps;
  return processPartialResponse(
    event,
    (record: SQSRecord) => processRecord(record, current),
    processor,
    {
      context,
    },
  );
}
