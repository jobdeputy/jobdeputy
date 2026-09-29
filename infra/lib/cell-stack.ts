import { crawlKeys, DEFAULT_CRAWL_LIMITS, DERIVED_PREFIX, SCANNED_PREFIX } from '@jobdeputy/shared';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  Alarm,
  ComparisonOperator,
  type IMetric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { UserPoolOperation } from 'aws-cdk-lib/aws-cognito';
import { AttributeType, BillingMode, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CELLS, type CellId } from '../config/cells.js';
import type { StageName } from '../config/stages.js';
import { AsyncPipeline } from './constructs/async-pipeline.js';
import { Auth } from './constructs/auth.js';
import { Documents } from './constructs/documents.js';
import { AppFunction } from './constructs/node-function.js';

export interface CellStackProps extends StackProps {
  readonly stage: StageName;
  readonly cell: CellId;
  /** Set for personal developer stacks, for example "nava". */
  readonly owner?: string;
  /** Receive alarm emails. Come from JD_ALERT_EMAIL (comma-separated), never from the repository. */
  readonly alertEmails?: readonly string[];
}

const WORKER_TIMEOUT = Duration.seconds(30);
/** A fetch takes at most 20 s (0007); the rest is headroom for S3 and DynamoDB. */
const CRAWL_WORKER_TIMEOUT = Duration.seconds(60);
/** T04 decision: 3 tries, then the dead-letter queue. Must match the worker's MAX_RECEIVES. */
export const MAX_RECEIVES = 3;

