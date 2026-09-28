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
  'AWS::KMS::Key',
  'AWS::SecretsManager::Secret',
];

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
