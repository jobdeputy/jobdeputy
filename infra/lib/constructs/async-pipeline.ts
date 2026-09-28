import { Duration, Stack } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface AsyncPipelineProps {
  /** Table with a NEW_IMAGE stream. Only inserts with status=queued start work. */
  readonly table: Table;
  /** Name of the string partition key sent to the worker as `id`. */
  readonly idAttribute: string;
  readonly worker: IFunction;
  /** The worker's own timeout; the queue's visibility timeout is 6× this. */
  readonly workerTimeout: Duration;
  /** Receives before a message goes to the dead-letter queue. */
  readonly maxReceives: number;
  /** Maximum concurrent worker invocations (SQS event source, minimum 2). */
  readonly maxConcurrency: number;
  readonly alarmTopic: ITopic;
  readonly queueName: string;
}

/**
 * The async backbone from decision 0003:
 * DynamoDB stream → EventBridge Pipe (filter, IDs only) → SQS (+ DLQ) → worker.
 */
export class AsyncPipeline extends Construct {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;

  constructor(scope: Construct, id: string, props: AsyncPipelineProps) {
    super(scope, id);
    if (!props.table.tableStreamArn) throw new Error('AsyncPipeline needs a table with a stream.');

    this.deadLetterQueue = new Queue(this, 'DeadLetterQueue', {
      queueName: `${props.queueName}-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    this.queue = new Queue(this, 'Queue', {
      queueName: props.queueName,
      visibilityTimeout: Duration.seconds(props.workerTimeout.toSeconds() * 6),
      retentionPeriod: Duration.days(4),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: props.maxReceives },
    });

    const role = new Role(this, 'PipeRole', {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': Stack.of(this).account } },
      }),
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [props.table.tableStreamArn],
      }),
    );
    this.queue.grantSendMessages(role);
    this.deadLetterQueue.grantSendMessages(role);

    new CfnPipe(this, 'Pipe', {
      roleArn: role.roleArn,
      source: props.table.tableStreamArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          // Not LATEST: records written while the Pipe is (re)starting would be lost.
          // Replays are harmless because the filter and the worker skip finished items.
          startingPosition: 'TRIM_HORIZON',
          batchSize: 1,
          maximumRetryAttempts: 2,
          deadLetterConfig: { arn: this.deadLetterQueue.queueArn },
        },
        // Every write fires the stream; only new, queued items start work.
        // Filtered-out events are not billed.
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({
                eventName: ['INSERT'],
                dynamodb: { NewImage: { status: { S: ['queued'] } } },
              }),
            },
          ],
        },
      },
      target: this.queue.queueArn,
      targetParameters: {
        // IDs only: no user data in queue messages.
        inputTemplate: `{"id": "<$.dynamodb.Keys.${props.idAttribute}.S>"}`,
      },
    });

    props.worker.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 1,
        maxConcurrency: props.maxConcurrency,
        reportBatchItemFailures: true,
      }),
    );

    new Alarm(this, 'DeadLetterAlarm', {
      alarmDescription: `Messages in ${props.queueName}-dlq: a job failed after all retries.`,
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(props.alarmTopic));
  }
}
