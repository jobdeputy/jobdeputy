import { platformModelArn } from '@jobdeputy/shared';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnOIDCProvider, FederatedPrincipal, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface CicdStackProps extends StackProps {
  /** GitHub OIDC subject prefix for the repository; see config/github.ts. */
  readonly subjectPrefix: string;
  /** GitHub Environment the deploy job must run in, for example "dev". */
  readonly githubEnvironment: string;
  /** The cell stack CI runs integration tests against, for example "jobdeputy-dev-iad". */
  readonly testedStackName: string;
  /**
   * GitHub Environment for PR integration runs (T11), for example "pr". When set,
   * adds a role that can only deploy, test, and delete stacks named `<prStackPrefix>*`.
   */
  readonly prEnvironment?: string;
  /** For example "jobdeputy-dev-pr". */
  readonly prStackPrefix?: string;
  /**
   * Dev only (T07c): integration tests may seed test data that no page can produce (a
   * job a page "listed before"), with `PutItem`/`UpdateItem` on the tested stacks'
   * `-jobs` and `-sources` tables only. Never set for prod.
   */
  readonly testDataWrites?: boolean;
  /**
   * Dev only (T08b): the model eval on PRs and Nightly's real-model check call the
   * platform model, with `bedrock:InvokeModel` on that one model in this Region only.
   */
  readonly modelChecks?: boolean;
}

/** T08b: invoke the pinned platform model (decision 0010), nothing else in Bedrock. */
function modelCheckStatement(region: string) {
  return new PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: [platformModelArn(region)],
  });
}

/** T07c: the tables integration tests may seed, and only these calls. */
function testDataStatement(region: string, account: string, stackPattern: string) {
  const table = (name: string) =>
    `arn:aws:dynamodb:${region}:${account}:table/${stackPattern}-${name}`;
  return new PolicyStatement({
    actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
    resources: [table('jobs'), table('sources')],
  });
}

const GITHUB_OIDC = 'token.actions.githubusercontent.com';

/**
 * One per workload account. Lets GitHub Actions deploy with short-lived
 * credentials (no stored keys), only from the given repo and environment,
 * and only by assuming the CDK bootstrap roles.
 */
export class CicdStack extends Stack {
  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const provider = new CfnOIDCProvider(this, 'GitHubOidc', {
      url: `https://${GITHUB_OIDC}`,
      clientIdList: ['sts.amazonaws.com'],
    });

