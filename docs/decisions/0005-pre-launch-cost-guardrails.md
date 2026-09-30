# 0005: Pre-launch cost guardrails ($20 hard stop)

- **Status:** Accepted; amended by [0009](0009-llm-architecture-and-own-keys.md) (a KMS key per cell; Bedrock calls to one pinned model)
- **Date:** 2026-09-27
- **Task:** t03

## Context

Until launch there are no paying users, so spending should be close to $0 with no surprises. AWS has no built-in spending cap. Billing data also arrives with a delay of several hours, so a budget alone reacts late. This decision is revisited before launch.

## Decision

Four layers, from preventive to reactive:

1. **Prevent (service control policies on the Workloads accounts).** Deny services and actions that are expensive or have fixed hourly costs until launch: EC2 instances, NAT gateways, Elastic IPs, load balancers, RDS and Aurora, ElastiCache, OpenSearch, Redshift, EKS, MSK, SageMaker, Bedrock, provisioned concurrency for Lambda, DynamoDB provisioned capacity, Marketplace subscriptions, reserved instance and Savings Plans purchases, and domain registration. Allowed Regions are enforced by [0004](0004-regional-cells-and-data-residency.md). Exceptions need a new decision.
2. **Limit (in the CDK code).**
   - API Gateway throttling on dev: low rate and burst limits.
   - Worker Lambda reserved concurrency: small, for example 2.
   - Lambda timeouts and memory sized per function.
   - Log retention 14 days, with no debug logging by default.
   - S3 lifecycle rules for temporary objects.
   - Every non-personal endpoint requires auth, to prevent abuse that runs up costs.
3. **Watch (budgets and alerts, organization-wide).**
   - A $20 monthly budget, with email alerts at **$5, $10, and $15 actual** and **$20 forecast**.
   - Cost Anomaly Detection, which sends a daily email for unusual spend.
   - AWS free-tier usage alerts.
4. **Block (automatic, at $20 actual).** A budget action attaches a **deny-all service control policy** to the Workloads OU. This stops deploys and also stops running Lambdas from calling other AWS services, which halts usage charges. Only billing, read-only, and the maintainer's break-glass role stay usable. It is lifted manually after review.

## Honest limits

- AWS updates budgets a few times a day, so actual spend can pass $20 before the block applies. The earlier alerts and the preventive layer are what keep us far below it.
- Service control policies do not apply to the management account. It holds no workloads; only the Route 53 hosted zone ($0.50 per month) and the domain renewal (yearly, due 2027-09-27, which counts toward that month) are billed there.
- Storage that already exists (S3, DynamoDB, logs) keeps billing at a very small rate while blocked.

## Why

The maintainer requires strict spend control with no surprises before launch. Prevention costs nothing and stops most accidents. The hard stop is the backstop.

## Consequences

- Some AWS services cannot be used until the policy is changed. Any task needing one must propose an exception.
- Every PR states whether it adds anything that costs money when idle.
- Before launch, the limits are raised for production and this decision is replaced.
