import type { App } from 'aws-cdk-lib';
import { ALL_REGIONS } from '../config/cells.js';

/** Resource types that cost money while idle or break Region isolation. */
export const FORBIDDEN_RESOURCE_TYPES: readonly string[] = [
  // Region isolation (0004)
  'AWS::DynamoDB::GlobalTable',
  // Pre-launch cost (0005)
  'AWS::EC2::Instance',
  'AWS::EC2::NatGateway',
  'AWS::EC2::EIP',
  'AWS::EC2::VPCEndpoint',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::RDS::DBInstance',
  'AWS::RDS::DBCluster',
  'AWS::ElastiCache::CacheCluster',
  'AWS::OpenSearchService::Domain',
  'AWS::SecretsManager::Secret',
];

/**
 * Decisions 0009 and 0010: one KMS key per cell ($1 a month), only in the cell's keys stack
 * (named `…-keys`), and kept when that stack is deleted.
 */
export const KEYS_STACK_SUFFIX = '-keys';

/** Decision 0005: logs are kept 14 days before launch. */
export const MAX_LOG_RETENTION_DAYS = 14;

export interface GuardViolation {
  readonly stack: string;
  readonly message: string;
}

interface Template {
  Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
}

/** Returns every guardrail violation across all stacks in the app. */
export function checkGuards(app: App): GuardViolation[] {
  const assembly = app.synth();
  const violations: GuardViolation[] = [];

  for (const artifact of assembly.stacks) {
    const stack = artifact.stackName;
    const region = artifact.environment.region;
    const template = artifact.template as Template;
    const text = JSON.stringify(template);

    if (!ALL_REGIONS.includes(region)) {
      violations.push({ stack, message: `Region ${region} is not a JobDeputy cell Region.` });
    }

    for (const other of ALL_REGIONS.filter((r) => r !== region)) {
      if (text.includes(other)) {
        violations.push({ stack, message: `Template references another cell Region: ${other}.` });
      }
    }

    const kmsKeys = Object.entries(template.Resources ?? {}).filter(
      ([, r]) => r.Type === 'AWS::KMS::Key',
    );
    if (kmsKeys.length > 0 && !stack.endsWith(KEYS_STACK_SUFFIX)) {
      violations.push({ stack, message: 'KMS keys are only allowed in a cell keys stack.' });
    }
    if (kmsKeys.length > 1) {
      violations.push({ stack, message: 'A keys stack has at most one KMS key.' });
    }
    for (const [logicalId, key] of kmsKeys) {
      const retained = (key as { DeletionPolicy?: string }).DeletionPolicy === 'Retain';
      if (!retained) {
        violations.push({ stack, message: `${logicalId}: a KMS key must be kept on delete.` });
      }
    }

    for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
      if (FORBIDDEN_RESOURCE_TYPES.includes(resource.Type)) {
        violations.push({ stack, message: `${logicalId}: ${resource.Type} is not allowed.` });
      }
      const props = resource.Properties ?? {};
      if (resource.Type === 'AWS::S3::Bucket' && 'ReplicationConfiguration' in props) {
        violations.push({ stack, message: `${logicalId}: S3 replication is not allowed.` });
      }
      if (resource.Type === 'AWS::DynamoDB::Table' && props.BillingMode !== 'PAY_PER_REQUEST') {
        violations.push({ stack, message: `${logicalId}: DynamoDB must be on-demand.` });
      }
      if (resource.Type === 'AWS::Lambda::Function' && 'ReservedConcurrentExecutions' in props) {
        // Accounts start with a 10-execution limit, all of which must stay unreserved.
        // Cap SQS workers with the event source's maximum concurrency instead.
        violations.push({
          stack,
          message: `${logicalId}: reserved concurrency is not allowed; use SQS maximum concurrency.`,
        });
      }
      if (
        resource.Type === 'AWS::Logs::LogGroup' &&
        !(
          typeof props.RetentionInDays === 'number' &&
          props.RetentionInDays <= MAX_LOG_RETENTION_DAYS
        )
      ) {
        violations.push({
          stack,
          message: `${logicalId}: log retention must be set to at most ${MAX_LOG_RETENTION_DAYS} days.`,
        });
      }
      if (resource.Type === 'AWS::Cognito::UserPool') {
        // 0005: Plus has no free tier, and SMS is paid per message.
        if (props.UserPoolTier === 'PLUS') {
          violations.push({
            stack,
            message: `${logicalId}: the Cognito Plus plan is not allowed.`,
          });
        }
        if ('SmsConfiguration' in props) {
          violations.push({ stack, message: `${logicalId}: Cognito SMS is not allowed.` });
        }
      }
      if (resource.Type === 'AWS::Lambda::Alias' && 'ProvisionedConcurrencyConfig' in props) {
        violations.push({
          stack,
          message: `${logicalId}: provisioned concurrency is not allowed.`,
        });
      }
    }
  }
  return violations;
}
