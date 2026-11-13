import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { LLM_METRICS_NAMESPACE, llmMetricsEnvironment } from '../lib/constructs/llm-monitoring.js';

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

  it('shows per model and prompt version in prod only', () => {
    const body = (t: Template) =>
      JSON.stringify(Object.values(t.findResources('AWS::CloudWatch::Dashboard'))[0]);
    expect(body(cell('prod'))).toContain('promptVersion');
    expect(body(cell('dev'))).not.toContain('promptVersion');
    expect(llmMetricsEnvironment('prod')).toEqual({ LLM_METRICS_DETAIL: 'full' });
    expect(llmMetricsEnvironment('dev')).toEqual({ LLM_METRICS_DETAIL: 'task' });
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
