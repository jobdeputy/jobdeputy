import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CfnUserPool } from 'aws-cdk-lib/aws-cognito';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/ping-worker.js';
import { buildApp, parseAlertEmails } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';
import { REPO_ROOT } from '../lib/constructs/node-function.js';
import { checkGuards } from '../lib/guards.js';

function devTemplate(env: Record<string, string> = {}): Template {
  const app = buildApp({ stage: 'dev', env });
  const stack = app.node.findChild('jobdeputy-dev-iad');
  return Template.fromStack(stack as never);
}

describe('async pipeline (T04)', () => {
  const t = devTemplate();

  it('streams only new queued items, sending IDs only', () => {
    t.hasResourceProperties('AWS::Pipes::Pipe', {
      SourceParameters: {
        DynamoDBStreamParameters: {
          StartingPosition: 'TRIM_HORIZON',
          BatchSize: 1,
          MaximumRetryAttempts: 2,
          DeadLetterConfig: { Arn: Match.anyValue() },
        },
        FilterCriteria: {
          Filters: [
            {
              Pattern: JSON.stringify({
                eventName: ['INSERT'],
                dynamodb: { NewImage: { status: { S: ['queued'] } } },
              }),
            },
          ],
        },
      },
      TargetParameters: { InputTemplate: '{"id": "<$.dynamodb.Keys.id.S>"}' },
    });
  });

  it('creates every Pipe only after its role policy (its DLQ and queue permissions)', () => {
    const pipes = Object.values(t.findResources('AWS::Pipes::Pipe'));
    expect(pipes.length).toBeGreaterThanOrEqual(3);
    for (const pipe of pipes) {
      const dependsOn = [pipe.DependsOn ?? []].flat() as string[];
      expect(
        dependsOn.some((d) => /PipeRoleDefaultPolicy/.test(d)),
        JSON.stringify(dependsOn),
      ).toBe(true);
    }
  });

  it('retries 3 times, then dead-letters, and the worker agrees on the count', () => {
    expect(MAX_RECEIVES).toBe(3);
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-ping-jobs',
      VisibilityTimeout: 180,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
      SqsManagedSseEnabled: true,
    });
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-ping-jobs-dlq',
      MessageRetentionPeriod: 14 * 86400,
    });
  });

  it('caps the worker with SQS maximum concurrency and partial batch responses', () => {
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('alarms on a non-empty dead-letter queue', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 1,
      AlarmActions: [Match.anyValue()],
    });
  });

  it('subscribes alert emails only when given through the environment', () => {
    t.resourceCountIs('AWS::SNS::Subscription', 0);
    const withEmails = devTemplate({ JD_ALERT_EMAIL: 'a@example.com, b@example.com' });
    withEmails.resourceCountIs('AWS::SNS::Subscription', 2);
    withEmails.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'b@example.com',
    });
  });

  it('rejects invalid or too many alert emails', () => {
    expect(parseAlertEmails(undefined)).toEqual([]);
    expect(parseAlertEmails('a@example.com,a@example.com')).toEqual(['a@example.com']);
    expect(() => parseAlertEmails('not-an-email')).toThrow(/invalid/);
    const six = Array.from({ length: 6 }, (_, i) => `u${i}@example.com`).join(',');
    expect(() => parseAlertEmails(six)).toThrow(/at most 5/);
  });

  it('uses on-demand tables with expiry, and destroys them only outside prod', () => {
    t.hasResource('AWS::DynamoDB::Table', {
      Properties: Match.objectLike({
        TableName: 'jobdeputy-dev-iad-ping-jobs',
        StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      }),
      DeletionPolicy: 'Delete',
    });
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-idempotency',
      TimeToLiveSpecification: { AttributeName: 'expiration', Enabled: true },
    });
    const prod = buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-bom');
    Template.fromStack(prod as never).hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
    });
  });
});

describe('Cognito (T05)', () => {
  const t = devTemplate();

  it('uses email-only sign-in on the free Essentials plan, with no SMS', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'ESSENTIALS',
      UsernameAttributes: ['email'],
      UsernameConfiguration: { CaseSensitive: false },
      AutoVerifiedAttributes: ['email'],
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
      Schema: [Match.objectLike({ Name: 'email', Required: true })],
    });
    const pool = Object.values(t.findResources('AWS::Cognito::UserPool'))[0];
    expect(pool?.Properties.SmsConfiguration).toBeUndefined();
  });

  it('lets the web client use only secure password sign-in, and hides whether accounts exist', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it('has a tests client only in dev, and protects prod pools from deletion', () => {
    t.resourceCountIs('AWS::Cognito::UserPoolClient', 2);
    const prod = buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-lhr');
    const pt = Template.fromStack(prod as never);
    pt.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    pt.hasResource('AWS::Cognito::UserPool', {
      Properties: Match.objectLike({ DeletionProtection: 'ACTIVE' }),
      DeletionPolicy: 'Retain',
    });
  });
});

