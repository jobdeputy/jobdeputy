import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';

const stack = (stage: 'dev' | 'prod', name: string, owner?: string) =>
  Template.fromStack(
    buildApp({ stage, env: {}, ...(owner ? { owner } : {}) }).node.findChild(name) as never,
  );
const alarmIds = (t: Template) => Object.keys(t.findResources('AWS::CloudWatch::Alarm')).sort();

describe('monitoring (T13)', () => {
  it('alarms on API server errors and on the reaper in the shared dev stack', () => {
    const t = stack('dev', 'jobdeputy-dev-iad');
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: '5xx',
      Namespace: 'AWS/ApiGateway',
      Threshold: 1,
      AlarmActions: [Match.anyValue()],
    });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Dimensions: [{ Name: 'FunctionName', Value: Match.anyValue() }],
      AlarmActions: [Match.anyValue()],
    });
    expect(alarmIds(t).filter((id) => /ApiServerError|TestDataReaper/.test(id))).toHaveLength(2);
  });

  it('alarms on API server errors in prod (no reaper there)', () => {
    const ids = alarmIds(stack('prod', 'jobdeputy-prod-lhr'));
    expect(ids.some((id) => id.startsWith('ApiServerErrorAlarm'))).toBe(true);
    expect(ids.some((id) => id.startsWith('TestDataReaperAlarm'))).toBe(false);
  });

  it('creates no alarms at all in personal or PR stacks (no subscribers; free alarms kept for shared stacks)', () => {
    for (const owner of ['nava', 'pr42']) {
      expect(alarmIds(stack('dev', `jobdeputy-dev-${owner}-iad`, owner)), owner).toEqual([]);
    }
  });

  it('has exactly these alarms in the shared dev stack, within the 10 free ones', () => {
    const names = alarmIds(stack('dev', 'jobdeputy-dev-iad')).map((id) =>
      id.replace(/[0-9A-F]{8}$/, ''),
    );
    expect(names).toEqual([
      'ApiServerErrorAlarm',
      'CrawlPipelineBacklogAlarm',
      'CrawlPipelineDeadLetterAlarm',
      'DeletionPipelineBacklogAlarm',
      'DeletionPipelineDeadLetterAlarm',
      'DocumentsBacklogAlarm',
      'DocumentsDeadLetterAlarm',
      'PingPipelineDeadLetterAlarm',
      'TestDataReaperAlarm',
    ]);
  });

  it("alarms when a worker queue backs up, above each queue's slowest normal path", () => {
    const t = stack('dev', 'jobdeputy-dev-iad');
    const backlog = Object.entries(t.findResources('AWS::CloudWatch::Alarm'))
      .filter(([id]) => id.includes('BacklogAlarm'))
      .map(([id, a]) => [
        id.replace(/BacklogAlarm.*/, ''),
        a.Properties.MetricName,
        a.Properties.Threshold,
      ])
      .sort();
    expect(backlog).toEqual([
      ['CrawlPipeline', 'ApproximateAgeOfOldestMessage', 15 * 60],
      ['DeletionPipeline', 'ApproximateAgeOfOldestMessage', 60 * 60],
      ['Documents', 'ApproximateAgeOfOldestMessage', 30 * 60],
    ]);
  });

  it('keeps each prod stack within the 10 free alarms (no reaper, test site, or ping)', () => {
    for (const cell of ['iad', 'bom', 'lhr']) {
      expect(alarmIds(stack('prod', `jobdeputy-prod-${cell}`)).length, cell).toBe(7);
    }
  });

  it('refuses reserved test domains at sign-up in every stage, allowing test users only in dev', () => {
    const env = (t: Template) =>
      Object.values(t.findResources('AWS::Lambda::Function'))
        .map((f) => f.Properties.Environment?.Variables?.ALLOW_TEST_USERS)
        .filter(Boolean);
    const dev = stack('dev', 'jobdeputy-dev-iad');
    dev.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
    expect(env(dev)).toEqual(['true']);
    dev.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'integration-tests' });
    for (const cell of ['iad', 'bom', 'lhr']) {
      const prod = stack('prod', `jobdeputy-prod-${cell}`);
      prod.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: { PreSignUp: Match.anyValue() },
      });
      expect(env(prod), cell).toEqual(['false']);
      prod.resourceCountIs('AWS::Cognito::UserPoolGroup', 0);
    }
  });
});
