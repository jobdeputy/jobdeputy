import { DERIVED_PREFIX, platformModelArn } from '@jobdeputy/shared';
import { Duration, type RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import type { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import type { AiKeys } from './ai-keys.js';
import { AsyncPipeline } from './async-pipeline.js';
import type { LlmMonitoring } from './llm-monitoring.js';
import { AppFunction } from './node-function.js';
import type { QueueHealth } from './queue-health.js';

export interface RelevanceProps {
  readonly namePrefix: string;
  readonly tables: {
    readonly crawls: Table;
    readonly sources: Table;
    readonly jobs: Table;
    readonly usage: Table;
    readonly audit: Table;
    readonly users: Table;
    readonly preferences: Table;
    readonly documents: Table;
  };
  readonly documentsBucket: Bucket;
  readonly aiKeys: AiKeys;
  readonly limitsParameter: StringParameter;
  readonly removalPolicy: RemovalPolicy;
  readonly maxReceives: number;
  readonly health?: QueueHealth | undefined;
  /** Shared stacks: the daily LLM report and the dashboard read the worker's log lines. */
  readonly monitoring?: LlmMonitoring | undefined;
}

/**
 * Up to 6 task calls of at most 60 seconds each (RELEVANCE_MAX_CALLS); the worker starts
 * no call without the time to finish it, and a typical call takes a few seconds.
 */
export const RELEVANCE_WORKER_TIMEOUT = Duration.minutes(5);

/**
 * T08d: LLM scoring of a crawl's candidate jobs. crawls (a succeeded crawl with an AI
 * source, candidates, and no run yet) → stream → a second Pipe → queue → RelevanceWorker.
 */
export class Relevance extends Construct {
  readonly worker: AppFunction;

  constructor(scope: Construct, id: string, props: RelevanceProps) {
    super(scope, id);
    const { tables } = props;
    this.worker = new AppFunction(this, 'RelevanceWorker', {
      entry: 'apps/worker/src/relevance-worker.ts',
      timeout: RELEVANCE_WORKER_TIMEOUT,
      removalPolicy: props.removalPolicy,
      environment: {
        CRAWLS_TABLE_NAME: tables.crawls.tableName,
        SOURCES_TABLE_NAME: tables.sources.tableName,
        JOBS_TABLE_NAME: tables.jobs.tableName,
        USAGE_TABLE_NAME: tables.usage.tableName,
        AUDIT_TABLE_NAME: tables.audit.tableName,
        USERS_TABLE_NAME: tables.users.tableName,
        PREFERENCES_TABLE_NAME: tables.preferences.tableName,
        DOCUMENTS_TABLE_NAME: tables.documents.tableName,
        DOCUMENTS_BUCKET_NAME: props.documentsBucket.bucketName,
        CRAWL_LIMITS_PARAMETER: props.limitsParameter.parameterName,
        ...props.aiKeys.env,
      },
    });
    props.monitoring?.watch('Relevance worker', this.worker);
    const fn = this.worker.fn;
    // The crawl (GetItem); starting, storing each call, and ending the run (UpdateItem).
    tables.crawls.grant(fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    // The candidates (BatchGetItem); each score, then hidden or ranked (UpdateItem).
    tables.jobs.grant(fn, 'dynamodb:BatchGetItem', 'dynamodb:UpdateItem');
    // AI# token use (UpdateItem, in each call's transaction); each company's shown list
    // (`COMPANY#`: read, replaced at the version read).
    tables.usage.grant(fn, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    tables.audit.grant(fn, 'dynamodb:PutItem');
    // The deletion record, and the profile's headline and skills.
    tables.users.grant(fn, 'dynamodb:GetItem');
    // Roles (Query), search settings, and the user's own company limit.
    tables.preferences.grant(fn, 'dynamodb:GetItem', 'dynamodb:Query');
    // Which résumé is the default (Query), then the start of its extracted text.
    tables.documents.grant(fn, 'dynamodb:Query');
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [props.documentsBucket.arnForObjects(`${DERIVED_PREFIX}*/documents/*/text.txt`)],
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [props.limitsParameter.parameterArn],
      }),
    );
    // The user's own key (GetItem), decrypted only with this user and provider as context.
    props.aiKeys.table.grant(fn, 'dynamodb:GetItem');
    props.aiKeys.grantDecrypt(fn);
    // The platform model (decision 0010), in this Region only, and nothing else in Bedrock.
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [platformModelArn(Stack.of(this).region)],
      }),
    );

    new AsyncPipeline(this, 'RelevancePipeline', {
      table: tables.crawls,
      idAttribute: 'crawlId',
      messageKeys: ['userId', 'crawlId'],
      // The crawl worker's last write ends the crawl; the scoring run's own writes add
      // `relevance`, so they never start another run.
      startWhen: { eventNames: ['MODIFY'], status: 'succeeded' },
      newImageFilter: {
        aiSource: { S: [{ 'anything-but': ['none'] }] },
        stats: { M: { jobsRelevant: { N: [{ 'anything-but': ['0'] }] } } },
        relevance: [{ exists: false }],
      },
      worker: fn,
      workerTimeout: RELEVANCE_WORKER_TIMEOUT,
      maxReceives: props.maxReceives,
      maxConcurrency: 2,
      health: props.health,
      // Normal worst case: about 16 minutes (3 attempts of up to 5 minutes).
      backlogAfter: Duration.minutes(30),
      queueName: `${props.namePrefix}-relevance`,
    });
  }
}
