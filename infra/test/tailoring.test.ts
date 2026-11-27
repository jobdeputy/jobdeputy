import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/tailoring-worker.js';
import { buildApp } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';

// #51 (decision 0015): the tailoring worker starts only for generated versions inserted
// queued, and the worker and the API may do only what tailoring needs.

const template = Template.fromStack(
  buildApp({ stage: 'dev', env: {} }).node.findChild('jobdeputy-dev-iad') as never,
);

type Statement = { Action: string | string[]; Resource: unknown };
const statementsOf = (prefix: string): Statement[] =>
  Object.entries(template.findResources('AWS::IAM::Policy'))
    .filter(([id]) => id.startsWith(prefix))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement as Statement[]);
const worker = () => statementsOf('TailoringTailoringWorkerFnServiceRoleDefaultPolicy');
const api = () => statementsOf('TailoringTailoringApiFnServiceRoleDefaultPolicy');
const actions = (s: Statement) => [s.Action].flat();
const on = (statements: Statement[], table: string) =>
  statements
    .filter((s) => JSON.stringify(s.Resource).includes(table))
    .flatMap(actions)
    .filter((a) => a.startsWith('dynamodb:'))
    .sort();
const s3 = (statements: Statement[]) =>
  statements
    .filter((s) => actions(s).some((a) => a.startsWith('s3:')))
    .map((s) => ({ actions: actions(s), resources: JSON.stringify(s.Resource) }));

describe('tailoring (#51)', () => {
  it('a Pipe on the documents stream passes only generated versions inserted queued, IDs only', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-documents',
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
    });
    const pipes = Object.values(template.findResources('AWS::Pipes::Pipe')).filter((p) =>
      JSON.stringify(p.Properties.Source).includes('DocumentsTable'),
    );
    expect(pipes).toHaveLength(1);
    expect(
      JSON.parse(pipes[0]?.Properties.SourceParameters.FilterCriteria.Filters[0].Pattern),
    ).toEqual({
      eventName: ['INSERT'],
      dynamodb: { NewImage: { status: { S: ['queued'] }, origin: { S: ['generated'] } } },
    });
    expect(pipes[0]?.Properties.TargetParameters.InputTemplate).toBe(
      '{"userId": "<$.dynamodb.Keys.userId.S>", "documentId": "<$.dynamodb.Keys.documentId.S>"}',
    );
  });

  it('its queue retries as often as the worker expects', () => {
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-tailoring',
      RedrivePolicy: { maxReceiveCount: MAX_RECEIVES },
    });
  });

  it('the worker calls only the platform model, in this Region', () => {
    const bedrock = worker().filter((s) => actions(s).some((a) => a.startsWith('bedrock:')));
    expect(bedrock.map((s) => s.Action)).toEqual(['bedrock:InvokeModel']);
    expect(JSON.stringify(bedrock[0]?.Resource)).toMatch(
      /foundation-model\/mistral\.ministral-3-14b-instruct/,
    );
  });

  it('the worker touches only résumé text, structured copies, and version and letter files in S3', () => {
    const files = s3(worker());
    expect(files.map((f) => f.actions)).toEqual([
      ['s3:GetObject'],
      ['s3:PutObject'],
      ['s3:DeleteObject'],
    ]);
    const [read, write, remove] = files.map((f) => f.resources);
    // PR D: a letter reads its company's tailored résumé (resume.json), never another letter.
    expect(read).toMatch(/text\.txt.*structured-\*\.json.*resume\.json/);
    expect(read).not.toMatch(/letter|resume\.pdf|resume\.docx/);
    expect(write).toMatch(/structured-\*\.json.*resume\.json.*resume\.pdf.*resume\.docx/);
    expect(write).toMatch(/letter\.json.*letter\.pdf.*letter\.docx/);
    expect(remove).toMatch(/letter\.json.*letter\.pdf.*letter\.docx/);
    // Deletes structured copies and version files only: never an upload or its text.
    expect(remove).toMatch(/structured-\*\.json.*resume\.json/);
    expect(remove).not.toMatch(/text\.txt|original/);
    for (const f of files) expect(f.resources).not.toMatch(/users\/\*\/documents\/\*\/original/);
  });

  it('the worker never deletes or scans whole tables, and writes jobs only by update', () => {
    expect(on(worker(), 'JobsTable')).toEqual(['dynamodb:BatchGetItem', 'dynamodb:UpdateItem']);
    expect(on(worker(), 'DocumentsTable')).toEqual([
      'dynamodb:BatchWriteItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ]);
    const all = worker().flatMap(actions);
    expect(all).not.toContain('dynamodb:Scan');
    expect(all).not.toContain('dynamodb:DeleteItem');
  });

  it('the API reads version files only (for preview and signed downloads), never decrypts a key', () => {
    expect(s3(api())).toEqual([
      {
        actions: ['s3:GetObject'],
        resources: expect.stringMatching(
          /resume\.json.*resume\.pdf.*resume\.docx.*letter\.json.*letter\.pdf.*letter\.docx/,
        ),
      },
    ]);
    expect(
      api()
        .flatMap(actions)
        .some((a) => a.startsWith('kms:')),
    ).toBe(false);
    expect(on(api(), 'DocumentsTable')).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
    ]);
    expect(on(api(), 'JobsTable')).toEqual(['dynamodb:BatchGetItem']);
  });
});
