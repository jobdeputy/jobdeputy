# T03: AWS foundation, monorepo, and CI/CD

- **Status:** awaiting-alignment
- **Depends on:** T02
- **Branch / PR:** `t03-aws-foundation`

## Goal

The AWS foundation and pipeline for the stack in [0003](../decisions/0003-serverless-aws-stack.md) are in place, following the Region cell model in [0004](../decisions/0004-regional-cells-and-data-residency.md). A contributor can run the unit tests locally, deploy a personal dev stack with one command, and CI tests every PR and deploys `main` to `dev-us`. Everything costs close to $0 until launch.

## Scope

- In: AWS Organizations and accounts, human access, the Region guardrail, budgets and cost alerts, the pnpm monorepo and tooling, the CDK app with Region cells, CDK bootstrap for `dev-us`, the GitHub OIDC deploy role, CI and deploy workflows, and the cloud-session setup script.
- Out: application resources such as tables, queues, and Lambdas (T04 and later), prod deployment (at launch), and domain and DNS wiring (at launch).

## Inputs from the maintainer (2026-09-27)

- Management account: the existing AWS account, used for nothing else. OK to enable AWS Organizations and create member accounts.
- Launch Regions: US (`us-east-1`), India (`ap-south-1`, Mumbai), UK (`eu-west-2`, London). Dev runs only in `us-east-1`. Prod runs in all three and is created at launch.
- User data never moves between Regions, from day 1. A user's Region is chosen at signup and fixed.
- Budget: a $10 per month alert. Aim for about $0 until launch.
- Domain `jobdeputy.com` is registered with Amazon Registrar and has a Route 53 hosted zone. It is used at launch.

## Research

### 1. Accounts

| Option | Assessment |
|---|---|
| Run everything in the root account | Simplest, but the root user is exposed, dev and prod are mixed, and the Region guardrail (a service control policy) cannot apply to the management account. |
| **AWS Organizations with separate dev and prod accounts (recommended)** | Free. The management account only holds billing, Organizations, and the domain. Workloads run in `jobdeputy-dev` and `jobdeputy-prod`, each with separate cost, access, and guardrails. Each member account needs its own unique email address. Gmail plus-addressing works (for example `yourname+jobdeputy-dev@…`). |

Structure:

```text
Management account (billing, Organizations, IAM Identity Center, Route 53 domain)
└── OU: Workloads
    ├── jobdeputy-dev   (us-east-1 only)
    └── jobdeputy-prod  (us-east-1, ap-south-1, eu-west-2; used from launch)
```

### 2. Human access

- **Root user:** MFA on, no access keys, and used only for tasks that require root.
- **IAM Identity Center** (free): one admin user with MFA, and permission sets for AdministratorAccess (dev) and a scoped admin (prod). Local access uses `aws configure sso` profiles, so there are no long-lived keys on laptops.
- Identity Center stores only workforce identities (maintainers), not customer data, so its home Region (`us-east-1`) does not affect data residency.
- Your local AWS CLI default profile currently points to an unrelated account. JobDeputy commands always use explicit named profiles.

### 3. Region guardrail (service control policies)

- **Deny all actions outside allowed Regions.** Dev allows only `us-east-1`. Prod allows `us-east-1`, `ap-south-1`, and `eu-west-2`. Global services (IAM, STS, Organizations, Route 53, CloudFront, ACM for CloudFront, Budgets, Cost Explorer, Support) are exempt.
- **Deny leaving the organization**, and deny using the root user in member accounts.
- Even a coding mistake cannot create resources or copy data to another Region.

### 4. Cost control

| Control | Detail | Cost |
|---|---|---|
| Budget | $10 per month across the organization. Email alerts at 50%, 80%, and 100% of actual spend, and at 100% of forecast spend. | Free (the first 2 budgets are free) |
| Cost Anomaly Detection | Daily email for unusual spend | Free |
| Hard stop (optional) | A budget action attaches a "deny create" policy to `jobdeputy-dev` at 100% | Free |
| Serverless-only services | Lambda, DynamoDB on-demand, SQS, API Gateway, S3, and Cognito all cost about $0 when idle and fall within the free tier | ~$0 |
| Avoided until launch | NAT gateways, WAF, customer-managed KMS keys, Secrets Manager (SSM Parameter Store is used instead), GuardDuty, AWS Config, VPCs | — |
| Log retention | 14 days by default for all log groups | Pennies |
| CDK bootstrap | One S3 bucket and one empty ECR repository per account and Region | ~$0 |
| Route 53 hosted zone | Already exists | $0.50 per month |

