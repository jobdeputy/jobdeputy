import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LLM_METRICS_NAMESPACE } from '@jobdeputy/shared';
import { ArnFormat, Duration, Lazy, type RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  type IWidget,
  LogQueryWidget,
  MathExpression,
  Metric,
  TextWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { StageName } from '../../config/stages.js';
import { AppFunction, REPO_ROOT } from './node-function.js';

export { LLM_METRICS_NAMESPACE };

/** Alarm thresholds per hour, across all tasks. Tuned with real data by the daily LLM report (T08e, #65). */
export const LLM_ALARM_THRESHOLDS = { rejectedOutputs: 10, timeouts: 5 } as const;

/** The daily LLM report runs at 03:30 UTC (09:00 in India), over the day before. */
export const LLM_REPORT_SCHEDULE = Schedule.cron({ minute: '30', hour: '3' });

/**
 * Each prompt version's eval baseline (packages/llm/eval/baselines): the model it ran on
 * and its median latency, for the report's latency limit.
 */
export function latencyBaselines(): Record<string, { modelId: string; medianMs: number }> {
  const dir = join(REPO_ROOT, 'packages', 'llm', 'eval', 'baselines');
  const baselines: Record<string, { modelId: string; medianMs: number }> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const b = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (typeof b.medianMs === 'number' && b.medianMs > 0) {
      baselines[b.promptVersion] = { modelId: b.modelId, medianMs: b.medianMs };
    }
  }
  return baselines;
}

export interface LlmMonitoringProps {
  readonly namePrefix: string;
  readonly stage: StageName;
  /** Shared stacks only: personal and PR stacks get no dashboard and no alarms. */
  readonly alarmTopic: ITopic;
  readonly removalPolicy: RemovalPolicy;
}

/**
 * T08b3 (decision 0009): how LLM tasks behave, from the metrics every task call writes
 * (packages/llm/src/metrics.ts). One dashboard and two alarms on the totals.
 *
 * T08e1: the split by task, prompt version, and model is read from the log lines: the
 * dashboard's table and the daily LLM report (apps/worker/src/llm-report.ts), which emails
 * only when a limit is crossed. LLM workers register with `watch`.
 */
export class LlmMonitoring extends Construct {
  readonly dashboard: Dashboard;
  readonly report: AppFunction;
  private readonly logGroups: string[] = [];

  constructor(scope: Construct, id: string, props: LlmMonitoringProps) {
    super(scope, id);
    const total = (metricName: string, statistic = 'Sum') =>
      new Metric({
        namespace: LLM_METRICS_NAMESPACE,
        metricName,
        statistic,
        period: Duration.hours(1),
      });
    const perTask = (metricName: string, statistic = 'Sum') =>
      new MathExpression({
        expression: `SEARCH('{${LLM_METRICS_NAMESPACE},task} MetricName="${metricName}"', '${statistic}', 3600)`,
        label: '',
        period: Duration.hours(1),
      });

    const alarm = (logicalId: string, metricName: string, threshold: number, what: string) =>
      new Alarm(this, logicalId, {
        alarmDescription: `${what}: ${threshold} or more in an hour, across all LLM tasks. See docs/runbooks/alarms.md (LLM tasks).`,
        metric: total(metricName),
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(props.alarmTopic));
    alarm(
      'RejectedOutputsAlarm',
      'RejectedOutputs',
      LLM_ALARM_THRESHOLDS.rejectedOutputs,
      'Model replies rejected as invalid output',
    );
    alarm(
      'TimeoutsAlarm',
      'Timeouts',
      LLM_ALARM_THRESHOLDS.timeouts,
      'LLM task calls that timed out',
    );

    const widgets: IWidget[] = [
      new TextWidget({
        markdown: `# LLM tasks (${props.stage})\nFrom packages/llm/src/metrics.ts. No user IDs. What to do: docs/runbooks/alarms.md (LLM tasks).`,
        width: 24,
        height: 2,
      }),
      new GraphWidget({
        title: 'Calls, rejected outputs, partial results, timeouts (all tasks)',
        left: ['Calls', 'RejectedOutputs', 'Partial', 'Timeouts'].map((m) => total(m)),
        width: 12,
      }),
      new GraphWidget({
        title: 'Tokens (all tasks)',
        left: ['InputTokens', 'OutputTokens'].map((m) => total(m)),
        width: 12,
      }),
      new GraphWidget({
        title: 'Latency per task call (p50, p90)',
        left: [total('LatencyMs', 'p50'), total('LatencyMs', 'p90')],
        width: 12,
      }),
      new GraphWidget({
        title: 'Rejected outputs and grounding rejections per task',
        left: [perTask('RejectedOutputs'), perTask('GroundingRejections')],
        width: 12,
      }),
    ];
    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `${props.namePrefix}-llm`,
      widgets: [widgets],
    });

    this.report = new AppFunction(this, 'Report', {
      entry: 'apps/worker/src/llm-report.ts',
      timeout: Duration.minutes(3),
      removalPolicy: props.removalPolicy,
      environment: {
        LOG_GROUPS: Lazy.string({ produce: () => Stack.of(this).toJsonString(this.logGroups) }),
        LATENCY_BASELINES: JSON.stringify(latencyBaselines()),
        ALARM_TOPIC_ARN: props.alarmTopic.topicArn,
        STACK_NAME: props.namePrefix,
      },
    });
    const fn = this.report.fn;
    props.alarmTopic.grantPublish(fn);
    // Reading a query's results cannot be limited to a log group (IAM: no resource type).
    fn.addToRolePolicy(
      new PolicyStatement({ actions: ['logs:GetQueryResults'], resources: ['*'] }),
    );
    new Rule(this, 'ReportSchedule', {
      schedule: LLM_REPORT_SCHEDULE,
      // Retried twice: a missed day is not made up. It emails only at the end, so a
      // retry sends at most one email.
      targets: [new LambdaFunction(fn, { retryAttempts: 2 })],
    });
    new Alarm(this, 'ReportErrorAlarm', {
      alarmDescription:
        'The daily LLM report failed (LLM quality is not being checked). See docs/runbooks/alarms.md.',
      metric: fn.metricErrors({ period: Duration.hours(1) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(props.alarmTopic));
  }

  /** Reads `worker`'s log lines in a dashboard table and in the daily report. */
  watch(name: string, worker: AppFunction) {
    const { logGroupName, logGroupArn } = worker.logGroup;
    this.logGroups.push(logGroupName);
    this.dashboard.addWidgets(
      new LogQueryWidget({
        title: `${name}: per task, prompt version, and model (from the log lines)`,
        logGroupNames: [logGroupName],
        queryLines: [
          'filter ispresent(task) and ispresent(Calls)',
          'stats count(*) as taskCalls, sum(Calls) as modelCalls, sum(RejectedOutputs) as rejected, sum(Partial) as partial, sum(GroundingRejections) as grounding, pct(LatencyMs, 95) as p95Ms by task, promptVersion, modelId, keySource',
        ],
        width: 24,
      }),
    );
    this.report.fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:StartQuery'],
        // The group, with and without the `:*` that LogGroup's ARN ends with.
        resources: [
          logGroupArn,
          Stack.of(this).formatArn({
            service: 'logs',
            resource: 'log-group',
            resourceName: logGroupName,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );
  }
}