describe('least privilege (T04)', () => {
  const t = devTemplate();

  function actionsFor(logicalIdPrefix: string): string[] {
    const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) =>
      id.startsWith(logicalIdPrefix),
    );
    expect(policies.length).toBeGreaterThan(0);
    return policies.flatMap(([, p]) =>
      p.Properties.PolicyDocument.Statement.flatMap((s: { Action: string | string[] }) =>
        [s.Action].flat(),
      ),
    );
  }

  it('gives each function only the DynamoDB calls it makes', () => {
    const api = actionsFor('PingApiFn').filter((a) => a.startsWith('dynamodb:'));
    // Ping table: PutItem and GetItem; users: GetItem (the T12 deletion check).
    expect([...new Set(api)].sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem']);
    const worker = actionsFor('PingWorkerFn').filter((a) => a.startsWith('dynamodb:'));
    for (const broad of ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:BatchWriteItem']) {
      expect(worker).not.toContain(broad);
    }
  });

  it('lets /me read the user and record a deletion request, and nothing else', () => {
    expect([...new Set(actionsFor('MeApiFn'))].sort()).toEqual([
      'cognito-idp:AdminGetUser',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
    ]);
  });

  it('gives the profile API only the calls it makes on its tables', () => {
    expect([...new Set(actionsFor('ProfileApiFn'))].sort()).toEqual([
      'cognito-idp:AdminGetUser',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      // Only on usage: the role counter (exact cap under concurrent creates).
      'dynamodb:UpdateItem',
    ]);
    const updates = Object.entries(t.findResources('AWS::IAM::Policy'))
      .filter(([id]) => id.startsWith('ProfileApiFn'))
      .flatMap(
        ([, p]) =>
          p.Properties.PolicyDocument.Statement as {
            Action: string | string[];
            Resource: unknown;
          }[],
      )
      .filter((st) => [st.Action].flat().includes('dynamodb:UpdateItem'));
    expect(JSON.stringify(updates.map((u) => u.Resource))).toMatch(/UsageTable/);
    expect(JSON.stringify(updates.map((u) => u.Resource))).not.toMatch(
      /UsersTable|PreferencesTable/,
    );
    // Query and DeleteItem (roles) only on preferences; users is get and put only.
    const policy = Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) =>
      id.startsWith('ProfileApiFn'),
    )?.[1];
    const statements = policy?.Properties.PolicyDocument.Statement as {
      Action: string | string[];
      Resource: unknown;
    }[];
    const users = statements.find((s) => JSON.stringify(s.Resource).includes('UsersTable'));
    expect([users?.Action].flat().sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem']);
  });

  it('keys user tables by userId and sk, with backups only in prod', () => {
    for (const name of ['jobdeputy-dev-iad-users', 'jobdeputy-dev-iad-preferences']) {
      t.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: name,
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      });
    }
    const prod = buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-iad');
    Template.fromStack(prod as never).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-prod-iad-users',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });
});