Audit logging: CloudTrail event history (90 days, per Region, free) is enough until launch. An organization-wide trail stores logs in one central bucket, which would move log data across Regions. At launch, trails are designed per Region, following decision 0004.

### 5. Monorepo and tooling

- **pnpm workspaces** with `apps/*`, `packages/*`, and `infra/`.
- **TypeScript**, strict mode, one shared base `tsconfig`. TypeScript 7 (the native compiler) is current, but the version is pinned to whatever CDK and the tooling support, which is confirmed during implementation.
- **Biome** for linting and formatting (recommended): one fast tool with no plugin setup. The alternative is ESLint with Prettier: more plugins, but two tools and more configuration.
- **Vitest** for tests.
- Node 22 LTS, pinned in `.nvmrc` and `package.json` `engines`.

### 6. CDK app with Region cells

```text
infra/
  bin/app.ts            creates one stack set per (stage, cell)
  config/cells.ts       us → us-east-1, in → ap-south-1, uk → eu-west-2
  config/stages.ts      dev → [us], prod → [us, in, uk], personal → [us]
  lib/cell-stack.ts     everything a cell needs (empty placeholder in T03; T04 adds resources)
  test/                 CDK assertion tests
```

- Stack names look like `jobdeputy-dev-us`, `jobdeputy-prod-in`, and `jobdeputy-dev-nava-us` (personal).
- **Account IDs stay out of the public repo.** They come from environment variables: GitHub Environment variables in CI, and the developer's profile locally.
- Tests that enforce 0004: every stack's Region is in its stage's allow-list; there are no cross-Region references; and there are no global tables, replication, or NAT gateways.
- CI **synthesizes all prod cells** on every PR, so they stay valid without being deployed.

### 7. CI/CD (GitHub Actions and OIDC)

- **PR workflow:** install, lint, typecheck, unit tests, and `cdk synth` for all cells. No AWS credentials, so this is safe for fork PRs.
- **Deploy workflow:** on push to `main`, deploy `dev-us` using the GitHub OIDC role in `jobdeputy-dev`.
- The role trusts only `repo:jobdeputy/jobdeputy`, on `main`, in the `dev` environment. It can only assume the CDK bootstrap deploy roles.
- **Prod:** a manually triggered workflow with GitHub Environment approval. It stays unused until launch.
- Existing checks (Markdown lint, Secret scan) stay. The new checks are added to the required checks on `main`.

### 8. Setup automation

- One-time AWS setup (Organizations, accounts, service control policies, budgets, Identity Center, OIDC role) is written as a **reviewed runbook with scripts** in `infra/bootstrap/`. It rarely changes and needs management-account access. The OIDC role and the per-account pieces can be CDK stacks.
- Root-only and console-only steps are done by the maintainer: enabling MFA, enabling Identity Center, and accepting the email for each new account.

### 9. Domain (for launch, noted now)

- `jobdeputy.com` stays in the management account. At launch, subdomains are delegated to the prod account (for example `us.jobdeputy.com`, `in.jobdeputy.com`, `uk.jobdeputy.com`, and the app landing page). Dev can use `dev.jobdeputy.com` later if needed. Until then, AWS-generated URLs are enough.
- Check now: auto-renew and transfer lock are on for the domain.

## Open questions for alignment

1. Accounts: Organizations with `jobdeputy-dev` and `jobdeputy-prod` under a Workloads OU?
2. Region cells and the data-residency rules in [0004](../decisions/0004-regional-cells-and-data-residency.md)?
3. Budget: $10 organization-wide with alerts. Should the dev account get the optional hard stop?
4. Tooling: Biome, or ESLint with Prettier?
5. Setup split: the maintainer does the root and console steps; the scripts and CDK handle the rest?

## Decision

Pending alignment.

## Done when

- [ ] Organizations, the dev and prod accounts, Identity Center access, and service control policies are in place and verified. A test resource in a disallowed Region is denied.
- [ ] Budget and anomaly alerts are active and a test notification is received.
- [ ] Monorepo skeleton with lint, typecheck, and unit tests running locally and in CI.
- [ ] CDK app with cells; `cdk synth` succeeds for all dev and prod cells; residency assertion tests pass.
- [ ] `dev-us` is bootstrapped and deployed from `main` through GitHub OIDC, with no stored keys.
- [ ] One command deploys a personal dev stack, and one command runs the unit tests.
- [ ] Setup is documented in `README.md`, `CLAUDE.md`, and `CONTRIBUTING.md`.
- [ ] A Claude Code cloud environment setup script installs the same tools, so cloud sessions can run the tests. It is documented in `CONTRIBUTING.md`.
