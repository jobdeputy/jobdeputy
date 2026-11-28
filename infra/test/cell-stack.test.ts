import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_WEB_ORIGIN, WEB_SIGN_IN_CALLBACK_PATH } from '@jobdeputy/shared';
import {
  EXTENSION_API_ROUTES,
  EXTENSION_DEV_IDS,
  EXTENSION_STORE_IDS,
  extensionRedirectUrl,
  WEB_SCOPE,
} from '@jobdeputy/shared/extension';
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

  // #61: a separate role policy raced the Pipe's dead-letter queue check on PR stacks.
  it('gives every Pipe role its permissions inline, never as a separate policy', () => {
    const pipes = Object.values(t.findResources('AWS::Pipes::Pipe'));
    expect(pipes.length).toBeGreaterThanOrEqual(3);
    const roles = t.findResources('AWS::IAM::Role');
    const policies = Object.values(t.findResources('AWS::IAM::Policy'));
    for (const pipe of pipes) {
      const roleId = pipe.Properties.RoleArn['Fn::GetAtt'][0] as string;
      expect([pipe.DependsOn ?? []].flat()).toContain(roleId);
      const statements = (roles[roleId]?.Properties.Policies ?? []).flatMap(
        (p: { PolicyDocument: { Statement: unknown[] } }) => p.PolicyDocument.Statement,
      );
      const resources = JSON.stringify(statements);
      const params = pipe.Properties.SourceParameters.DynamoDBStreamParameters;
      expect(resources).toContain(JSON.stringify(params.DeadLetterConfig.Arn));
      expect(resources).toContain(JSON.stringify(pipe.Properties.Target));
      expect(resources).toContain(JSON.stringify(pipe.Properties.Source));
      const attached = policies.filter((p) =>
        JSON.stringify(p.Properties.Roles ?? []).includes(`"${roleId}"`),
      );
      expect(attached, roleId).toEqual([]);
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

  it('watches dead-letter queues with the queue health check, not a CloudWatch alarm each (T08d1)', () => {
    expect(JSON.stringify(t.findResources('AWS::CloudWatch::Alarm'))).not.toContain(
      'ApproximateNumberOfMessagesVisible',
    );
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
  const personal = Template.fromStack(
    buildApp({ stage: 'dev', env: {}, owner: 'alice' }).node.findChild(
      'jobdeputy-dev-alice-iad',
    ) as never,
  );

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

  it('lets the web client use secure password sign-in, and hides whether accounts exist', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it("lets the web client sign in through managed login with a code, back to the site's callback (#111)", () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      EnableTokenRevocation: true,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      // WEB_SCOPE: the scope every route outside the extension's reads asks for (decision 0020).
      AllowedOAuthScopes: ['openid', 'email', WEB_SCOPE],
      CallbackURLs: [
        `https://dev.jobdeputy.com${WEB_SIGN_IN_CALLBACK_PATH}`,
        `${LOCAL_WEB_ORIGIN}${WEB_SIGN_IN_CALLBACK_PATH}`,
      ],
      LogoutURLs: ['https://dev.jobdeputy.com/', `${LOCAL_WEB_ORIGIN}/`],
      SupportedIdentityProviders: ['COGNITO'],
    });
    // A personal stack has no site: only a web app on Vite's dev server may sign in to it.
    personal.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      CallbackURLs: [`${LOCAL_WEB_ORIGIN}${WEB_SIGN_IN_CALLBACK_PATH}`],
      LogoutURLs: [`${LOCAL_WEB_ORIGIN}/`],
    });
    // Prod has no site yet: no managed login for the web client, and never localhost.
    const prod = Template.fromStack(
      buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-iad') as never,
    );
    prod.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'web',
      AllowedOAuthFlowsUserPoolClient: false,
    });
    expect(JSON.stringify(prod.toJSON())).not.toContain('localhost');
  });

  it('lets the extension client only sign in through managed login with a code, back to the extension (#54)', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'extension',
      // No password or SRP flow of its own: only managed login's code, then refresh.
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      GenerateSecret: false,
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: ['openid', 'email'],
      CallbackURLs: [...EXTENSION_DEV_IDS, ...EXTENSION_STORE_IDS].map(extensionRedirectUrl),
      SupportedIdentityProviders: ['COGNITO'],
      AccessTokenValidity: 60,
      RefreshTokenValidity: 43200,
    });
    const extension = Object.values(t.findResources('AWS::Cognito::UserPoolClient')).find(
      (client) => client.Properties.ClientName === 'extension',
    );
    expect(extension?.Properties.LogoutURLs).toBeUndefined();
  });

  it('serves managed login (v2) on a domain from the stack ID, branded for the extension (#54)', () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      // `jobdeputy-` + the first part of the stack ID's UUID: never a word Cognito refuses.
      Domain: {
        'Fn::Join': [
          '',
          [
            'jobdeputy-',
            {
              'Fn::Select': [
                0,
                {
                  'Fn::Split': [
                    '-',
                    { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] },
                  ],
                },
              ],
            },
          ],
        ],
      },
      ManagedLoginVersion: 2,
    });
    // Each client has its own branding, the same for both (login-branding.ts).
    const brandings = Object.values(t.findResources('AWS::Cognito::ManagedLoginBranding'));
    expect(
      brandings
        .map((b) => (b.Properties.ClientId.Ref as string).replace(/[0-9A-F]{8}$/, ''))
        .sort(),
    ).toEqual(['AuthUserPoolExtensionClient', 'AuthUserPoolWebClient']);
    expect(new Set(brandings.map((b) => JSON.stringify(b.Properties.Settings))).size).toBe(1);
  });

  it("also serves managed login at auth.<site> on the site's cell, with its certificate and alias (#111)", () => {
    t.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'auth.dev.jobdeputy.com',
      CustomDomainConfig: { CertificateArn: { Ref: Match.stringLikeRegexp('SignInCertificate') } },
      ManagedLoginVersion: 2,
    });
    t.resourceCountIs('AWS::Cognito::UserPoolDomain', 2);
    // Checked in the site's zone, made first in its own stack (the cell imports the zone's ID).
    const zone = { 'Fn::ImportValue': Match.stringLikeRegexp('^jobdeputy-dev-web-dns:') };
    t.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'auth.dev.jobdeputy.com',
      ValidationMethod: 'DNS',
      DomainValidationOptions: [{ DomainName: 'auth.dev.jobdeputy.com', HostedZoneId: zone }],
    });
    t.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'auth.dev.jobdeputy.com.',
      Type: 'A',
      HostedZoneId: zone,
      AliasTarget: Match.objectLike({
        DNSName: {
          'Fn::GetAtt': [
            Match.stringLikeRegexp('AuthUserPoolSignInDomain'),
            'CloudFrontDistribution',
          ],
        },
      }),
    });
    t.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'auth.dev.jobdeputy.com.',
      Type: 'AAAA',
      HostedZoneId: zone,
    });
    // One managed login change at a time: the clients, then the custom domain, then the looks.
    const [customId, custom] = Object.entries(t.findResources('AWS::Cognito::UserPoolDomain')).find(
      ([, d]) => d.Properties.Domain === 'auth.dev.jobdeputy.com',
    ) ?? ['', {}];
    const after = (custom as { DependsOn?: string[] }).DependsOn ?? [];
    for (const client of [
      'AuthUserPoolWebClient',
      'AuthUserPoolExtensionClient',
      'AuthUserPoolDomain',
    ]) {
      expect(after.some((id) => id.startsWith(client))).toBe(true);
    }
    for (const branding of Object.values(t.findResources('AWS::Cognito::ManagedLoginBranding'))) {
      expect(branding.DependsOn).toContain(customId);
    }
    // The domain's own attribute: no lookup function.
    expect(Object.keys(t.findResources('Custom::AWS'))).toEqual([]);
    // The extension builds against it, and the web app reads it from its config.
    t.hasOutput('AuthDomain', {
      Value: {
        'Fn::Join': ['', ['https://', { Ref: Match.stringLikeRegexp('AuthUserPoolSignInDomain') }]],
      },
    });
    t.hasOutput('SiteOrigin', { Value: 'https://dev.jobdeputy.com' });
  });

  it('keeps managed login on the prefix domain for personal stacks (#111)', () => {
    personal.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    personal.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    const authDomain = JSON.stringify(personal.findOutputs('AuthDomain'));
    expect(authDomain).toMatch(/https:\/\/.*AuthUserPoolDomain.*\.amazoncognito\.com/);
    expect(personal.findOutputs('SiteOrigin')).toEqual({});
  });

  it('lets the API accept tokens from the web, extension and (dev) tests clients only', () => {
    const authorizer = Object.values(t.findResources('AWS::ApiGatewayV2::Authorizer'))[0];
    const audience = authorizer?.Properties.JwtConfiguration.Audience as { Ref: string }[];
    expect(audience.map((ref) => ref.Ref.replace(/[0-9A-F]{8}$/, '')).sort()).toEqual(
      ['AuthUserPoolExtensionClient', 'AuthUserPoolTestsClient', 'AuthUserPoolWebClient'].sort(),
    );
  });

  it('has a tests client only in dev, and protects prod pools from deletion', () => {
    t.resourceCountIs('AWS::Cognito::UserPoolClient', 3);
    const prod = buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-lhr');
    const pt = Template.fromStack(prod as never);
    // #54: prod trusts only the store item's ID (the dev key is public); none yet, so prod has
    // no extension client, managed login, or branding until the store item exists.
    pt.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    pt.resourceCountIs('AWS::Cognito::UserPoolDomain', 0);
    pt.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 0);
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
      // #53: only for voluntary answers (condition tested in ai-keys.test.ts).
      'kms:Decrypt',
      'kms:Encrypt',
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

  it("lets the extension's tokens reach only the routes it uses (#54, decision 0020)", () => {
    const routes = Object.entries(t.findResources('AWS::ApiGatewayV2::Route')).filter(
      ([id, r]) => !id.startsWith('TestSiteApi') && r.Properties.AuthorizationType === 'JWT',
    );
    const keys = routes.map(([, r]) => r.Properties.RouteKey as string);
    // Every route the extension may call exists (a typo would quietly lock it out).
    for (const key of EXTENSION_API_ROUTES) expect(keys).toContain(key);
    for (const [, route] of routes) {
      const { RouteKey, AuthorizationScopes } = route.Properties;
      if (EXTENSION_API_ROUTES.includes(RouteKey))
        expect(AuthorizationScopes, RouteKey).toBeUndefined();
      else expect(AuthorizationScopes, RouteKey).toEqual([WEB_SCOPE]);
    }
    expect(keys).toContain('DELETE /me');
  });

  it("outputs the documents' download origin for the extension's host permission (#54 PR C)", () => {
    const [bucket] = Object.keys(t.findResources('AWS::S3::Bucket')).filter((id) =>
      id.startsWith('DocumentsBucket'),
    );
    expect(bucket).toBeDefined();
    expect(t.findOutputs('DocumentsOrigin').DocumentsOrigin?.Value).toEqual({
      'Fn::Join': ['', ['https://', { 'Fn::GetAtt': [bucket, 'RegionalDomainName'] }]],
    });
  });

  it("lets the extension's tokens only read, but for the writes named here (#54, decision 0020)", () => {
    // Each write is a decision of its own. PR D adds its one: 'PUT /me/jobs/{jobId}/stage'.
    const writes: string[] = [];
    expect(EXTENSION_API_ROUTES.filter((route) => !route.startsWith('GET '))).toEqual(writes);
  });

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
      'DELETE /me/ai-keys/{provider}',
      'DELETE /me/documents/{documentId}',
      'DELETE /me/roles/{roleId}',
      'GET /me',
      'GET /me/ai-keys',
      'GET /me/ai-settings',
      'GET /me/ai-usage',
      'GET /me/applicant',
      'GET /me/applications',
      'GET /me/audit',
      'GET /me/companies',
      'GET /me/cover-letters',
      'GET /me/cover-letters/{documentId}',
      'GET /me/crawl-settings',
      'GET /me/crawls',
      'GET /me/crawls/{crawlId}',
      'GET /me/documents',
      'GET /me/documents/{documentId}',
      'GET /me/jobs',
      'GET /me/jobs/{jobId}',
      'GET /me/matches',
      'GET /me/preferences/search',
      'GET /me/profile',
      'GET /me/roles',
      'GET /me/tailorings',
      'GET /me/tailorings/{documentId}',
      'GET /me/voluntary',
      'GET /ping-jobs/{id}',
      'POST /me/ai-keys/{provider}/check',
      'POST /me/cover-letters',
      'POST /me/crawls',
      'POST /me/documents',
      'POST /me/profile/skills',
      'POST /me/roles',
      'POST /me/tailorings',
      'POST /ping-jobs',
      'PUT /me/ai-keys/{provider}',
      'PUT /me/ai-settings',
      'PUT /me/applicant',
      'PUT /me/crawl-settings',
      'PUT /me/documents/{documentId}',
      'PUT /me/jobs/{jobId}/stage',
      'PUT /me/preferences/search',
      'PUT /me/profile',
      'PUT /me/roles/{roleId}',
      'PUT /me/voluntary',
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
