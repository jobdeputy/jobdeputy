import { App, Stack } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { CfnNatGateway } from 'aws-cdk-lib/aws-ec2';
import { Bucket, type CfnBucket } from 'aws-cdk-lib/aws-s3';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { checkGuards } from '../lib/guards.js';

describe('Region cells (decision 0004)', () => {
  it('dev deploys only the US cell', () => {
    const app = buildApp({ stage: 'dev', env: {} });
    const stacks = app.synth().stacks.map((s) => [s.stackName, s.environment.region]);
    expect(stacks).toEqual([['jobdeputy-dev-iad', 'us-east-1']]);
  });

  it('prod has one stack per cell, each in its own Region', () => {
    const app = buildApp({ stage: 'prod', env: {} });
    const stacks = Object.fromEntries(
      app.synth().stacks.map((s) => [s.stackName, s.environment.region]),
    );
    expect(stacks).toEqual({
      'jobdeputy-prod-iad': 'us-east-1',
      'jobdeputy-prod-bom': 'ap-south-1',
      'jobdeputy-prod-lhr': 'eu-west-2',
    });
  });

  it('uses account IDs only from the environment', () => {
    const app = buildApp({ stage: 'dev', env: { JD_ACCOUNT_DEV_IAD: '111111111111' } });
    expect(app.synth().stacks[0]?.environment.account).toBe('111111111111');
  });

  it('names personal stacks after their owner, dev only', () => {
    const app = buildApp({ stage: 'dev', owner: 'nava', env: {} });
    expect(app.synth().stacks.map((s) => s.stackName)).toEqual(['jobdeputy-dev-nava-iad']);
    expect(() => buildApp({ stage: 'prod', owner: 'nava', env: {} })).toThrow(/dev stage/);
    expect(() => buildApp({ stage: 'dev', owner: 'Bad Name', env: {} })).toThrow(/Invalid owner/);
  });

  it.each(['dev', 'prod'] as const)('%s passes every guard', (stage) => {
    expect(checkGuards(buildApp({ stage, env: {} }))).toEqual([]);
  });
});

describe('guards catch violations', () => {
  function appWith(build: (stack: Stack) => void, region = 'us-east-1'): App {
    const app = new App();
    build(new Stack(app, 'probe', { env: { region } }));
    return app;
  }

  it('rejects Regions outside the cells', () => {
    const violations = checkGuards(appWith(() => {}, 'us-west-2'));
    expect(violations.map((v) => v.message)).toContain(
      'Region us-west-2 is not a JobDeputy cell Region.',
    );
  });

  it('rejects references to another cell Region', () => {
    const app = appWith((s) => {
      new Bucket(s, 'B', { bucketName: 'copy-to-ap-south-1' });
    });
    expect(checkGuards(app).some((v) => v.message.includes('ap-south-1'))).toBe(true);
  });

  it('rejects costly resources', () => {
    const app = appWith((s) => {
      new CfnNatGateway(s, 'Nat', { subnetId: 'subnet-123' });
    });
    expect(checkGuards(app).some((v) => v.message.includes('AWS::EC2::NatGateway'))).toBe(true);
  });

  it('rejects provisioned DynamoDB capacity', () => {
    const app = appWith((s) => {
      new Table(s, 'T', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        billingMode: BillingMode.PROVISIONED,
      });
    });
    expect(checkGuards(app).some((v) => v.message.includes('on-demand'))).toBe(true);
  });

  it('rejects S3 replication', () => {
    const app = appWith((s) => {
      const bucket = new Bucket(s, 'B', { versioned: true });
      (bucket.node.defaultChild as CfnBucket).addPropertyOverride('ReplicationConfiguration', {
        Role: 'r',
        Rules: [],
      });
    });
    expect(checkGuards(app).some((v) => v.message.includes('replication'))).toBe(true);
  });
});

describe('CI/CD deploy role', () => {
  it('trusts only the given repo and environment; deploys via CDK roles and runs integration tests', async () => {
    const { Template } = await import('aws-cdk-lib/assertions');
    const { CicdStack } = await import('../lib/cicd-stack.js');
    const app = new App();
    const stack = new CicdStack(app, 'cicd', {
      env: { region: 'us-east-1', account: '111111111111' },
      subjectPrefix: 'repo:jobdeputy@334723288/jobdeputy@1391498158',
      githubEnvironment: 'dev',
      testedStackName: 'jobdeputy-dev-iad',
    });
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:jobdeputy@334723288/jobdeputy@1391498158:environment:dev',
              },
            },
          },
        ],
      },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Resource: 'arn:aws:iam::111111111111:role/cdk-hnb659fds-*-111111111111-us-east-1',
          },
          {
            Action: 'cloudformation:DescribeStacks',
            Effect: 'Allow',
            Resource: 'arn:aws:cloudformation:us-east-1:111111111111:stack/jobdeputy-dev-iad/*',
          },
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: 'arn:aws:execute-api:us-east-1:111111111111:*/*/*/*',
          },
          {
            Action: 'sqs:SendMessage',
            Effect: 'Allow',
            Resource: 'arn:aws:sqs:us-east-1:111111111111:jobdeputy-dev-iad-*',
          },
          {
            Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage'],
            Effect: 'Allow',
            Resource: 'arn:aws:sqs:us-east-1:111111111111:jobdeputy-dev-iad-*-dlq',
          },
        ],
      },
    });
    expect(checkGuards(app)).toEqual([]);
  });
});
