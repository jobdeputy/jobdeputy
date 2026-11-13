import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { FINAL_SWEEP_DELAY_SECONDS } from '../../apps/worker/src/deletion-worker.js';
import { buildApp } from '../lib/build-app.js';

const t = Template.fromStack(
  buildApp({ stage: 'dev', env: {} }).node.findChild('jobdeputy-dev-iad') as never,
);

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
const statementsFor = (prefix: string): Statement[] =>
  Object.entries(t.findResources('AWS::IAM::Policy'))
    .filter(([id]) => id.startsWith(prefix))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);

/** Logical IDs of every table whose partition key is userId: all user data. */
function userTableIds(): string[] {
  return Object.entries(t.findResources('AWS::DynamoDB::Table'))
    .filter(([, r]) =>
      (r.Properties.KeySchema as { AttributeName: string; KeyType: string }[]).some(
        (k) => k.KeyType === 'HASH' && k.AttributeName === 'userId',
      ),
    )
    .map(([id]) => id)
    .sort();
}

describe('account deletion (T12)', () => {
  it('covers every table keyed by userId: none can be forgotten', () => {
    const ids = userTableIds();
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const worker = Object.values(t.findResources('AWS::Lambda::Function')).find((f) =>
      JSON.stringify(f.Properties.Environment ?? {}).includes('USER_TABLES'),
    );
    const listed = JSON.stringify(worker?.Properties.Environment.Variables.USER_TABLES);
    const erasable = statementsFor('DeletionWorkerFn').filter((s) =>
      [s.Action].flat().includes('dynamodb:BatchWriteItem'),
    );
    for (const id of ids) {
      expect(listed, `${id} missing from USER_TABLES`).toContain(id);
      expect(JSON.stringify(erasable), `${id} not erasable`).toContain(id);
    }
  });

  it('starts only on a new DELETION item, sending just the user ID', () => {
    t.hasResourceProperties('AWS::Pipes::Pipe', {
      SourceParameters: {
        FilterCriteria: {
          Filters: [
            {
              Pattern: JSON.stringify({
                eventName: ['INSERT'],
                dynamodb: { NewImage: { status: { S: ['queued'] }, sk: { S: ['DELETION'] } } },
              }),
            },
          ],
        },
      },
      TargetParameters: { InputTemplate: '{"id": "<$.dynamodb.Keys.userId.S>"}' },
    });
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-users',
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('sweeps once more after 15 minutes, within the deletion request lifetime', () => {
    expect(FINAL_SWEEP_DELAY_SECONDS).toBe(900);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-account-deletions',
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
    });
  });

  it('gives the worker only deletion powers, scoped to user data', () => {
    const statements = statementsFor('DeletionWorkerFn');
    const actions = [...new Set(statements.flatMap((s) => [s.Action].flat()))];
    expect(actions.filter((a) => a.startsWith('cognito-idp:')).sort()).toEqual([
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminUserGlobalSignOut',
    ]);
    expect(
      actions.filter((a) => a.startsWith('dynamodb:') && !a.includes('Stream')).sort(),
    ).toEqual([
      'dynamodb:BatchWriteItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    const list = statements.find((s) => [s.Action].flat().includes('s3:ListBucket'));
    expect(list?.Condition).toEqual({
      StringLike: { 's3:prefix': ['users/*', 'derived/users/*'] },
    });
    for (const s of statements.filter((x) =>
      [x.Action].flat().some((a) => a.startsWith('s3:DeleteObject')),
    )) {
      expect(JSON.stringify(s.Resource)).toMatch(/\/(derived\/)?users\/\*/);
    }
  });

  it('lets the other APIs only read the deletion request, never change it', () => {
    for (const fn of ['PingApiFn', 'DocumentsApiFn', 'ProfileApiFn']) {
      const onUsers = statementsFor(fn).filter((s) =>
        JSON.stringify(s.Resource).includes('UsersTable'),
      );
      const actions = onUsers.flatMap((s) => [s.Action].flat());
      expect(actions, fn).toContain('dynamodb:GetItem');
      expect(actions, fn).not.toContain('dynamodb:DeleteItem');
    }
  });

  it('runs the test-data reaper daily in dev, with request-only permissions, and never in prod', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(30 4 * * ? *)',
      Targets: [Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 2 } })],
    });
    const actions = [
      ...new Set(statementsFor('TestDataReaperFn').flatMap((s) => [s.Action].flat())),
    ].sort();
    expect(actions).toEqual([
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Scan',
    ]);
    // It can only request deletions, never delete.
    expect(actions.some((a) => /Delete|BatchWrite/.test(a))).toBe(false);

    for (const cell of ['iad', 'bom', 'lhr']) {
      const prod = Template.fromStack(
        buildApp({ stage: 'prod', env: {} }).node.findChild(`jobdeputy-prod-${cell}`) as never,
      );
      const reapers = Object.keys(prod.findResources('AWS::Lambda::Function')).filter((id) =>
        id.startsWith('TestDataReaper'),
      );
      expect(reapers, cell).toEqual([]);
    }
  });
});
