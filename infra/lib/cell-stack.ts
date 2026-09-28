import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
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

    const auth = new Auth(this, 'Auth', {
      namePrefix: id,
      removalPolicy,
      deletionProtection: isProd,
      testsClient: props.stage === 'dev',
    });

    // User data tables (docs/data-model.md): keyed by userId, never shared across cells.
    const userTable = (logicalId: string, name: string, sortKey = 'sk', ttl?: string) =>
      new Table(this, logicalId, {
        tableName: `${id}-${name}`,
        partitionKey: { name: 'userId', type: AttributeType.STRING },
        sortKey: { name: sortKey, type: AttributeType.STRING },
        ...(ttl ? { timeToLiveAttribute: ttl } : {}),
        billingMode: BillingMode.PAY_PER_REQUEST,
        // Same-Region backups in prod only (0004); dev data is disposable.
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
        removalPolicy,
      });
    const usersTable = userTable('UsersTable', 'users');
    const preferencesTable = userTable('PreferencesTable', 'preferences');
    // Pending uploads that never arrive expire (ttl).
    const documentsTable = userTable('DocumentsTable', 'documents', 'documentId', 'ttl');
    const documents = new Documents(this, 'Documents', {
      namePrefix: id,
      table: documentsTable,
      removalPolicy,
      alarmTopic,
    });

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
      environment: { PING_TABLE_NAME: pingTable.tableName, STAGE: props.stage },
    });
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
      environment: { USER_POOL_ID: auth.userPool.userPoolId, CELL: props.cell },
    });
    // Least privilege: read one user's attributes (the email) in this cell's pool only.
    auth.userPool.grant(me.fn, 'cognito-idp:AdminGetUser');

    const profile = new AppFunction(this, 'ProfileApi', {
      entry: 'apps/api/src/profile.ts',
      timeout: Duration.seconds(10),
      removalPolicy,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
        PREFERENCES_TABLE_NAME: preferencesTable.tableName,
        USER_POOL_ID: auth.userPool.userPoolId,
        CELL: props.cell,
      },
    });
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
      },
    });
    documentsTable.grant(
      documentsApi.fn,
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    );
    // Presigned POST (upload), presigned GET (download), and delete: user files only.
    documents.bucket.grantPut(documentsApi.fn, 'users/*');
    documents.bucket.grantRead(documentsApi.fn, 'users/*');
    documents.bucket.grantDelete(documentsApi.fn, 'users/*');
    if (documentsApi.fn.role) documents.denyUnscannedDownloads(documentsApi.fn.role);

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: id,
      createDefaultStage: false,
      // Every route needs a valid token from this cell's pool (T05). API Gateway
      // rejects missing, invalid, or expired tokens before any Lambda runs.
      defaultAuthorizer: new HttpUserPoolAuthorizer('Cognito', auth.userPool, {
        userPoolClients: [auth.webClient, ...(auth.testsClient ? [auth.testsClient] : [])],
      }),
    });
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
      methods: [HttpMethod.GET],
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
