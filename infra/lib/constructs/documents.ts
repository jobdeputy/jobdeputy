import {
  CRAWL_PAGE_RETENTION_DAYS,
  CRAWL_PAGE_RETENTION_TAG,
  DERIVED_PREFIX,
  SCANNED_PREFIX,
} from '@jobdeputy/shared';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { CfnMalwareProtectionPlan } from 'aws-cdk-lib/aws-guardduty';
import { Effect, type IRole, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppFunction } from './node-function.js';
import type { QueueHealth } from './queue-health.js';
import { addQueueWorker } from './queue-worker.js';

export interface DocumentsProps {
  readonly namePrefix: string;
  readonly table: Table;
  /** The user's audit history: the worker records each outcome there (T06d). */
  readonly auditTable: Table;
  readonly removalPolicy: RemovalPolicy;
  /** Shared stacks only (see addQueueWorker). */
  readonly health?: QueueHealth | undefined;
}

const WORKER_TIMEOUT = Duration.seconds(60);
/** Matches the worker's MAX_RECEIVES: 3 tries, then the dead-letter queue. */
export const DOCUMENT_MAX_RECEIVES = 3;

/**
 * Résumé storage (T05c): a private per-cell bucket, GuardDuty malware scanning of
 * every upload, and a worker that extracts text from clean files only.
 *
 * upload (presigned POST) → GuardDuty scan → EventBridge → SQS (+ DLQ) → worker
 */
export class Documents extends Construct {
  readonly bucket: Bucket;
  readonly worker: AppFunction;
  readonly malwarePlan: CfnMalwareProtectionPlan;

  constructor(scope: Construct, id: string, props: DocumentsProps) {
    super(scope, id);
    const { account, region } = Stack.of(this);
    const isProd = props.removalPolicy === RemovalPolicy.RETAIN;

    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // No notifications configured here: the GuardDuty plan turns on the bucket's
      // EventBridge notifications itself (s3:PutBucketNotification in its role).
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // Fetched pages (T06b) are working copies: gone after 30 days. By tag, because
        // their keys are per user (derived/users/<id>/crawls/…) and filters are prefixes.
        {
          id: 'ExpireCrawlPages',
          tagFilters: { [CRAWL_PAGE_RETENTION_TAG.key]: CRAWL_PAGE_RETENTION_TAG.value },
          expiration: Duration.days(CRAWL_PAGE_RETENTION_DAYS),
        },
      ],
      removalPolicy: props.removalPolicy,
      // Dev and PR stacks must delete cleanly; prod keeps user files.
      autoDeleteObjects: !isProd,
    });

    // The role GuardDuty uses to scan and tag objects (AWS's documented policy).
    const scanRole = new Role(this, 'MalwareScanRole', {
      assumedBy: new ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com'),
    });
    const managedRule = `arn:aws:events:${region}:${account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;
    for (const statement of [
      new PolicyStatement({
        actions: [
          'events:PutRule',
          'events:DeleteRule',
          'events:PutTargets',
          'events:RemoveTargets',
        ],
        resources: [managedRule],
        conditions: {
          StringLike: { 'events:ManagedBy': 'malware-protection-plan.guardduty.amazonaws.com' },
        },
      }),
      new PolicyStatement({
        actions: ['events:DescribeRule', 'events:ListTargetsByRule'],
        resources: [managedRule],
      }),
      new PolicyStatement({
        actions: [
          's3:PutObjectTagging',
          's3:GetObjectTagging',
          's3:PutObjectVersionTagging',
          's3:GetObjectVersionTagging',
          's3:GetObject',
          's3:GetObjectVersion',
        ],
        resources: [this.bucket.arnForObjects('*')],
      }),
      new PolicyStatement({
        actions: ['s3:PutBucketNotification', 's3:GetBucketNotification', 's3:ListBucket'],
        resources: [this.bucket.bucketArn],
      }),
      new PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [this.bucket.arnForObjects('malware-protection-resource-validation-object')],
      }),
    ]) {
      scanRole.addToPolicy(statement);
    }

    // Pay per use, $0 idle; approved in T05 under decision 0005.
    this.malwarePlan = new CfnMalwareProtectionPlan(this, 'MalwareScan', {
      role: scanRole.roleArn,
      protectedResource: {
        s3Bucket: { bucketName: this.bucket.bucketName, objectPrefixes: [SCANNED_PREFIX] },
      },
      actions: { tagging: { status: 'ENABLED' } },
    });
    // GuardDuty validates the role's permissions when the plan is created.
    this.malwarePlan.node.addDependency(scanRole);

    this.worker = new AppFunction(this, 'Worker', {
      entry: 'apps/worker/src/document-worker.ts',
      timeout: WORKER_TIMEOUT,
      memorySize: 1024,
      removalPolicy: props.removalPolicy,
      environment: {
        DOCUMENTS_TABLE_NAME: props.table.tableName,
        DOCUMENTS_BUCKET_NAME: this.bucket.bucketName,
        AUDIT_TABLE_NAME: props.auditTable.tableName,
      },
    });
    props.table.grant(this.worker.fn, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    props.auditTable.grant(this.worker.fn, 'dynamodb:PutItem');
    // Reads uploads; writes only derived files (outside the scanned prefix); deletes both.
    this.bucket.grantRead(this.worker.fn, `${SCANNED_PREFIX}*`);
    this.bucket.grantPut(this.worker.fn, `${DERIVED_PREFIX}*`);
    this.bucket.grantDelete(this.worker.fn, `${SCANNED_PREFIX}*`);
    this.bucket.grantDelete(this.worker.fn, `${DERIVED_PREFIX}*`);

    const { queue, deadLetterQueue } = addQueueWorker(this, {
      queueName: `${props.namePrefix}-document-scans`,
      worker: this.worker.fn,
      workerTimeout: WORKER_TIMEOUT,
      maxReceives: DOCUMENT_MAX_RECEIVES,
      maxConcurrency: 2,
      health: props.health,
      // Normal worst case: 3 attempts, each after a 6-minute visibility timeout.
      backlogAfter: Duration.minutes(30),
    });

    // Only scan results for this bucket; the message is GuardDuty's event (bucket, key, ETag, result).
    new Rule(this, 'ScanResults', {
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [this.bucket.bucketName] } },
      },
      targets: [new SqsQueue(queue, { deadLetterQueue })],
    });
  }

  /**
   * Defence in depth: this principal (the API that signs download links) can never
   * read an original upload unless GuardDuty tagged it clean.
   */
  denyUnscannedDownloads(principal: IRole): void {
    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.DENY,
        principals: [principal],
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects(`${SCANNED_PREFIX}*/documents/*/original`)],
        conditions: {
          StringNotEquals: {
            's3:ExistingObjectTag/GuardDutyMalwareScanStatus': 'NO_THREATS_FOUND',
          },
        },
      }),
    );
  }
}
