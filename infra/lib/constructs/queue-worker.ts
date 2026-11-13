import { Duration } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { QueueHealth } from './queue-health.js';

export interface QueueWorkerProps {
  readonly queueName: string;
  readonly worker: IFunction;
  /** The worker's own timeout; the queue's visibility timeout is 6× this (AWS guidance). */
  readonly workerTimeout: Duration;
  /** Receives before a message goes to the dead-letter queue. */
  readonly maxReceives: number;
  /** Maximum concurrent worker invocations (SQS event source, minimum 2). */
  readonly maxConcurrency: number;
  /**
   * T08d1: the queue health check that watches this queue (dead letters, and a backlog
   * past `backlogAfter`). Shared stacks only: personal and PR stacks have no subscribers.
   */
  readonly health?: QueueHealth | undefined;
  /**
   * A backlog when messages have waited this long without a break: the worker is stuck,
   * throttled, or failing slowly. Longer than the slowest normal path (retries and delays).
   */
  readonly backlogAfter?: Duration;
}

export interface QueueWorker {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;
}

/**
 * Queue → worker with a dead-letter queue, watched by the queue health check (decision
 * 0003; T08d1).
 * Created directly in `scope`, so the construct IDs stay stable for existing stacks.
 */
export function addQueueWorker(scope: Construct, props: QueueWorkerProps): QueueWorker {
  const deadLetterQueue = new Queue(scope, 'DeadLetterQueue', {
    queueName: `${props.queueName}-dlq`,
    retentionPeriod: Duration.days(14),
    encryption: QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
  });
  const queue = new Queue(scope, 'Queue', {
    queueName: props.queueName,
    visibilityTimeout: Duration.seconds(props.workerTimeout.toSeconds() * 6),
    retentionPeriod: Duration.days(4),
    encryption: QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
    deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: props.maxReceives },
  });

  props.worker.addEventSource(
    new SqsEventSource(queue, {
      batchSize: 1,
      maxConcurrency: props.maxConcurrency,
      reportBatchItemFailures: true,
    }),
  );

  props.health?.watch(props.queueName, queue, deadLetterQueue, props.backlogAfter);

  return { queue, deadLetterQueue };
}
