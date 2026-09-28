import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVES as WORKER_MAX_RECEIVES } from '../../apps/worker/src/ping-worker.js';
import { buildApp, parseAlertEmails } from '../lib/build-app.js';
import { MAX_RECEIVES } from '../lib/cell-stack.js';
import { checkGuards } from '../lib/guards.js';

function devTemplate(env: Record<string, string> = {}): Template {
  const app = buildApp({ stage: 'dev', env });
  const stack = app.node.findChild('jobdeputy-dev-iad');
  return Template.fromStack(stack as never);
}

describe('async pipeline (T04)', () => {
  const t = devTemplate();

  it('streams only new queued items, sending IDs only', () => {
    t.hasResourceProperties('AWS::Pipes::Pipe', {
      SourceParameters: {
        DynamoDBStreamParameters: {
          StartingPosition: 'TRIM_HORIZON',
          BatchSize: 1,
          MaximumRetryAttempts: 2,
          DeadLetterConfig: { Arn: Match.anyValue() },
        },
        FilterCriteria: {
          Filters: [
            {
              Pattern: JSON.stringify({
                eventName: ['INSERT'],
                dynamodb: { NewImage: { status: { S: ['queued'] } } },
              }),
            },
          ],
        },
      },
      TargetParameters: { InputTemplate: '{"id": "<$.dynamodb.Keys.id.S>"}' },
    });
  });

  it('retries 3 times, then dead-letters, and the worker agrees on the count', () => {
    expect(MAX_RECEIVES).toBe(3);
    expect(WORKER_MAX_RECEIVES).toBe(MAX_RECEIVES);
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-ping-jobs',
      VisibilityTimeout: 180,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
      SqsManagedSseEnabled: true,
    });
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'jobdeputy-dev-iad-ping-jobs-dlq',
      MessageRetentionPeriod: 14 * 86400,
    });
  });

  it('caps the worker with SQS maximum concurrency and partial batch responses', () => {
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('alarms on a non-empty dead-letter queue', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 1,
      AlarmActions: [Match.anyValue()],
    });
  });

  it('subscribes alert emails only when given through the environment', () => {
    t.resourceCountIs('AWS::SNS::Subscription', 0);
    const withEmails = devTemplate({ JD_ALERT_EMAIL: 'a@example.com, b@example.com' });
    withEmails.resourceCountIs('AWS::SNS::Subscription', 2);
    withEmails.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'b@example.com',
    });
  });

  it('rejects invalid or too many alert emails', () => {
    expect(parseAlertEmails(undefined)).toEqual([]);
    expect(parseAlertEmails('a@example.com,a@example.com')).toEqual(['a@example.com']);
    expect(() => parseAlertEmails('not-an-email')).toThrow(/invalid/);
    const six = Array.from({ length: 6 }, (_, i) => `u${i}@example.com`).join(',');
    expect(() => parseAlertEmails(six)).toThrow(/at most 5/);
  });

  it('uses on-demand tables with expiry, and destroys them only outside prod', () => {
    t.hasResource('AWS::DynamoDB::Table', {
      Properties: Match.objectLike({
        TableName: 'jobdeputy-dev-iad-ping-jobs',
        StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      }),
      DeletionPolicy: 'Delete',
    });
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'jobdeputy-dev-iad-idempotency',
      TimeToLiveSpecification: { AttributeName: 'expiration', Enabled: true },
    });
    const prod = buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-bom');
    Template.fromStack(prod as never).hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
    });
  });
});

describe('HTTP API (T04)', () => {
  const t = devTemplate();

  it('requires IAM auth on every route', () => {
    const routes = t.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(2);
    for (const route of Object.values(routes)) {
      expect(route.Properties.AuthorizationType).toBe('AWS_IAM');
    }
  });

  it('throttles the dev stage', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('runs Node 22 on ARM64', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });
});

describe('new guards', () => {
  it('reject reserved concurrency and unbounded log retention', () => {
    const app = new App();
    const stack = new Stack(app, 'probe', { env: { region: 'us-east-1' } });
    new CfnFunction(stack, 'F', {
      code: { zipFile: 'x' },
      role: 'arn:aws:iam::111111111111:role/r',
      reservedConcurrentExecutions: 1,
    });
    new LogGroup(stack, 'L');
    const messages = checkGuards(app).map((v) => v.message);
    expect(messages.some((m) => m.includes('reserved concurrency'))).toBe(true);
    expect(messages.some((m) => m.includes('log retention'))).toBe(true);
  });
});