describe('HTTP API (T04)', () => {
  const t = devTemplate();

  it('requires a Cognito token on every product API route', () => {
    // The dev test site is a separate API (see below); the product API has no open route.
    const routes = Object.fromEntries(
      Object.entries(t.findResources('AWS::ApiGatewayV2::Route')).filter(
        ([id]) => !id.startsWith('TestSiteApi'),
      ),
    );
    expect(
      Object.values(routes)
        .map((r) => r.Properties.RouteKey)
        .sort(),
    ).toEqual([
      'DELETE /me',
      'DELETE /me/documents/{documentId}',
      'DELETE /me/roles/{roleId}',
      'GET /me',
      'GET /me/audit',
      'GET /me/crawl-settings',
      'GET /me/crawls',
      'GET /me/crawls/{crawlId}',
      'GET /me/documents',
      'GET /me/documents/{documentId}',
      'GET /me/preferences/search',
      'GET /me/profile',
      'GET /me/roles',
      'GET /ping-jobs/{id}',
      'POST /me/crawls',
      'POST /me/documents',
      'POST /me/roles',
      'POST /ping-jobs',
      'PUT /me/crawl-settings',
      'PUT /me/documents/{documentId}',
      'PUT /me/preferences/search',
      'PUT /me/profile',
      'PUT /me/roles/{roleId}',
    ]);
    for (const route of Object.values(routes)) {
      const open = route.Properties.RouteKey === 'GET /test-site/{page}';
      expect(route.Properties.AuthorizationType, route.Properties.RouteKey).toBe(
        open ? 'NONE' : 'JWT',
      );
    }
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
  });

  it('deploys every route the API code handles (a handled route without one is unreachable)', () => {
    // Found in T06c: a handler case existed, but no API Gateway route, so the call was a 404.
    const dir = join(REPO_ROOT, 'apps', 'api', 'src');
    const handled = new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .flatMap((f) =>
          [
            ...readFileSync(join(dir, f), 'utf8').matchAll(
              /'((?:GET|POST|PUT|PATCH|DELETE) \/[^']*)'/g,
            ),
          ].map((m) => m[1] as string),
        ),
    );
    const deployed = new Set(
      Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map(
        (r) => r.Properties.RouteKey as string,
      ),
    );
    expect(handled.size).toBeGreaterThan(10);
    expect([...handled].filter((key) => !deployed.has(key))).toEqual([]);
  });

  it('serves the dev test site from its own API, which no alarm watches', () => {
    const apis = Object.entries(t.findResources('AWS::ApiGatewayV2::Api'));
    const site = apis.find(([id]) => id.startsWith('TestSiteApi'));
    expect(site?.[1].Properties.Name).toBe('jobdeputy-dev-iad-test-site');
    const siteRoutes = Object.entries(t.findResources('AWS::ApiGatewayV2::Route')).filter(([id]) =>
      id.startsWith('TestSiteApi'),
    );
    expect(
      siteRoutes.map(([, r]) => [r.Properties.RouteKey, r.Properties.AuthorizationType]),
    ).toEqual([['GET /test-site/{page}', 'NONE']]);
    // Its deliberate 503 ("a site that is down") must never reach an alarm.
    const alarms = JSON.stringify(t.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms).not.toContain(site?.[0] ?? 'missing');
  });

  it('deploys the ping scaffolding in dev stacks only (it keeps user IDs outside the user tables)', () => {
    const prod = Template.fromStack(
      buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-iad') as never,
    );
    const names = (tpl: Template) =>
      Object.values(tpl.findResources('AWS::DynamoDB::Table')).map(
        (r) => r.Properties.TableName as string,
      );
    expect(names(prod).filter((n) => /ping-jobs|idempotency/.test(n))).toEqual([]);
    expect(JSON.stringify(prod.toJSON())).not.toMatch(/ping-jobs|ping-worker|PingPipeline/);
    expect(
      names(t)
        .filter((n) => /ping-jobs|idempotency/.test(n))
        .sort(),
    ).toEqual(['jobdeputy-dev-iad-idempotency', 'jobdeputy-dev-iad-ping-jobs']);
  });

  it('has no route without a token in prod (no test site)', () => {
    const prod = Template.fromStack(
      buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-iad') as never,
    );
    const routes = Object.values(prod.findResources('AWS::ApiGatewayV2::Route'));
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.Properties.RouteKey).not.toContain('test-site');
      expect(route.Properties.AuthorizationType).toBe('JWT');
    }
    expect(JSON.stringify(prod.toJSON())).not.toContain('test-site.ts');
  });

  it('throttles the dev stage', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('runs Node 22 on ARM64', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });
});

describe('new guards', () => {
  it('reject the paid Cognito plan and SMS', () => {
    const app = new App();
    const stack = new Stack(app, 'probe', { env: { region: 'us-east-1' } });
    new CfnUserPool(stack, 'P', {
      userPoolTier: 'PLUS',
      smsConfiguration: { snsCallerArn: 'arn:aws:iam::111111111111:role/r' },
    });
    const messages = checkGuards(app).map((v) => v.message);
    expect(messages.some((m) => m.includes('Plus plan'))).toBe(true);
    expect(messages.some((m) => m.includes('SMS'))).toBe(true);
  });

  it('reject reserved concurrency and unbounded log retention', () => {
    const app = new App();
    const stack = new Stack(app, 'probe', { env: { region: 'us-east-1' } });
    new CfnFunction(stack, 'F', {
      code: { zipFile: 'x' },
      role: 'arn:aws:iam::111111111111:role/r',
      reservedConcurrentExecutions: 1,
    });
    new LogGroup(stack, 'L');
    const messages = checkGuards(app).map((v) => v.message);
    expect(messages.some((m) => m.includes('reserved concurrency'))).toBe(true);
    expect(messages.some((m) => m.includes('log retention'))).toBe(true);
  });
});
