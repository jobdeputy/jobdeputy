import { Duration, Lazy, type RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AppFunction } from './node-function.js';

export interface QueueHealthProps {
  /** The stack ID, for example `jobdeputy-dev-iad`; queue names start with it. */
  readonly namePrefix: string;
  readonly alarmTopic: ITopic;
  readonly removalPolicy: RemovalPolicy;
}

/** How often every queue is checked. */
export const QUEUE_HEALTH_EVERY = Duration.minutes(5);

/**
 * T08d1: one scheduled check of every worker queue (apps/worker/src/queue-health.ts)
 * instead of a CloudWatch alarm per queue. A metric-math alarm is billed per metric in
 * it, so merging alarms saves nothing; this costs nothing (Lambda, SQS, and SSM free
 * tiers) however many queues there are. Shared stacks only, like every alarm. Its own
 * errors are the one CloudWatch alarm it keeps.
 */
export class QueueHealth extends Construct {
  readonly checker: AppFunction;
  private readonly watched: {
    name: string;
    queueUrl: string;
    deadLetterUrl: string;
    backlogAfterSeconds?: number;
  }[] = [];
  private readonly namePrefix: string;

  constructor(scope: Construct, id: string, props: QueueHealthProps) {
    super(scope, id);
    this.namePrefix = props.namePrefix;
    // What the last check found, so an email goes out only when something changes. The
    // value here is only the initial one: the checker rewrites it.
    const state = new StringParameter(this, 'State', {
      parameterName: `/jobdeputy/${props.namePrefix}/queue-health`,
      description: 'Queue health check state (written by the checker; do not edit).',
      stringValue: '{}',
    });
    this.checker = new AppFunction(this, 'Checker', {
      entry: 'apps/worker/src/queue-health.ts',
      timeout: Duration.seconds(30),
      removalPolicy: props.removalPolicy,
      environment: {
        WATCHED_QUEUES: Lazy.string({
          produce: () => Stack.of(this).toJsonString(this.watched),
        }),
        ALARM_TOPIC_ARN: props.alarmTopic.topicArn,
        STATE_PARAMETER: state.parameterName,
        STACK_NAME: props.namePrefix,
      },
    });
    const fn = this.checker.fn;
    props.alarmTopic.grantPublish(fn);
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [state.parameterArn],
      }),
    );
    new Rule(this, 'Schedule', {
      schedule: Schedule.rate(QUEUE_HEALTH_EVERY),
      // A missed check is made up 5 minutes later; retrying would only overlap.
      targets: [new LambdaFunction(fn, { retryAttempts: 0 })],
    });
    new Alarm(this, 'CheckerErrorAlarm', {
      alarmDescription:
        'The queue health check failed (queues are not being watched). See docs/runbooks/alarms.md.',
      metric: fn.metricErrors({ period: Duration.minutes(15) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(props.alarmTopic));
  }

  /**
   * Watches a queue: its dead-letter queue must be empty and, with `backlogAfter`, its
   * messages must not wait longer than that without a break. Reads its counts only.
   */
  watch(queueName: string, queue: IQueue, deadLetterQueue: IQueue, backlogAfter?: Duration) {
    const name = queueName.startsWith(`${this.namePrefix}-`)
      ? queueName.slice(this.namePrefix.length + 1)
      : queueName;
    this.watched.push({
      name,
      queueUrl: queue.queueUrl,
      deadLetterUrl: deadLetterQueue.queueUrl,
      ...(backlogAfter ? { backlogAfterSeconds: backlogAfter.toSeconds() } : {}),
    });
    for (const q of [queue, deadLetterQueue]) q.grant(this.checker.fn, 'sqs:GetQueueAttributes');
  }
}
