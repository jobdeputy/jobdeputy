import { App } from 'aws-cdk-lib';
import { buildApp, stageFromContext } from '../lib/build-app.js';
import { CicdStack } from '../lib/cicd-stack.js';

// One App only: the CDK CLI auto-synthesizes every App on exit.
const app = new App();
const stage = stageFromContext(app.node.tryGetContext('stage'));
const owner = app.node.tryGetContext('owner') as string | undefined;

buildApp({ app, stage, ...(owner ? { owner } : {}) });

// Deployed once per workload account by an admin: cdk deploy -c cicd=true
if (app.node.tryGetContext('cicd') === 'true' || app.node.tryGetContext('cicd') === true) {
  new CicdStack(app, `jobdeputy-cicd-${stage}-iad`, {
    env: { region: 'us-east-1' },
    // Immutable OIDC subject for jobdeputy/jobdeputy (owner and repo IDs are public metadata).
    subjectPrefix: 'repo:jobdeputy@334723288/jobdeputy@1391498158',
    githubEnvironment: stage,
  });
}
