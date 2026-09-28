import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnOIDCProvider, FederatedPrincipal, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface CicdStackProps extends StackProps {
  /** GitHub OIDC subject prefix for the repository; see config/github.ts. */
  readonly subjectPrefix: string;
  /** GitHub Environment the deploy job must run in, for example "dev". */
  readonly githubEnvironment: string;
  /** The cell stack CI runs integration tests against, for example "jobdeputy-dev-iad". */
  readonly testedStackName: string;
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
    // The API ID is generated at deploy time, so it cannot be named here. This account
    // only holds dev stacks, and the role is usable only from main in one environment.
    role.addToPolicy(
      new PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: [`arn:aws:execute-api:${this.region}:${this.account}:*/*/*/*`],
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

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
