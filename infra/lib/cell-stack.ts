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

    new CfnOutput(this, 'ApiUrl', { value: stage.url });
    new CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new CfnOutput(this, 'WebClientId', { value: auth.webClient.userPoolClientId });
    if (auth.testsClient) {
      new CfnOutput(this, 'TestsClientId', { value: auth.testsClient.userPoolClientId });
    }
    new CfnOutput(this, 'PingTableName', { value: pingTable.tableName });
    new CfnOutput(this, 'PingQueueUrl', { value: pipeline.queue.queueUrl });
    new CfnOutput(this, 'PingDeadLetterQueueUrl', { value: pipeline.deadLetterQueue.queueUrl });
  }
}
