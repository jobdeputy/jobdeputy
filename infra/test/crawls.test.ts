import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/crawl-worker.js';
import { buildApp } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';

const t = Template.fromStack(
  buildApp({ stage: 'dev', env: {} }).node.findChild('jobdeputy-dev-iad') as never,
);

type Statement = { Action: string | string[]; Resource: unknown };
function statementsFor(logicalIdPrefix: string): Statement[] {
  const policies = Object.entries(t.findResources('AWS::IAM::Policy')).filter(([id]) =>
    id.startsWith(logicalIdPrefix),
  );
  expect(policies.length).toBeGreaterThan(0);
  return policies.flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);
}
/** Actions granted on the resource whose JSON mentions `resource` (a logical ID or ARN part). */
function actionsOn(statements: Statement[], resource: string): string[] {
  return [
    ...new Set(
      statements
        .filter((s) => JSON.stringify(s.Resource).includes(resource))
        .flatMap((s) => [s.Action].flat()),
    ),
  ].sort();
}

describe('crawl pipeline (T06b)', () => {
  it('builds sources, crawls (with a stream and expiry), and audit, keyed by userId', () => {
    for (const [name, sortKey] of [
      ['sources', 'sourceId'],
      ['crawls', 'crawlId'],
      ['audit', 'auditId'],
    ] as const) {
      t.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: `jobdeputy-dev-iad-${name}`,
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: sortKey, KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      });
    }
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-crawls',
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-audit',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
    const sources = Object.values(t.findResources('AWS::DynamoDB::Table')).find(
      (r) => r.Properties.TableName === 'jobdeputy-dev-iad-sources',
    );
    expect(sources?.Properties.StreamSpecification).toBeUndefined();
  });

  it('starts work only for new queued crawls, sending the crawl key only', () => {
    t.hasResourceProperties('AWS::Pipes::Pipe', {
      Source: { 'Fn::GetAtt': [Match.stringLikeRegexp('^CrawlsTable'), 'StreamArn'] },
      SourceParameters: {
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
      TargetParameters: {
        InputTemplate:
          '{"userId": "<$.dynamodb.Keys.userId.S>", "crawlId": "<$.dynamodb.Keys.crawlId.S>"}',
      },
    });
  });

  it('retries 3 times with a dead-letter queue, and the worker agrees on the count', () => {
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-crawls',
      // 6 × the 180 s worker timeout (T07b: a page, then its job board's feed).
      VisibilityTimeout: 1080,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 180,
      MemorySize: 256,
      Environment: { Variables: Match.objectLike({ CRAWLS_TABLE_NAME: Match.anyValue() }) },
    });
  });

  it('gives the worker only the writes it makes, and S3 writes of fetched pages only', () => {
    const worker = statementsFor('CrawlWorkerFn');
    expect(actionsOn(worker, 'CrawlsTable')).toEqual(['dynamodb:UpdateItem']);
    expect(actionsOn(worker, 'SourcesTable')).toEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
    expect(actionsOn(worker, 'AuditTable')).toEqual(['dynamodb:PutItem']);
    expect(actionsOn(worker, 'UsersTable')).toEqual(['dynamodb:GetItem']);
    // T07b: one update per job; never a read, a delete, or a scan.
    expect(actionsOn(worker, 'JobsTable')).toEqual(['dynamodb:UpdateItem']);
    const s3 = worker.filter((s) => [s.Action].flat().some((a) => a.startsWith('s3:')));
    expect(s3.flatMap((s) => [s.Action].flat()).sort()).toEqual([
      's3:PutObject',
      's3:PutObjectTagging',
    ]);
    expect(JSON.stringify(s3.map((s) => s.Resource))).toContain('/derived/users/*/crawls/*/page');
  });

  it('gives the crawls API only the calls it makes', () => {
    const api = statementsFor('CrawlsApiFn');
    expect(actionsOn(api, 'CrawlsTable')).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    expect(actionsOn(api, 'SourcesTable')).toEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
    expect(actionsOn(api, 'AuditTable')).toEqual(['dynamodb:PutItem']);
    expect(api.flatMap((s) => [s.Action].flat()).some((a) => a.startsWith('s3:'))).toBe(false);
  });

  it('lets the jobs API only read the jobs table (T07b)', () => {
    const jobs = statementsFor('JobsApiFn');
    const dynamo = jobs.filter((s) => [s.Action].flat().some((a) => a.startsWith('dynamodb:')));
    expect(dynamo.flatMap((s) => [s.Action].flat()).sort()).toEqual([
      'dynamodb:GetItem',
      'dynamodb:Query',
    ]);
    expect(actionsOn(jobs, 'JobsTable')).toEqual(['dynamodb:GetItem', 'dynamodb:Query']);
    expect(jobs.flatMap((s) => [s.Action].flat()).some((a) => a.startsWith('s3:'))).toBe(false);
  });

  it('lets the audit API only read the audit table', () => {
    const audit = statementsFor('AuditApiFn');
    expect(
      audit.flatMap((s) => [s.Action].flat()).filter((a) => a.startsWith('dynamodb:')),
    ).toEqual(['dynamodb:Query']);
    expect(JSON.stringify(audit.map((s) => s.Resource))).not.toMatch(
      /CrawlsTable|SourcesTable|UsersTable/,
    );
  });
});

describe('crawl limits (T06c)', () => {
  it('keeps the admin limits in a free standard parameter, starting at the built-in defaults', () => {
    t.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/jobdeputy/jobdeputy-dev-iad/crawl-limits',
      Type: 'String',
      Value: '{"dailyDefault":20,"dailyMax":50,"maxActive":1}',
    });
    const parameter = Object.values(t.findResources('AWS::SSM::Parameter')).find(
      (p) => p.Properties.Name === '/jobdeputy/jobdeputy-dev-iad/crawl-limits',
    );
    expect(parameter?.Properties.Tier ?? 'Standard').toBe('Standard');
  });

  it('builds the usage table with expiry, keyed by userId and sk', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-usage',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('lets only the crawls API count, read settings, and read the limits parameter', () => {
    const api = statementsFor('CrawlsApiFn');
    expect(actionsOn(api, 'UsageTable')).toEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);
    expect(actionsOn(api, 'PreferencesTable')).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem']);
    const ssm = api.filter((s) => [s.Action].flat().some((a) => a.startsWith('ssm:')));
    expect(ssm.flatMap((s) => [s.Action].flat())).toEqual(['ssm:GetParameter']);
    expect(JSON.stringify(ssm[0]?.Resource)).toMatch(/:parameter",{"Ref":"CrawlLimits/);

    const worker = statementsFor('CrawlWorkerFn');
    // Only to free the crawl's active slot when it ends; counting happens at submit.
    expect(actionsOn(worker, 'UsageTable')).toEqual(['dynamodb:UpdateItem']);
    expect(actionsOn(worker, 'PreferencesTable')).toEqual([]);
  });
});

describe('audit history for every action (T06d)', () => {
  it('lets each function that changes user data write audit entries, and only add them', () => {
    for (const fn of [
      'ProfileApiFn',
      'DocumentsApiFn',
      'DocumentsWorkerFn',
      'CrawlsApiFn',
      'CrawlWorkerFn',
    ]) {
      expect(actionsOn(statementsFor(fn), 'AuditTable'), fn).toEqual(['dynamodb:PutItem']);
    }
    expect(actionsOn(statementsFor('AuditApiFn'), 'AuditTable')).toEqual(['dynamodb:Query']);
  });
});
