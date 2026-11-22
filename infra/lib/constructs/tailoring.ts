import { DERIVED_PREFIX, platformModelArn } from '@jobdeputy/shared';
import { Duration, type RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { StageName } from '../../config/stages.js';
import type { AiKeys } from './ai-keys.js';
import { AsyncPipeline } from './async-pipeline.js';
import { llmMetricsEnvironment } from './llm-monitoring.js';
import { AppFunction, RENDERS_RESUMES } from './node-function.js';
import type { QueueHealth } from './queue-health.js';

export interface TailoringProps {
  readonly namePrefix: string;
  readonly stage: StageName;
  readonly tables: {
    /** Needs a NEW_IMAGE stream: a generated version inserted `queued` starts the worker. */
    readonly documents: Table;
    readonly jobs: Table;
    readonly usage: Table;
    readonly audit: Table;
    readonly users: Table;
    readonly preferences: Table;
  };
  readonly documentsBucket: Bucket;
  readonly aiKeys: AiKeys;
  readonly removalPolicy: RemovalPolicy;
  readonly maxReceives: number;
  readonly health?: QueueHealth | undefined;
}

/**
 * At most 5 task calls of up to 120 seconds each (TAILORING_MAX_CALLS), plus rendering; the
 * worker starts no call without the time to finish it, and a typical call takes seconds.
 */
export const TAILORING_WORKER_TIMEOUT = Duration.minutes(12);

/**
 * #51 (decision 0015): tailored résumés. POST /me/tailorings puts a generated version
 * `queued` in documents → stream → Pipe (generated `queued` inserts only) → queue →
 * TailoringWorker, which writes its files under derived/ and ends it ready or failed.
 */
export class Tailoring extends Construct {
  readonly api: AppFunction;
  readonly worker: AppFunction;

  constructor(scope: Construct, id: string, props: TailoringProps) {
    super(scope, id);
    const { tables, documentsBucket: bucket } = props;
    const derived = (file: string) =>
      bucket.arnForObjects(`${DERIVED_PREFIX}*/documents/*/${file}`);
    const versionFiles = ['resume.json', 'resume.pdf', 'resume.docx'].map(derived);

    this.worker = new AppFunction(this, 'TailoringWorker', {
      entry: 'apps/worker/src/tailoring-worker.ts',
      timeout: TAILORING_WORKER_TIMEOUT,
      // Rendering a PDF with an embedded font, and the model calls.
      memorySize: 512,
      removalPolicy: props.removalPolicy,
      ...RENDERS_RESUMES,
      environment: {
        DOCUMENTS_TABLE_NAME: tables.documents.tableName,
        JOBS_TABLE_NAME: tables.jobs.tableName,
        USAGE_TABLE_NAME: tables.usage.tableName,
        AUDIT_TABLE_NAME: tables.audit.tableName,
        USERS_TABLE_NAME: tables.users.tableName,
        PREFERENCES_TABLE_NAME: tables.preferences.tableName,
        DOCUMENTS_BUCKET_NAME: bucket.bucketName,
        ...props.aiKeys.env,
        ...llmMetricsEnvironment(props.stage),
      },
    });
    const fn = this.worker.fn;
    // The version: claim, each call, the end (UpdateItem); the base résumé (GetItem) and its
    // structured copy recorded (UpdateItem); the company's versions (Query); old ones (BatchWriteItem).
    tables.documents.grant(
      fn,
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
      'dynamodb:Query',
      'dynamodb:BatchWriteItem',
    );
    // The jobs (BatchGetItem); their keywords, score, and version link (UpdateItem).
    tables.jobs.grant(fn, 'dynamodb:BatchGetItem', 'dynamodb:UpdateItem');
    // AI# token use, the company's lock, a free run given back.
    tables.usage.grant(fn, 'dynamodb:UpdateItem');
    tables.audit.grant(fn, 'dynamodb:PutItem');
    // The deletion record, and the profile's name and skills.
    tables.users.grant(fn, 'dynamodb:GetItem');
    // Reads the résumé's text and a cached structured copy; writes that copy and the version's
    // files; deletes the files of versions past the company's limit. Nothing else in the bucket.
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [derived('text.txt'), derived('structured.json')],
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [derived('structured.json'), ...versionFiles],
      }),
    );
    fn.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:DeleteObject'], resources: versionFiles }),
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

    new AsyncPipeline(this, 'TailoringPipeline', {
      table: tables.documents,
      idAttribute: 'documentId',
      messageKeys: ['userId', 'documentId'],
      // Only generated versions: uploads are never `queued` (they start `pending`), and this
      // keeps any future queued upload kind out of this worker.
      newImageFilter: { origin: { S: ['generated'] } },
      worker: fn,
      workerTimeout: TAILORING_WORKER_TIMEOUT,
      maxReceives: props.maxReceives,
      maxConcurrency: 2,
      health: props.health,
      // Normal worst case: about 40 minutes (3 attempts of up to 12 minutes).
      backlogAfter: Duration.minutes(45),
      queueName: `${props.namePrefix}-tailoring`,
    });

    this.api = new AppFunction(this, 'TailoringApi', {
      entry: 'apps/api/src/tailoring.ts',
      timeout: Duration.seconds(10),
      removalPolicy: props.removalPolicy,
      environment: {
        DOCUMENTS_TABLE_NAME: tables.documents.tableName,
        DOCUMENTS_BUCKET_NAME: bucket.bucketName,
        USERS_TABLE_NAME: tables.users.tableName,
        AUDIT_TABLE_NAME: tables.audit.tableName,
        USAGE_TABLE_NAME: tables.usage.tableName,
        JOBS_TABLE_NAME: tables.jobs.tableName,
        PREFERENCES_TABLE_NAME: tables.preferences.tableName,
        ...props.aiKeys.env,
      },
    });
    const api = this.api.fn;
    // The default résumé and the versions (Query), one version (GetItem), a new one (PutItem,
    // in the request transaction).
    tables.documents.grant(api, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem');
    // The company's shown jobs and the month's free runs (GetItem); the allowance and the lock
    // (UpdateItem, in the request transaction).
    tables.usage.grant(api, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    tables.jobs.grant(api, 'dynamodb:BatchGetItem');
    tables.audit.grant(api, 'dynamodb:PutItem');
    // The deletion record (writes refused while it exists).
    tables.users.grant(api, 'dynamodb:GetItem');
    // The user's AI setting, and whether their key works (never decrypted here).
    tables.preferences.grant(api, 'dynamodb:GetItem');
    props.aiKeys.table.grant(api, 'dynamodb:GetItem');
    // A ready version's résumé (to preview) and its two downloads (presigned GET).
    api.addToRolePolicy(
      new PolicyStatement({ actions: ['s3:GetObject'], resources: versionFiles }),
    );
  }
}
