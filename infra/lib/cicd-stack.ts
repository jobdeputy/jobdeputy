import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnOIDCProvider, FederatedPrincipal, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface CicdStackProps extends StackProps {
  /** GitHub OIDC subject prefix for the repository; see config/github.ts. */
  readonly subjectPrefix: string;
  /** GitHub Environment the deploy job must run in, for example "dev". */
  readonly githubEnvironment: string;
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

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
