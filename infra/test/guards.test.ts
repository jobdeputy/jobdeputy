import { App, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { CfnNatGateway } from 'aws-cdk-lib/aws-ec2';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Bucket, type CfnBucket } from 'aws-cdk-lib/aws-s3';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { checkGuards } from '../lib/guards.js';

describe('Region cells (decision 0004)', () => {
  it('dev deploys only the US cell', () => {
    const app = buildApp({ stage: 'dev', env: {} });
    const stacks = app.synth().stacks.map((s) => [s.stackName, s.environment.region]);
    // T08b2: the cell and its keys stack (the KMS key), in the same Region.
    expect(stacks).toEqual([
      ['jobdeputy-dev-iad-keys', 'us-east-1'],
      ['jobdeputy-dev-iad', 'us-east-1'],
    ]);
  });

  it('prod has one stack per cell, each in its own Region', () => {
    const app = buildApp({ stage: 'prod', env: {} });
    const stacks = Object.fromEntries(
      app.synth().stacks.map((s) => [s.stackName, s.environment.region]),
    );
    expect(stacks).toEqual({
      'jobdeputy-prod-iad': 'us-east-1',
      'jobdeputy-prod-iad-keys': 'us-east-1',
      'jobdeputy-prod-bom': 'ap-south-1',
      'jobdeputy-prod-bom-keys': 'ap-south-1',
      'jobdeputy-prod-lhr': 'eu-west-2',
      'jobdeputy-prod-lhr-keys': 'eu-west-2',
    });
  });

  it('uses account IDs only from the environment', () => {
    const app = buildApp({ stage: 'dev', env: { JD_ACCOUNT_DEV_IAD: '111111111111' } });
    for (const stack of app.synth().stacks) expect(stack.environment.account).toBe('111111111111');
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

describe('KMS keys (decisions 0009, 0010)', () => {
  const keyIn = (stackName: string, keys: number, removalPolicy = RemovalPolicy.RETAIN) => {
    const app = new App();
    const stack = new Stack(app, stackName, { env: { region: 'us-east-1' } });
    for (let i = 0; i < keys; i++) new Key(stack, `Key${i}`, { removalPolicy });
    return checkGuards(app).map((v) => v.message);
  };

  it('allows one retained key in a keys stack', () => {
    expect(keyIn('jobdeputy-dev-iad-keys', 1)).toEqual([]);
  });

  it('refuses a key anywhere else, a second key, and a key not kept on delete', () => {
    expect(keyIn('jobdeputy-dev-iad', 1)).toContain(
      'KMS keys are only allowed in a cell keys stack.',
    );
    expect(keyIn('jobdeputy-dev-iad-keys', 2)).toContain('A keys stack has at most one KMS key.');
    expect(keyIn('jobdeputy-dev-iad-keys', 1, RemovalPolicy.DESTROY)).toEqual([
      expect.stringMatching(/^Key0\w*: a KMS key must be kept on delete\.$/),
    ]);
  });

  it('gives each real cell exactly one retained key with rotation, in its keys stack', () => {
    for (const stage of ['dev', 'prod'] as const) {
      for (const artifact of buildApp({ stage, env: {} }).synth().stacks) {
        const keys = Object.values(
          (
            artifact.template as {
              Resources: Record<
                string,
                {
                  Type: string;
                  DeletionPolicy?: string;
                  Properties: { EnableKeyRotation?: boolean };
                }
              >;
            }
          ).Resources,
        ).filter((r) => r.Type === 'AWS::KMS::Key');
        const isKeys = artifact.stackName.endsWith('-keys');
        expect(keys.length, artifact.stackName).toBe(isKeys ? 1 : 0);
        for (const key of keys) {
          expect(key.DeletionPolicy).toBe('Retain');
          expect(key.Properties.EnableKeyRotation).toBe(true);
        }
      }
    }
  });

  it('never gives personal or PR stacks their own key', () => {
    const app = buildApp({ stage: 'dev', owner: 'pr42', env: {} });
    expect(app.synth().stacks.map((s) => s.stackName)).toEqual(['jobdeputy-dev-pr42-iad']);
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
            Action: [
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminAddUserToGroup',
              'cognito-idp:AdminSetUserPassword',
              'cognito-idp:AdminInitiateAuth',
              'cognito-idp:AdminDeleteUser',
            ],
            Effect: 'Allow',
            Resource: 'arn:aws:cognito-idp:us-east-1:111111111111:userpool/*',
          },
          {
            Action: 'guardduty:GetMalwareProtectionPlan',
            Effect: 'Allow',
            Resource: 'arn:aws:guardduty:us-east-1:111111111111:malware-protection-plan/*',
          },
          {
            Action: 'sns:Publish',
            Effect: 'Allow',
            Resource: 'arn:aws:sns:us-east-1:111111111111:jobdeputy-dev-iad-alarms',
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
