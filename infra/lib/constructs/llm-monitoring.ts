import { LLM_METRICS_NAMESPACE } from '@jobdeputy/shared';
import { Duration } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  TextWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import type { StageName } from '../../config/stages.js';

export { LLM_METRICS_NAMESPACE };

/** Alarm thresholds per hour, across all tasks. Tuned with real data later (T08e). */
export const LLM_ALARM_THRESHOLDS = { rejectedOutputs: 10, timeouts: 5 } as const;

/**
 * The environment every LLM worker gets (T08d): prod records per model, prompt version, and
 * key source as well; dev per task only (agreed 2026-09-30).
 */
export function llmMetricsEnvironment(stage: StageName): Record<string, string> {
  return { LLM_METRICS_DETAIL: stage === 'prod' ? 'full' : 'task' };
}

export interface LlmMonitoringProps {
  readonly namePrefix: string;
  readonly stage: StageName;
  /** Shared stacks only: personal and PR stacks get no dashboard and no alarms. */
  readonly alarmTopic: ITopic;
}

/**
 * T08b3 (decision 0009): how LLM tasks behave, from the metrics every task call writes
 * (packages/llm/src/metrics.ts). One dashboard and two alarms on the totals. The two alarms
 * are paid (about $0.10 each a month): agreed on 2026-09-30.
 */
export class LlmMonitoring extends Construct {
  readonly dashboard: Dashboard;

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

    const widgets = [
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
    if (props.stage === 'prod') {
      const perModel = (metricName: string) =>
        new MathExpression({
          expression: `SEARCH('{${LLM_METRICS_NAMESPACE},task,modelId,promptVersion,keySource} MetricName="${metricName}"', 'Sum', 3600)`,
          label: '',
          period: Duration.hours(1),
        });
      widgets.push(
        new GraphWidget({
          title: 'Per task, model, prompt version, and key source: calls and rejected outputs',
          left: [perModel('Calls'), perModel('RejectedOutputs')],
          width: 24,
        }),
      );
    }
    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `${props.namePrefix}-llm`,
      widgets: [widgets],
    });
  }
}
