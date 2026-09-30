import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/key-check-worker.js';
import { buildApp } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';
import { aiKeysKeyParameter } from '../lib/keys-stack.js';

// T08b2 (decision 0009): only the key API encrypts, only the key-check worker decrypts, each
// only with the user and provider as encryption context; the test provider exists only in dev.

const cell = (stage: 'dev' | 'prod', owner?: string) => {
  const name = owner ? `jobdeputy-${stage}-${owner}-iad` : `jobdeputy-${stage}-iad`;
  return Template.fromStack(
    buildApp({ stage, env: {}, ...(owner ? { owner } : {}) }).node.findChild(name) as never,
  );
};
const dev = cell('dev');

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
/** Every IAM statement in the template, with the logical ID of its policy. */
function statements(t: Template): [string, Statement][] {
  return Object.entries(t.findResources('AWS::IAM::Policy')).flatMap(([id, p]) =>
    (p.Properties.PolicyDocument.Statement as Statement[]).map(
      (s) => [id, s] as [string, Statement],
    ),
  );
}

describe('ai-keys (T08b2)', () => {
  it('builds the ai-keys table keyed by userId and provider, with a stream', () => {
    dev.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-ai-keys',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'provider', KeyType: 'RANGE' },
      ],
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
    });
  });

  it('gives KMS to exactly two functions: encrypt to the key API, decrypt to the key-check worker', () => {
    for (const t of [dev, cell('prod'), cell('dev', 'pr42')]) {
      const kms = statements(t).filter(([, s]) =>
        [s.Action].flat().some((a) => a.startsWith('kms:')),
      );
      expect(kms.map(([id, s]) => [id.replace(/[0-9A-F]{8}$/, ''), s.Action])).toEqual([
        ['AiKeysAiApiFnServiceRoleDefaultPolicy', 'kms:Encrypt'],
        ['AiKeysKeyCheckWorkerFnServiceRoleDefaultPolicy', 'kms:Decrypt'],
      ]);
      for (const [, s] of kms) {
        expect(s.Condition).toEqual({
          'ForAllValues:StringEquals': { 'kms:EncryptionContextKeys': ['userId', 'provider'] },
          Null: {
            'kms:EncryptionContext:userId': 'false',
            'kms:EncryptionContext:provider': 'false',
          },
        });
      }
    }
  });

  it('reads the key ARN from the shared SSM parameter, never creating a key in a cell stack', () => {
    for (const t of [dev, cell('dev', 'pr42')]) {
      expect(Object.keys(t.findResources('AWS::KMS::Key'))).toEqual([]);
      const parameters = Object.values(t.toJSON().Parameters ?? {}) as { Default?: string }[];
      expect(parameters.map((p) => p.Default)).toContain(aiKeysKeyParameter('dev', 'iad'));
    }
  });

  it('starts a key check on inserts and updates that set checking, sending only the keys', () => {
    const pipes = Object.values(dev.findResources('AWS::Pipes::Pipe')).filter((p) =>
      JSON.stringify(p).includes('provider'),
    );
    expect(pipes).toHaveLength(1);
    const params = pipes[0]?.Properties;
    const pattern = JSON.parse(params.SourceParameters.FilterCriteria.Filters[0].Pattern);
    expect(pattern).toEqual({
      eventName: ['INSERT', 'MODIFY'],
      dynamodb: { NewImage: { status: { S: ['checking'] } } },
    });
    expect(params.TargetParameters.InputTemplate).toBe(
      '{"userId": "<$.dynamodb.Keys.userId.S>", "provider": "<$.dynamodb.Keys.provider.S>"}',
    );
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
  });

  it('allows the test provider in dev stacks only', () => {
    const flags = (t: Template) =>
      Object.values(t.findResources('AWS::Lambda::Function'))
        .map((f) => f.Properties.Environment?.Variables?.ALLOW_TEST_AI_PROVIDER)
        .filter((v) => v !== undefined);
    expect(new Set(flags(dev))).toEqual(new Set(['true']));
    expect(new Set(flags(cell('prod')))).toEqual(new Set(['false']));
    expect(flags(cell('prod')).length).toBe(3); // AI API, key-check worker, crawls API
  });
});
