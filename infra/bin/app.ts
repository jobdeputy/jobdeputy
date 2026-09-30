import { App } from 'aws-cdk-lib';
import { GITHUB_OIDC_SUBJECT_PREFIX } from '../config/github.js';
import { buildApp, stageFromContext } from '../lib/build-app.js';
import { CicdStack } from '../lib/cicd-stack.js';

// One App only: the CDK CLI auto-synthesizes every App on exit.
const app = new App();
const stage = stageFromContext(app.node.tryGetContext('stage'));
const owner = app.node.tryGetContext('owner') as string | undefined;
const cliCredentials = String(app.node.tryGetContext('cliCredentials')) === 'true';

buildApp({ app, stage, cliCredentials, ...(owner ? { owner } : {}) });

// Deployed once per workload account by an admin: cdk deploy -c cicd=true
if (app.node.tryGetContext('cicd') === 'true' || app.node.tryGetContext('cicd') === true) {
  new CicdStack(app, `jobdeputy-cicd-${stage}-iad`, {
    env: { region: 'us-east-1' },
    subjectPrefix: GITHUB_OIDC_SUBJECT_PREFIX,
    githubEnvironment: stage,
    testedStackName: `jobdeputy-${stage}-iad`,
    // PR integration runs, seeding test data, and model checks exist only in dev (T11, T07c, T08b).
    ...(stage === 'dev'
      ? {
          prEnvironment: 'pr',
          prStackPrefix: 'jobdeputy-dev-pr',
          testDataWrites: true,
          modelChecks: true,
        }
      : {}),
  });
}
