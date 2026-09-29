import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { CicdStack } from '../lib/cicd-stack.js';
import { checkGuards } from '../lib/guards.js';

describe('PR stacks (T11)', () => {
  it('deploy with the caller credentials instead of CDK bootstrap roles', () => {
    const pr = buildApp({ stage: 'dev', owner: 'pr12', cliCredentials: true, env: {} }).synth();
    expect(pr.stacks.map((s) => s.stackName)).toEqual(['jobdeputy-dev-pr12-iad']);
    expect(pr.stacks[0]?.assumeRoleArn).toBeUndefined();

    const shared = buildApp({ stage: 'dev', env: {} }).synth();
    expect(shared.stacks[0]?.assumeRoleArn).toContain('cdk-hnb659fds-deploy-role');
  });

  it('only allow the credentials mode for personal or PR stacks', () => {
    expect(() => buildApp({ stage: 'dev', cliCredentials: true, env: {} })).toThrow(/owner/);
  });

  it('still pass every guard', () => {
    const app = buildApp({ stage: 'dev', owner: 'pr12', cliCredentials: true, env: {} });
    expect(checkGuards(app)).toEqual([]);
  });
});

describe('PR integration role (T11)', () => {
  const app = new App();
  const stack = new CicdStack(app, 'cicd', {
    env: { region: 'us-east-1', account: '111111111111' },
    subjectPrefix: 'repo:jobdeputy@334723288/jobdeputy@1391498158',
    githubEnvironment: 'dev',
    testedStackName: 'jobdeputy-dev-iad',
    prEnvironment: 'pr',
    prStackPrefix: 'jobdeputy-dev-pr',
    testDataWrites: true,
  });
  const t = Template.fromStack(stack);

  function prStatements(): { Action: string | string[]; Resource: unknown; Condition?: unknown }[] {
    const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) =>
      id.startsWith('GitHubPrRole'),
    );
    expect(policies).toHaveLength(1);
    return policies[0]?.[1].Properties.PolicyDocument.Statement;
  }

  it('trusts only the pr GitHub environment of this repo', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'jobdeputy-github-pr-integration',
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:jobdeputy@334723288/jobdeputy@1391498158:environment:pr',
              },
            },
          }),
        ],
      },
    });
  });

  it('can change only jobdeputy-dev-pr* stacks and cannot assume CDK roles', () => {
    const statements = prStatements();
    const actions = statements.flatMap((s) => [s.Action].flat());
    expect(actions).not.toContain('sts:AssumeRole');
    expect(actions.some((a) => a === '*' || a.endsWith(':*'))).toBe(false);

    for (const s of statements) {
      const list = [s.Action].flat();
      if (list.some((a) => a.startsWith('cloudformation:') && a !== 'cloudformation:ListStacks')) {
        expect(s.Resource).toBe(
          'arn:aws:cloudformation:us-east-1:111111111111:stack/jobdeputy-dev-pr*/*',
        );
      }
      if (list.includes('iam:PassRole')) {
        expect(s.Resource).toBe(
          'arn:aws:iam::111111111111:role/cdk-hnb659fds-cfn-exec-role-111111111111-us-east-1',
        );
        expect(s.Condition).toEqual({
          StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' },
        });
      }
      if (list.includes('logs:DeleteLogGroup')) {
        // Only log groups of PR stacks can be deleted.
        expect(s.Resource).toBe(
          'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/jobdeputy-dev-pr*',
        );
      }
      if (list.includes('logs:PutRetentionPolicy')) {
        expect(s.Resource).toBe(
          'arn:aws:logs:us-east-1:111111111111:log-group:/aws/lambda/jobdeputy-dev-*',
        );
      }
      if (list.some((a) => a.startsWith('sqs:'))) {
        expect(String(s.Resource)).toMatch(/:jobdeputy-dev-pr\*(-dlq)?$/);
      }
      if (list.some((a) => a.startsWith('dynamodb:'))) {
        // T07c: seeding test data, on PR stacks' jobs and sources tables only; no reads or deletes.
        expect(list).toEqual(['dynamodb:PutItem', 'dynamodb:UpdateItem']);
        expect(s.Resource).toEqual([
          'arn:aws:dynamodb:us-east-1:111111111111:table/jobdeputy-dev-pr*-jobs',
          'arn:aws:dynamodb:us-east-1:111111111111:table/jobdeputy-dev-pr*-sources',
        ]);
      }
    }
  });

  it('is only created when a PR environment is configured', () => {
    const plain = new CicdStack(new App(), 'cicd', {
      env: { region: 'us-east-1', account: '111111111111' },
      subjectPrefix: 'repo:x',
      githubEnvironment: 'prod',
      testedStackName: 'jobdeputy-prod-iad',
    });
    expect(
      Object.keys(Template.fromStack(plain).findResources('AWS::IAM::Role')).some((id) =>
        id.startsWith('GitHubPrRole'),
      ),
    ).toBe(false);
  });

  it('can write test data only where asked: never for prod', () => {
    const roleActions = (
      testDataWrites: boolean,
      env: string,
    ): { actions: string[]; resource: unknown }[] => {
      const stack = new CicdStack(new App(), 'cicd', {
        env: { region: 'us-east-1', account: '111111111111' },
        subjectPrefix: 'repo:x',
        githubEnvironment: env,
        testedStackName: `jobdeputy-${env}-iad`,
        ...(testDataWrites ? { testDataWrites } : {}),
      });
      return Object.values(Template.fromStack(stack).findResources('AWS::IAM::Policy')).flatMap(
        (p) =>
          p.Properties.PolicyDocument.Statement.map(
            (st: { Action: string | string[]; Resource: unknown }) => ({
              actions: [st.Action].flat(),
              resource: st.Resource,
            }),
          ),
      );
    };
    const prod = roleActions(false, 'prod');
    expect(prod.flatMap((st) => st.actions).some((a) => a.startsWith('dynamodb:'))).toBe(false);
    const dev = roleActions(true, 'dev').filter((st) =>
      st.actions.some((a) => a.startsWith('dynamodb:')),
    );
    expect(dev).toEqual([
      {
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resource: [
          'arn:aws:dynamodb:us-east-1:111111111111:table/jobdeputy-dev-iad-jobs',
          'arn:aws:dynamodb:us-east-1:111111111111:table/jobdeputy-dev-iad-sources',
        ],
      },
    ]);
  });
});
