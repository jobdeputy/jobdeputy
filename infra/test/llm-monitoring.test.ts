import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { LLM_METRICS_NAMESPACE, latencyBaselines } from '../lib/constructs/llm-monitoring.js';

// T08b3 (0009): LLM dashboard and alarms; the free-run limits live in the crawl limits setting.

const cell = (stage: 'dev' | 'prod', owner?: string) => {
  const name = owner ? `jobdeputy-${stage}-${owner}-iad` : `jobdeputy-${stage}-iad`;
  return Template.fromStack(
    buildApp({ stage, env: {}, ...(owner ? { owner } : {}) }).node.findChild(name) as never,
  );
};

describe('LLM monitoring (T08b3)', () => {
  it('has one dashboard and two alarms on the totals in shared stacks, none in personal or PR stacks', () => {
    for (const stage of ['dev', 'prod'] as const) {
      const t = cell(stage);
      t.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: LLM_METRICS_NAMESPACE,
        MetricName: 'RejectedOutputs',
        Threshold: 10,
      });
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: LLM_METRICS_NAMESPACE,
        MetricName: 'Timeouts',
        Threshold: 5,
      });
    }
    const pr = cell('dev', 'pr42');
    pr.resourceCountIs('AWS::CloudWatch::Dashboard', 0);
  });

  it('shows per task, prompt version, and model from the log lines, not from metrics', () => {
    for (const stage of ['dev', 'prod'] as const) {
      const body = JSON.stringify(
        Object.values(cell(stage).findResources('AWS::CloudWatch::Dashboard'))[0],
      );
      expect(body).toContain('by task, promptVersion, modelId');
      expect(body).not.toContain('task,modelId,promptVersion,keySource');
    }
  });
});

describe('daily LLM report (T08e1)', () => {
  const report = (t: Template) => {
    const [fn] = Object.values(t.findResources('AWS::Lambda::Function')).filter(
      (f) => f.Properties.Environment?.Variables?.LATENCY_BASELINES,
    );
    return fn?.Properties.Environment.Variables;
  };

  it('runs once a day in shared stacks only, over the relevance worker’s logs', () => {
    const t = cell('dev');
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(30 3 * * ? *)' });
    expect(JSON.stringify(report(t).LOG_GROUPS)).toContain('RelevanceRelevanceWorkerLogs');
    expect(report(cell('dev', 'pr42'))).toBeUndefined();
  });

  it('knows each prompt version’s eval baseline', () => {
    expect(latencyBaselines()['relevance@v2']).toEqual({
      modelId: 'mistral.ministral-3-14b-instruct',
      medianMs: expect.any(Number),
    });
  });

  it('may start queries on the LLM workers’ log groups only, and publish to the alarm topic', () => {
    const statements = Object.entries(cell('dev').findResources('AWS::IAM::Policy'))
      .filter(([id]) => id.startsWith('LlmMonitoringReport'))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat());
    expect(actions.sort()).toEqual(['logs:GetQueryResults', 'logs:StartQuery', 'sns:Publish']);
    const start = statements.find((s: { Action: string }) => s.Action === 'logs:StartQuery');
    expect(JSON.stringify(start.Resource)).toContain('RelevanceRelevanceWorkerLogs');
    expect(JSON.stringify(start.Resource)).not.toContain('"*"');
  });
});

describe('free platform run limits (T08b3)', () => {
  it('keep the limits setting’s first value unchanged, so a deploy never overwrites the admin’s', () => {
    const [param] = Object.values(cell('dev').findResources('AWS::SSM::Parameter')).filter((p) =>
      String(p.Properties.Name).endsWith('/crawl-limits'),
    );
    expect(JSON.parse(param?.Properties.Value)).toEqual({
      dailyDefault: 20,
      dailyMax: 50,
      maxActive: 1,
    });
  });

  it('lets the AI API read only that one parameter', () => {
    const t = cell('dev');
    const ssm = Object.entries(t.findResources('AWS::IAM::Policy'))
      .filter(([id]) => id.startsWith('AiKeysAiApi'))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement)
      .filter((s: { Action: string | string[] }) =>
        [s.Action].flat().some((a) => a.startsWith('ssm:')),
      );
    expect(ssm).toHaveLength(1);
    expect(ssm[0].Action).toBe('ssm:GetParameter');
  });
});
