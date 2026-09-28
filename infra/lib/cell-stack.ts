import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, HttpStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, BillingMode, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CELLS, type CellId } from '../config/cells.js';
import type { StageName } from '../config/stages.js';
import { AsyncPipeline } from './constructs/async-pipeline.js';
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
    pingTable.grantReadWriteData(api.fn);

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
    pingTable.grantReadWriteData(worker.fn);
    idempotencyTable.grantReadWriteData(worker.fn);

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

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: id,
      createDefaultStage: false,
      // IAM (SigV4) until Cognito arrives in T05: nothing is callable anonymously.
      defaultAuthorizer: new HttpIamAuthorizer(),
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

    new CfnOutput(this, 'ApiUrl', { value: stage.url });
    new CfnOutput(this, 'PingTableName', { value: pingTable.tableName });
    new CfnOutput(this, 'PingQueueUrl', { value: pipeline.queue.queueUrl });
    new CfnOutput(this, 'PingDeadLetterQueueUrl', { value: pipeline.deadLetterQueue.queueUrl });
  }
}
