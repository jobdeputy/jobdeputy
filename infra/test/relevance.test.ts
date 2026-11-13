import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/relevance-worker.js';
import { buildApp } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';

// T08d: the scoring worker starts only for succeeded AI crawls with candidates, never from
// its own writes, and may do only what scoring needs.

const template = Template.fromStack(
  buildApp({ stage: 'dev', env: {} }).node.findChild('jobdeputy-dev-iad') as never,
);

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
const workerStatements = (): Statement[] =>
  Object.entries(template.findResources('AWS::IAM::Policy'))
    .filter(([id]) => id.startsWith('RelevanceRelevanceWorkerFnServiceRoleDefaultPolicy'))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);
const actions = (s: Statement) => [s.Action].flat();

describe('relevance (T08d)', () => {
  it('a second Pipe on the crawls stream passes only ended AI crawls with candidates and no run', () => {
    const pipes = Object.values(template.findResources('AWS::Pipes::Pipe')).filter((p) =>
      JSON.stringify(p.Properties.Target).includes('Relevance'),
    );
    expect(pipes).toHaveLength(1);
    const params = pipes[0]?.Properties.SourceParameters;
    expect(JSON.stringify(pipes[0]?.Properties.Source)).toContain('CrawlsTable');
    expect(JSON.parse(params.FilterCriteria.Filters[0].Pattern)).toEqual({
      eventName: ['MODIFY'],
      dynamodb: {
        NewImage: {
          status: { S: ['succeeded'] },
          aiSource: { S: [{ 'anything-but': ['none'] }] },
          stats: { M: { jobsRelevant: { N: [{ 'anything-but': ['0'] }] } } },
          relevance: [{ exists: false }],
        },
      },
    });
    // IDs only in the message.
    expect(pipes[0]?.Properties.TargetParameters.InputTemplate).toBe(
      '{"userId": "<$.dynamodb.Keys.userId.S>", "crawlId": "<$.dynamodb.Keys.crawlId.S>"}',
    );
  });

  it('its queue retries as often as the worker expects', () => {
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-relevance',
      RedrivePolicy: { maxReceiveCount: MAX_RECEIVES },
    });
  });

  it('calls only the platform model, in this Region', () => {
    const bedrock = workerStatements().filter((s) =>
      actions(s).some((a) => a.startsWith('bedrock:')),
    );
    expect(bedrock).toHaveLength(1);
    expect(bedrock[0]?.Action).toBe('bedrock:InvokeModel');
    expect(JSON.stringify(bedrock[0]?.Resource)).toMatch(
      /arn:aws:bedrock:.*::foundation-model\/mistral\.ministral-3-14b-instruct/,
    );
  });

  it('reads only extracted résumé text from S3, and writes nothing there', () => {
    const s3 = workerStatements().filter((s) => actions(s).some((a) => a.startsWith('s3:')));
    expect(s3.flatMap(actions)).toEqual(['s3:GetObject']);
    expect(JSON.stringify(s3[0]?.Resource)).toContain('/derived/users/*/documents/*/text.txt');
  });

  it('never deletes, scans, or writes whole items in the jobs or crawls tables', () => {
    const dynamo = workerStatements()
      .flatMap(actions)
      .filter((a) => a.startsWith('dynamodb:'));
    for (const forbidden of ['dynamodb:DeleteItem', 'dynamodb:Scan', 'dynamodb:BatchWriteItem']) {
      expect(dynamo).not.toContain(forbidden);
    }
    const jobs = workerStatements().find((s) => JSON.stringify(s.Resource).includes('JobsTable'));
    expect(jobs && actions(jobs)).toEqual(['dynamodb:BatchGetItem', 'dynamodb:UpdateItem']);
  });
});
