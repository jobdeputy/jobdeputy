import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/document-worker.js';
import { buildApp } from '../lib/build-app.js';
import { DOCUMENT_MAX_RECEIVES } from '../lib/constructs/documents.js';

function template(stage: 'dev' | 'prod' = 'dev', stack = 'jobdeputy-dev-iad'): Template {
  return Template.fromStack(buildApp({ stage, env: {} }).node.findChild(stack) as never);
}

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};

function statementsFor(t: Template, logicalIdPrefix: string): Statement[] {
  return Object.entries(t.findResources('AWS::IAM::Policy'))
    .filter(([id]) => id.startsWith(logicalIdPrefix))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);
}
const actions = (s: Statement[]) => [...new Set(s.flatMap((x) => [x.Action].flat()))].sort();

describe('documents (T05c)', () => {
  const t = template();

  it('stores files in a private, encrypted, HTTPS-only bucket', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } })],
      },
    });
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('leaves bucket notifications to GuardDuty (no second writer)', () => {
    t.resourceCountIs('Custom::S3BucketNotifications', 0);
  });

  it('scans every upload under users/ with GuardDuty and tags the result', () => {
    t.hasResourceProperties('AWS::GuardDuty::MalwareProtectionPlan', {
      ProtectedResource: { S3Bucket: { ObjectPrefixes: ['users/'] } },
      Actions: { Tagging: { Status: 'ENABLED' } },
    });
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
          }),
        ],
      },
    });
  });

  it('routes only this bucket’s scan results to the worker queue, with a dead-letter queue', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.guardduty'],
        'detail-type': ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [Match.anyValue()] } },
      },
      Targets: [Match.objectLike({ DeadLetterConfig: { Arn: Match.anyValue() } })],
    });
    expect(DOCUMENT_MAX_RECEIVES).toBe(3);
    expect(WORKER_MAX_RECEIVES).toBe(DOCUMENT_MAX_RECEIVES);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-document-scans',
      VisibilityTimeout: 360,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
    });
  });

  it('never lets the API read an original upload that GuardDuty has not tagged clean', () => {
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:GetObject',
            Condition: {
              StringNotEquals: {
                's3:ExistingObjectTag/GuardDutyMalwareScanStatus': 'NO_THREATS_FOUND',
              },
            },
          }),
        ]),
      },
    });
  });

  it('gives the documents API and the worker only what they use, on user files only', () => {
    const api = statementsFor(t, 'DocumentsApiFn');
    expect(actions(api).filter((a) => a.startsWith('dynamodb:'))).toEqual([
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    const worker = statementsFor(t, 'DocumentsWorkerFn');
    expect(actions(worker).filter((a) => a.startsWith('dynamodb:'))).toEqual([
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
    ]);
    // S3: each role only on the prefixes it uses. The worker writes only derived files,
    // which GuardDuty does not scan, so each upload is scanned exactly once.
    const s3Scope = (statements: Statement[], action: string) =>
      statements
        .filter((x) => [x.Action].flat().includes(action))
        .map((x) => JSON.stringify(x.Resource).match(/\/(derived\/users|users)\/\*/)?.[1])
        .sort();
    expect(s3Scope(worker, 's3:GetObject*')).toEqual(['users']);
    expect(s3Scope(worker, 's3:PutObject')).toEqual(['derived/users']);
    expect(s3Scope(worker, 's3:DeleteObject*')).toEqual(['derived/users', 'users']);
    expect(s3Scope(api, 's3:PutObject')).toEqual(['users']);
    expect(s3Scope(api, 's3:GetObject*')).toEqual(['users']);
    expect(s3Scope(api, 's3:DeleteObject*')).toEqual(['derived/users', 'users']);
  });

  it('keeps prod files and pools, and deletes dev files with the stack', () => {
    t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
    t.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
    const prod = template('prod', 'jobdeputy-prod-bom');
    prod.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
    prod.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });
});