/** Everything one Region cell needs. Tables follow docs/data-model.md. */
export class CellStack extends Stack {
  constructor(scope: Construct, id: string, props: CellStackProps) {
    super(scope, id, props);

    Tags.of(this).add('project', 'jobdeputy');
    Tags.of(this).add('stage', props.stage);
    Tags.of(this).add('cell', props.cell);
    if (props.owner) Tags.of(this).add('owner', props.owner);

    const isProd = props.stage === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Free (standard tier). Lets a deploy be verified end to end.
    new StringParameter(this, 'CellInfo', {
      parameterName: `/jobdeputy/${id}/cell-info`,
      stringValue: JSON.stringify({
        stage: props.stage,
        cell: props.cell,
        region: CELLS[props.cell].region,
        owner: props.owner ?? null,
      }),
    });

    // Free until it sends (email notifications are free up to 1,000 a month).
    const alarmTopic = new Topic(this, 'Alarms', { topicName: `${id}-alarms` });
    for (const email of props.alertEmails ?? []) {
      alarmTopic.addSubscription(new EmailSubscription(email));
    }
    /**
     * Shared stacks only (no owner): personal and PR stacks have no subscribers, and
     * this keeps the account within CloudWatch's 10 free alarms (T13).
     */
    const alarm = (logicalId: string, metric: IMetric, description: string) =>
      new Alarm(this, logicalId, {
        alarmDescription: description,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new SnsAction(alarmTopic));

    const auth = new Auth(this, 'Auth', {
      namePrefix: id,
      removalPolicy,
      deletionProtection: isProd,
      testsClient: props.stage === 'dev',
    });

    // User data tables (docs/data-model.md): keyed by userId, never shared across cells.
    const userTable = (
      logicalId: string,
      name: string,
      sortKey = 'sk',
      ttl?: string,
      stream = false,
    ) =>
      new Table(this, logicalId, {
        ...(stream ? { stream: StreamViewType.NEW_IMAGE } : {}),
        tableName: `${id}-${name}`,
        partitionKey: { name: 'userId', type: AttributeType.STRING },
        sortKey: { name: sortKey, type: AttributeType.STRING },
        ...(ttl ? { timeToLiveAttribute: ttl } : {}),
        billingMode: BillingMode.PAY_PER_REQUEST,
        // Same-Region backups in prod only (0004); dev data is disposable.
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
        removalPolicy,
      });
    // Stream: a DELETION item starts the account-deletion worker (T12); ttl expires that item.
    const usersTable = userTable('UsersTable', 'users', 'sk', 'ttl', true);
    const preferencesTable = userTable('PreferencesTable', 'preferences');
    // Pending uploads that never arrive expire (ttl).
    const documentsTable = userTable('DocumentsTable', 'documents', 'documentId', 'ttl');
    // T06b (0007): pages the user saved; crawl runs (stream → crawl worker; kept 180 days);
    // the user's audit history (kept a year).
    const sourcesTable = userTable('SourcesTable', 'sources', 'sourceId');
    const crawlsTable = userTable('CrawlsTable', 'crawls', 'crawlId', 'ttl', true);
    const auditTable = userTable('AuditTable', 'audit', 'auditId', 'ttl');
    // T06c: counters (DAY# items expire after a week).
    const usageTable = userTable('UsageTable', 'usage', 'sk', 'ttl');
    /**
     * Every table keyed by userId. Account deletion erases all of them; an infra test
     * fails if a table keyed by userId is missing here (T12).
     */
    const userTables = [
      { table: usersTable, sortKey: 'sk' },
      { table: preferencesTable, sortKey: 'sk' },
      { table: documentsTable, sortKey: 'documentId' },
      { table: sourcesTable, sortKey: 'sourceId' },
      { table: crawlsTable, sortKey: 'crawlId' },
      { table: auditTable, sortKey: 'auditId' },
      { table: usageTable, sortKey: 'sk' },
    ];
    const documents = new Documents(this, 'Documents', {
      namePrefix: id,
      table: documentsTable,
      auditTable,
      removalPolicy,
      alarmTopic,
    });

    // T13, every stage: reserved test domains (example.com, *.test, …) can never become
    // real accounts. Admin-created test users are allowed only in dev pools.
    const preSignUp = new AppFunction(this, 'PreSignUp', {
      entry: 'apps/api/src/pre-signup.ts',
      timeout: Duration.seconds(5),
      removalPolicy,
      environment: { ALLOW_TEST_USERS: props.stage === 'dev' ? 'true' : 'false' },
    });
    auth.userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, preSignUp.fn);

    const pingTable = new Table(this, 'PingJobsTable', {
      tableName: `${id}-ping-jobs`,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    const idempotencyTable = new Table(this, 'IdempotencyTable', {
      tableName: `${id}-idempotency`,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiration',
      removalPolicy,
    });

    const api = new AppFunction(this, 'PingApi', {
      entry: 'apps/api/src/ping-jobs.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        PING_TABLE_NAME: pingTable.tableName,
        STAGE: props.stage,
        USERS_TABLE_NAME: usersTable.tableName,
      },
    });
    usersTable.grant(api.fn, 'dynamodb:GetItem');
    // Least privilege: only the calls each function makes.
    pingTable.grant(api.fn, 'dynamodb:PutItem', 'dynamodb:GetItem');

    const worker = new AppFunction(this, 'PingWorker', {
      entry: 'apps/worker/src/ping-worker.ts',
      timeout: WORKER_TIMEOUT,
      removalPolicy,
      environment: {
        PING_TABLE_NAME: pingTable.tableName,
        IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
        STAGE: props.stage,
      },
    });
    pingTable.grant(worker.fn, 'dynamodb:UpdateItem');
    // What Powertools idempotency needs.
    idempotencyTable.grant(
      worker.fn,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    );

    const pipeline = new AsyncPipeline(this, 'PingPipeline', {
      table: pingTable,
      idAttribute: 'id',
      worker: worker.fn,
      workerTimeout: WORKER_TIMEOUT,
      maxReceives: MAX_RECEIVES,
      maxConcurrency: 2,
      alarmTopic,
      queueName: `${id}-ping-jobs`,
    });

    const me = new AppFunction(this, 'MeApi', {
      entry: 'apps/api/src/me.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        USER_POOL_ID: auth.userPool.userPoolId,
        CELL: props.cell,
        USERS_TABLE_NAME: usersTable.tableName,
      },
    });
    // Least privilege: read one user's attributes (the email) in this cell's pool only,
    // and record or check a deletion request (T12).
    auth.userPool.grant(me.fn, 'cognito-idp:AdminGetUser');
    usersTable.grant(me.fn, 'dynamodb:GetItem', 'dynamodb:PutItem');

    const userTablesJson = Stack.of(this).toJsonString(
      userTables.map(({ table, sortKey }) => ({ name: table.tableName, sortKey })),
    );
    const deletionWorker = new AppFunction(this, 'DeletionWorker', {
      entry: 'apps/worker/src/deletion-worker.ts',
      timeout: Duration.seconds(120),
      removalPolicy,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        USER_TABLES: userTablesJson,
        DOCUMENTS_BUCKET_NAME: documents.bucket.bucketName,
        USER_POOL_ID: auth.userPool.userPoolId,
      },
    });
    for (const { table } of userTables) {
      table.grant(deletionWorker.fn, 'dynamodb:Query', 'dynamodb:BatchWriteItem');
    }
    usersTable.grant(deletionWorker.fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    auth.userPool.grant(
      deletionWorker.fn,
      'cognito-idp:AdminUserGlobalSignOut',
      'cognito-idp:AdminDeleteUser',
    );
    // List only under the two user prefixes; delete only there.
    deletionWorker.fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [documents.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [`${SCANNED_PREFIX}*`, `${DERIVED_PREFIX}*`] } },
      }),
    );
    documents.bucket.grantDelete(deletionWorker.fn, `${SCANNED_PREFIX}*`);
    documents.bucket.grantDelete(deletionWorker.fn, `${DERIVED_PREFIX}*`);
    const deletionPipeline = new AsyncPipeline(this, 'DeletionPipeline', {
      table: usersTable,
      idAttribute: 'userId',
      newImageFilter: { sk: { S: ['DELETION'] } },
      worker: deletionWorker.fn,
      workerTimeout: Duration.seconds(120),
      maxReceives: 3,
      maxConcurrency: 2,
      alarmTopic,
      queueName: `${id}-account-deletions`,
    });
    // The worker schedules its one final sweep on its own queue.
    deletionWorker.fn.addEnvironment('QUEUE_URL', deletionPipeline.queue.queueUrl);
    deletionPipeline.queue.grantSendMessages(deletionWorker.fn);

    if (props.stage === 'dev') {
      // T13, dev stacks only: once a day, request deletion (T12) of test logins older than
      // a day and of data whose login is gone. It deletes nothing itself.
      const reaper = new AppFunction(this, 'TestDataReaper', {
        entry: 'apps/worker/src/test-data-reaper.ts',
        timeout: Duration.seconds(60),
        removalPolicy,
        environment: {
          USERS_TABLE_NAME: usersTable.tableName,
          USER_TABLES: userTablesJson,
          USER_POOL_ID: auth.userPool.userPoolId,
        },
      });
      auth.userPool.grant(reaper.fn, 'cognito-idp:ListUsersInGroup', 'cognito-idp:ListUsers');
      for (const { table } of userTables) table.grant(reaper.fn, 'dynamodb:Scan');
      usersTable.grant(reaper.fn, 'dynamodb:GetItem', 'dynamodb:PutItem');
      new Rule(this, 'TestDataReaperSchedule', {
        schedule: Schedule.cron({ minute: '30', hour: '4' }),
        targets: [new LambdaFunction(reaper.fn, { retryAttempts: 2 })],
      });
      if (!props.owner) {
        // Fails when the reaper breaks or finds leftovers (it reports those as an error).
        alarm(
          'TestDataReaperAlarm',
          reaper.fn.metricErrors({ period: Duration.minutes(5) }),
          'The test-data reaper failed or found leftover data. See docs/runbooks/alarms.md.',
        );
      }
    }

    const profile = new AppFunction(this, 'ProfileApi', {
      entry: 'apps/api/src/profile.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        PREFERENCES_TABLE_NAME: preferencesTable.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
        USER_POOL_ID: auth.userPool.userPoolId,
        CELL: props.cell,
      },
    });
    // T06d: every change is recorded in the user's audit history, in the same transaction.
    auditTable.grant(profile.fn, 'dynamodb:PutItem');
    usersTable.grant(profile.fn, 'dynamodb:GetItem', 'dynamodb:PutItem');
    preferencesTable.grant(
      profile.fn,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:DeleteItem',
    );
    auth.userPool.grant(profile.fn, 'cognito-idp:AdminGetUser');

    const documentsApi = new AppFunction(this, 'DocumentsApi', {
      entry: 'apps/api/src/documents.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET_NAME: documents.bucket.bucketName,
        USERS_TABLE_NAME: usersTable.tableName,
        AUDIT_TABLE_NAME: auditTable.tableName,
      },
    });
    usersTable.grant(documentsApi.fn, 'dynamodb:GetItem');
    auditTable.grant(documentsApi.fn, 'dynamodb:PutItem');
    documentsTable.grant(
      documentsApi.fn,
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    );
    // Presigned POST (upload) and GET (download) of uploads only; deletes uploads and derived files.
    documents.bucket.grantPut(documentsApi.fn, `${SCANNED_PREFIX}*`);
    documents.bucket.grantRead(documentsApi.fn, `${SCANNED_PREFIX}*`);
    documents.bucket.grantDelete(documentsApi.fn, `${SCANNED_PREFIX}*`);
    documents.bucket.grantDelete(documentsApi.fn, `${DERIVED_PREFIX}*`);
    if (documentsApi.fn.role) documents.denyUnscannedDownloads(documentsApi.fn.role);

    const crawlTablesEnv = {
      CRAWLS_TABLE_NAME: crawlsTable.tableName,
      SOURCES_TABLE_NAME: sourcesTable.tableName,
      AUDIT_TABLE_NAME: auditTable.tableName,
      USERS_TABLE_NAME: usersTable.tableName,
      USAGE_TABLE_NAME: usageTable.tableName,
    };
    /**
     * T06c: the admin's daily crawl limits for this cell (free standard parameter). Edit
     * it to change them without a deploy (docs/runbooks/crawl-limits.md). The value here
     * is only the initial one: CloudFormation rewrites it only if this value changes.
     */
    const crawlLimits = new StringParameter(this, 'CrawlLimits', {
      parameterName: `/jobdeputy/${id}/crawl-limits`,
      description:
        'Daily crawl limits: {"dailyDefault": N, "dailyMax": N}. Read live by the API (5-minute cache).',
      stringValue: JSON.stringify(DEFAULT_CRAWL_LIMITS),
    });
    // T06b: POST /me/crawls → crawls table (queued) → stream → Pipe → queue → worker.
    const crawlsApi = new AppFunction(this, 'CrawlsApi', {
      entry: 'apps/api/src/crawls.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        ...crawlTablesEnv,
        PREFERENCES_TABLE_NAME: preferencesTable.tableName,
        CRAWL_LIMITS_PARAMETER: crawlLimits.parameterName,
      },
    });
    usersTable.grant(crawlsApi.fn, 'dynamodb:GetItem');
    // Counting (in the request transaction) and reading today's use.
    usageTable.grant(crawlsApi.fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    // The user's own limit (CRAWL_SETTINGS), saved with its audit entry.
    preferencesTable.grant(crawlsApi.fn, 'dynamodb:GetItem', 'dynamodb:PutItem');
    crawlsApi.fn.addToRolePolicy(
      new PolicyStatement({ actions: ['ssm:GetParameter'], resources: [crawlLimits.parameterArn] }),
    );
    sourcesTable.grant(crawlsApi.fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    // UpdateItem: ending a stale crawl before replacing it.
    crawlsTable.grant(
      crawlsApi.fn,
      'dynamodb:PutItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    );
    auditTable.grant(crawlsApi.fn, 'dynamodb:PutItem');

    const crawlWorker = new AppFunction(this, 'CrawlWorker', {
      entry: 'apps/worker/src/crawl-worker.ts',
      timeout: CRAWL_WORKER_TIMEOUT,
      removalPolicy,
      environment: { ...crawlTablesEnv, DOCUMENTS_BUCKET_NAME: documents.bucket.bucketName },
    });
    usersTable.grant(crawlWorker.fn, 'dynamodb:GetItem');
    crawlsTable.grant(crawlWorker.fn, 'dynamodb:UpdateItem');
    // Frees the crawl's active slot when it ends (same transaction).
    usageTable.grant(crawlWorker.fn, 'dynamodb:UpdateItem');
    sourcesTable.grant(crawlWorker.fn, 'dynamodb:UpdateItem');
    auditTable.grant(crawlWorker.fn, 'dynamodb:PutItem');
    // Writes fetched pages only (tagged for the 30-day expiry); reads nothing from S3.
    crawlWorker.fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:PutObject', 's3:PutObjectTagging'],
        resources: [documents.bucket.arnForObjects(crawlKeys('*', '*').page)],
      }),
    );
    new AsyncPipeline(this, 'CrawlPipeline', {
      table: crawlsTable,
      idAttribute: 'crawlId',
      messageKeys: ['userId', 'crawlId'],
      worker: crawlWorker.fn,
      workerTimeout: CRAWL_WORKER_TIMEOUT,
      maxReceives: MAX_RECEIVES,
      maxConcurrency: 2,
      alarmTopic,
      queueName: `${id}-crawls`,
    });

    const auditApi = new AppFunction(this, 'AuditApi', {
      entry: 'apps/api/src/audit.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: { AUDIT_TABLE_NAME: auditTable.tableName },
    });
    // Read-only: audit entries are never changed through the API.
    auditTable.grant(auditApi.fn, 'dynamodb:Query');

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: id,
      createDefaultStage: false,
      // Every route needs a valid token from this cell's pool (T05). API Gateway
      // rejects missing, invalid, or expired tokens before any Lambda runs.
      defaultAuthorizer: new HttpUserPoolAuthorizer('Cognito', auth.userPool, {
        userPoolClients: [auth.webClient, ...(auth.testsClient ? [auth.testsClient] : [])],
      }),
    });
    if (!props.owner) {
      alarm(
        'ApiServerErrorAlarm',
        httpApi.metricServerError({ period: Duration.minutes(5) }),
        'The API returned server errors (5xx). See docs/runbooks/alarms.md.',
      );
    }
    const stage = new HttpStage(this, 'DefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: isProd ? { rateLimit: 50, burstLimit: 100 } : { rateLimit: 5, burstLimit: 10 },
    });
    const integration = new HttpLambdaIntegration('PingIntegration', api.fn);
    httpApi.addRoutes({ path: '/ping-jobs', methods: [HttpMethod.POST], integration });
    httpApi.addRoutes({ path: '/ping-jobs/{id}', methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({
      path: '/me',
      methods: [HttpMethod.GET, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('MeIntegration', me.fn),
    });
    const profileIntegration = new HttpLambdaIntegration('ProfileIntegration', profile.fn);
    const profileRoutes: [string, HttpMethod[]][] = [
      ['/me/profile', [HttpMethod.GET, HttpMethod.PUT]],
      ['/me/preferences/search', [HttpMethod.GET, HttpMethod.PUT]],
      ['/me/roles', [HttpMethod.GET, HttpMethod.POST]],
      ['/me/roles/{roleId}', [HttpMethod.PUT, HttpMethod.DELETE]],
    ];
    for (const [path, methods] of profileRoutes) {
      httpApi.addRoutes({ path, methods, integration: profileIntegration });
    }
    const documentsIntegration = new HttpLambdaIntegration('DocumentsIntegration', documentsApi.fn);
    httpApi.addRoutes({
      path: '/me/documents',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: documentsIntegration,
    });
    httpApi.addRoutes({
      path: '/me/documents/{documentId}',
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: documentsIntegration,
    });

    const crawlsIntegration = new HttpLambdaIntegration('CrawlsIntegration', crawlsApi.fn);
    httpApi.addRoutes({
      path: '/me/crawls',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: crawlsIntegration,
    });
    httpApi.addRoutes({
      path: '/me/crawls/{crawlId}',
      methods: [HttpMethod.GET],
      integration: crawlsIntegration,
    });
    httpApi.addRoutes({
      path: '/me/crawl-settings',
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: crawlsIntegration,
    });

    httpApi.addRoutes({
      path: '/me/audit',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('AuditIntegration', auditApi.fn),
    });

    if (props.stage === 'dev') {
      // T06b, dev stacks only: fixed public pages for the crawl integration tests, holding
      // and reading no data. Its own API, apart from the product API, so that (1) its
      // deliberate errors (a "site that is down" answers 503) never reach the API 5xx
      // alarm, and (2) every product API route needs a token in every stage. Infra tests
      // keep it out of prod and out of alarms.
      const testSite = new AppFunction(this, 'TestSite', {
        entry: 'apps/api/src/test-site.ts',
        timeout: Duration.seconds(5),
        removalPolicy,
        environment: { STAGE: props.stage },
      });
      const testSiteApi = new HttpApi(this, 'TestSiteApi', {
        apiName: `${id}-test-site`,
        createDefaultStage: false,
      });
      const testSiteStage = new HttpStage(this, 'TestSiteStage', {
        httpApi: testSiteApi,
        stageName: '$default',
        autoDeploy: true,
        throttle: { rateLimit: 5, burstLimit: 10 },
      });
      testSiteApi.addRoutes({
        path: '/test-site/{page}',
        methods: [HttpMethod.GET],
        integration: new HttpLambdaIntegration('TestSiteIntegration', testSite.fn),
      });
      new CfnOutput(this, 'TestSiteUrl', { value: testSiteStage.url });
    }

    new CfnOutput(this, 'ApiUrl', { value: stage.url });
    new CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new CfnOutput(this, 'DocumentsBucketName', { value: documents.bucket.bucketName });
    new CfnOutput(this, 'MalwareProtectionPlanId', {
      value: documents.malwarePlan.attrMalwareProtectionPlanId,
    });
    new CfnOutput(this, 'WebClientId', { value: auth.webClient.userPoolClientId });
    if (auth.testsClient) {
      new CfnOutput(this, 'TestsClientId', { value: auth.testsClient.userPoolClientId });
    }
    new CfnOutput(this, 'PingTableName', { value: pingTable.tableName });
    new CfnOutput(this, 'PingQueueUrl', { value: pipeline.queue.queueUrl });
    new CfnOutput(this, 'PingDeadLetterQueueUrl', { value: pipeline.deadLetterQueue.queueUrl });
  }
}
