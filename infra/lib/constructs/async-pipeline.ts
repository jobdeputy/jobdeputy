import { Stack } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import type { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { addQueueWorker, type QueueWorkerProps } from './queue-worker.js';

export interface AsyncPipelineProps extends QueueWorkerProps {
  /** Table with a NEW_IMAGE stream. Only inserts with status=queued start work. */
  readonly table: Table;
  /** Name of the string partition key sent to the worker as `id`. */
  readonly idAttribute: string;
  /**
   * Instead of `id`: string key attributes sent under their own names, for tables
   * keyed by more than one attribute (for example `userId` and `crawlId`).
   */
  readonly messageKeys?: readonly string[];
  /** Extra conditions on the new item, for tables where only some inserts start work. */
  readonly newImageFilter?: Record<string, unknown>;
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

    const { queue, deadLetterQueue } = addQueueWorker(this, props);
    this.queue = queue;
    this.deadLetterQueue = deadLetterQueue;

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

    const pipe = new CfnPipe(this, 'Pipe', {
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
                dynamodb: { NewImage: { status: { S: ['queued'] }, ...props.newImageFilter } },
              }),
            },
          ],
        },
      },
      target: this.queue.queueArn,
      targetParameters: {
        // IDs only: no user data in queue messages.
        inputTemplate: props.messageKeys
          ? `{${props.messageKeys.map((k) => `"${k}": "<$.dynamodb.Keys.${k}.S>"`).join(', ')}}`
          : `{"id": "<$.dynamodb.Keys.${props.idAttribute}.S>"}`,
      },
    });
    // The Pipe only references the role's ARN, so CloudFormation could create it before
    // the role's policy exists; the Pipe then fails to validate its dead-letter queue
    // ("Error occurred while sending message to SQS queue"). Seen on a PR stack
    // (2026-09-29). Depending on the role includes its policy.
    pipe.node.addDependency(role);
  }
}
