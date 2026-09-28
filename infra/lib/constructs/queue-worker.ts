import { Duration } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export interface QueueWorkerProps {
  readonly queueName: string;
  readonly worker: IFunction;
  /** The worker's own timeout; the queue's visibility timeout is 6× this (AWS guidance). */
  readonly workerTimeout: Duration;
  /** Receives before a message goes to the dead-letter queue. */
  readonly maxReceives: number;
  /** Maximum concurrent worker invocations (SQS event source, minimum 2). */
  readonly maxConcurrency: number;
  readonly alarmTopic: ITopic;
}

export interface QueueWorker {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;
}

/**
 * Queue → worker with a dead-letter queue and a "not empty" alarm (decision 0003).
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

  new Alarm(scope, 'DeadLetterAlarm', {
    alarmDescription: `Messages in ${props.queueName}-dlq: work failed after all retries.`,
    metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
      period: Duration.minutes(5),
    }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  }).addAlarmAction(new SnsAction(props.alarmTopic));

  return { queue, deadLetterQueue };
}
