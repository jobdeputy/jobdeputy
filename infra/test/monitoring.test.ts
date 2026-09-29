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

  it('adds no extra alarms to personal or PR stacks (no subscribers; stays in the free tier)', () => {
    for (const owner of ['nava', 'pr42']) {
      const ids = alarmIds(stack('dev', `jobdeputy-dev-${owner}-iad`, owner));
      expect(ids.filter((id) => /ApiServerError|TestDataReaper/.test(id))).toEqual([]);
    }
  });

  it('keeps each shared stack within the 10 free alarms', () => {
    expect(alarmIds(stack('dev', 'jobdeputy-dev-iad')).length).toBeLessThanOrEqual(10);
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
