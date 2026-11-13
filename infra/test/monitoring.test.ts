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
    // T08d1: one queue health check replaced the 8 queue alarms (dead letters and backlogs),
    // so new queues add no alarm. The two LLM alarms (T08b3) are back within the free 10.
    expect(names).toEqual([
      'ApiServerErrorAlarm',
      'LlmMonitoringRejectedOutputsAlarm',
      'LlmMonitoringTimeoutsAlarm',
      'QueueHealthCheckerErrorAlarm',
      'TestDataReaperAlarm',
    ]);
    expect(names.length).toBeLessThanOrEqual(10);
  });

  /** The checker's watched queues, as its environment lists them (resolved names). */
  const watched = (t: Template) => {
    const [fn] = Object.values(t.findResources('AWS::Lambda::Function')).filter(
      (f) => f.Properties.Environment?.Variables?.WATCHED_QUEUES,
    );
    // A join of text and queue URLs: the text alone holds the names and limits.
    const parts: unknown[] =
      fn?.Properties.Environment.Variables.WATCHED_QUEUES['Fn::Join'][1] ?? [];
    const text = parts.filter((p) => typeof p === 'string').join('');
    const names = [...text.matchAll(/"name":"([a-z-]+)"/g)].map((m) => m[1]);
    const backlogs = [...text.matchAll(/"name":"([a-z-]+)"[^}]*?"backlogAfterSeconds":(\d+)/g)].map(
      (m) => [m[1], Number(m[2])],
    );
    return { names: names.sort(), backlogs: backlogs.sort() };
  };

  it("checks every worker queue, and a backlog above each queue's slowest normal path", () => {
    const t = stack('dev', 'jobdeputy-dev-iad');
    const { names, backlogs } = watched(t);
    expect(names).toEqual([
      'account-deletions',
      'crawls',
      'document-scans',
      'key-checks',
      'ping-jobs',
      'relevance',
    ]);
    expect(backlogs).toEqual([
      ['account-deletions', 60 * 60],
      ['crawls', 15 * 60],
      ['document-scans', 30 * 60],
      ['relevance', 30 * 60],
    ]);
    // Every 5 minutes; a missed run is not retried (the next one comes soon).
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(5 minutes)',
      Targets: [Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 0 } })],
    });
  });

  it('gives the checker only the reads and writes it makes', () => {
    const t = stack('dev', 'jobdeputy-dev-iad');
    const [role] = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) =>
      id.startsWith('QueueHealthChecker'),
    );
    const statements = (role?.[1].Properties.PolicyDocument.Statement ?? []) as {
      Action: string | string[];
      Resource: unknown;
    }[];
    const actions = [...new Set(statements.flatMap((s) => [s.Action].flat()))].sort();
    expect(actions).toEqual([
      'sns:Publish',
      'sqs:GetQueueAttributes',
      'ssm:GetParameter',
      'ssm:PutParameter',
    ]);
    const ssm = statements.filter((s) => [s.Action].flat().some((a) => a.startsWith('ssm:')));
    expect(JSON.stringify(ssm.map((s) => s.Resource))).toMatch(/QueueHealthState/);
    // Six queues and their dead-letter queues: counts only.
    const sqs = statements.filter((s) => [s.Action].flat().includes('sqs:GetQueueAttributes'));
    expect(sqs.flatMap((s) => [s.Resource].flat())).toHaveLength(12);
  });

  it('has no queue health check in personal, PR, or (for now) any stack without alarms', () => {
    expect(watched(stack('dev', 'jobdeputy-dev-pr42-iad', 'pr42')).names).toEqual([]);
  });

  it('keeps each prod stack within the 10 free alarms (no reaper, test site, or ping)', () => {
    for (const cell of ['iad', 'bom', 'lhr']) {
      expect(alarmIds(stack('prod', `jobdeputy-prod-${cell}`)).length, cell).toBeLessThanOrEqual(
        10,
      );
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