    const role = new Role(this, 'GitHubDeployRole', {
      roleName: 'jobdeputy-github-deploy',
      description: `GitHub Actions deploys (${props.githubEnvironment})`,
      assumedBy: new FederatedPrincipal(
        provider.attrArn,
        {
          StringEquals: {
            [`${GITHUB_OIDC}:aud`]: 'sts.amazonaws.com',
            [`${GITHUB_OIDC}:sub`]: `${props.subjectPrefix}:environment:${props.githubEnvironment}`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    role.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`,
        ],
      }),
    );

    // Post-deploy integration tests, limited to the one stack CI tests.
    const tested = props.testedStackName;
    const sqsArn = (name: string) => `arn:aws:sqs:${this.region}:${this.account}:${name}`;
    role.addToPolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/${tested}/*`],
      }),
    );
    // Integration tests sign in as throwaway users (T05). Pool IDs are generated
    // at deploy time, so they cannot be named; this account holds only dev pools.
    role.addToPolicy(testUserStatement(this.region, this.account));
    role.addToPolicy(malwarePlanStatusStatement(this.region, this.account));
    // The nightly integration run emails the alert list if it fails (T13).
    role.addToPolicy(
      new PolicyStatement({
        actions: ['sns:Publish'],
        resources: [`arn:aws:sns:${this.region}:${this.account}:${tested}-alarms`],
      }),
    );
    // Duplicate-delivery test: send to the stack's work queues.
    role.addToPolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [sqsArn(`${tested}-*`)],
      }),
    );
    // Dead-letter test: read, then delete the one test message found, so the
    // "dead-letter queue not empty" alarm does not email everyone after each deploy.
    role.addToPolicy(
      new PolicyStatement({
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage'],
        resources: [sqsArn(`${tested}-*-dlq`)],
      }),
    );

    if (props.testDataWrites)
      role.addToPolicy(testDataStatement(this.region, this.account, tested));
    if (props.modelChecks) role.addToPolicy(modelCheckStatement(this.region));

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });

    if (props.prEnvironment && props.prStackPrefix) {
      const prRole = this.prIntegrationRole(provider.attrArn, props);
      new CfnOutput(this, 'PrRoleArn', { value: prRole.roleArn });
    }
  }

  /**
   * T11: PR runs deploy their own stack with this role's credentials
   * (CliCredentialsStackSynthesizer). IAM limits every stack action to
   * `<prStackPrefix>*`, so a PR can never change or delete a shared stack.
   * Resources inside the stack are created by the CDK execution role, passed to
   * CloudFormation with `--role-arn` (release blocker #8 narrows that role).
   */
  private prIntegrationRole(providerArn: string, props: CicdStackProps): Role {
    const { account, region } = this;
    const prefix = props.prStackPrefix as string;
    const role = new Role(this, 'GitHubPrRole', {
      roleName: 'jobdeputy-github-pr-integration',
      description: `GitHub Actions PR integration runs (${props.prEnvironment})`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new FederatedPrincipal(
        providerArn,
        {
          StringEquals: {
            [`${GITHUB_OIDC}:aud`]: 'sts.amazonaws.com',
            [`${GITHUB_OIDC}:sub`]: `${props.subjectPrefix}:environment:${props.prEnvironment}`,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });
    const stacks = `arn:aws:cloudformation:${region}:${account}:stack/${prefix}*/*`;
    const sqsArn = (name: string) => `arn:aws:sqs:${region}:${account}:${name}`;
    const statements = [
      // Deploy and delete PR stacks only.
      new PolicyStatement({
        actions: [
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
          'cloudformation:DeleteStack',
        ],
        resources: [stacks],
      }),
      // The daily backstop lists stacks to find old PR stacks (ListStacks has no resource scope).
      new PolicyStatement({ actions: ['cloudformation:ListStacks'], resources: ['*'] }),
      // Let CloudFormation create the stack's resources with the CDK execution role.
      new PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          `arn:aws:iam::${account}:role/cdk-hnb659fds-cfn-exec-role-${account}-${region}`,
        ],
        conditions: { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
      }),
      // Upload Lambda bundles to the CDK assets bucket.
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:GetBucketLocation'],
        resources: [
          `arn:aws:s3:::cdk-hnb659fds-assets-${account}-${region}`,
          `arn:aws:s3:::cdk-hnb659fds-assets-${account}-${region}/*`,
        ],
      }),
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${account}:parameter/cdk-bootstrap/hnb659fds/version`],
      }),
      // Integration tests, as for the main deploy role but only on PR stacks.
      testUserStatement(region, account),
      malwarePlanStatusStatement(region, account),
      new PolicyStatement({ actions: ['sqs:SendMessage'], resources: [sqsArn(`${prefix}*`)] }),
      ...(props.testDataWrites ? [testDataStatement(region, account, `${prefix}*`)] : []),
      ...(props.modelChecks ? [modelCheckStatement(region)] : []),
      // T14 (scripts/cleanup-log-groups.sh): log groups CDK's bucket helper leaves behind.
      new PolicyStatement({
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${region}:${account}:log-group:*`],
      }),
      new PolicyStatement({
        actions: ['logs:DeleteLogGroup'],
        resources: [`arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${prefix}*`],
      }),
      new PolicyStatement({
        actions: ['logs:PutRetentionPolicy'],
        resources: [`arn:aws:logs:${region}:${account}:log-group:/aws/lambda/jobdeputy-dev-*`],
      }),
      new PolicyStatement({
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage'],
        resources: [sqsArn(`${prefix}*-dlq`)],
      }),
    ];
    for (const statement of statements) role.addToPolicy(statement);
    return role;
  }
}

/** Create, sign in, and delete throwaway integration-test users. Nothing else in Cognito. */
export const TEST_USER_ACTIONS = [
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminAddUserToGroup',
  'cognito-idp:AdminSetUserPassword',
  'cognito-idp:AdminInitiateAuth',
  'cognito-idp:AdminDeleteUser',
];

function testUserStatement(region: string, account: string): PolicyStatement {
  return new PolicyStatement({
    actions: TEST_USER_ACTIONS,
    resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/*`],
  });
}

/** Read-only: tests wait until a new stack's malware scanning is ACTIVE before uploading (T05c). */
function malwarePlanStatusStatement(region: string, account: string): PolicyStatement {
  return new PolicyStatement({
    actions: ['guardduty:GetMalwareProtectionPlan'],
    resources: [`arn:aws:guardduty:${region}:${account}:malware-protection-plan/*`],
  });
}
