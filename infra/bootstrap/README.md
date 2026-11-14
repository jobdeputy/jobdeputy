# AWS bootstrap runbook

One-time organization setup for [T03](https://github.com/jobdeputy/jobdeputy-archive/blob/main/docs/tasks/t03-infrastructure-foundation.md), following decisions [0004](../../docs/decisions/0004-regional-cells-and-data-residency.md) and [0005](../../docs/decisions/0005-pre-launch-cost-guardrails.md). Run the scripts from the management account with an IAM Identity Center admin profile. Account IDs and emails are passed as environment variables and never committed.

## Manual prerequisites (maintainer, console)

1. Root user MFA enabled, and no root access keys.
2. AWS Organizations created with all features.
3. IAM user and role access to Billing information activated.
4. Cost Explorer opened once.
5. IAM Identity Center enabled as a single-Region instance in `us-east-1` with an AWS owned key. An admin user with MFA, the `AdministratorAccess` permission set assigned to the management account, and `aws configure sso` run with profile `jobdeputy-mgmt`.

## Scripts (safe to re-run)

| Script | What it does |
|---|---|
| `01-organization.sh` | Creates the `Workloads/Dev` and `Workloads/Prod` OUs, enables centralized root access (member accounts get no root credentials), creates `jobdeputy-dev-iad`, and assigns the admin user to it. |
| `02-guardrails.sh` | Creates the service control policies. Attaches a Region lock to each workload account and the cost guardrails to `Workloads`. Creates the `jd-budget-stop` policy without attaching it. |
| `03-budget.sh` | Creates the $20 gross-cost budget with alerts at $5, $10, and $15 actual and $20 forecast. Creates the budget action that attaches `jd-budget-stop` to `Workloads` at $20 actual, and a daily anomaly email for impact of $1 or more. |
| `04-access-analyzer.sh` | Creates an organization-wide IAM Access Analyzer (free) that flags any resource shared publicly or outside the organization. `us-east-1` now; pass `ap-south-1 eu-west-2` at launch. |
| `05-delegate-web-zone.sh` | Decision 0011: adds the NS record in `jobdeputy.com` that delegates a stage's web zone (default `dev.jobdeputy.com`) to the zone in its workload account. Run once after the first deploy of `jobdeputy-dev-web-dns`. Uses `WORKLOAD_PROFILE` (default `jobdeputy-dev-iad`) and `MGMT_PROFILE` (default `jobdeputy-mgmt`). |

```sh
export AWS_PROFILE=jobdeputy-mgmt
DEV_IAD_EMAIL=... ADMIN_USERNAME=... ./01-organization.sh
./02-guardrails.sh
ALERT_EMAIL=... ./03-budget.sh
./04-access-analyzer.sh
```

Prod accounts (`jobdeputy-prod-iad`, `-bom`, `-lhr`) are created at launch by extending `01-organization.sh`. `02-guardrails.sh` already knows their Regions.

## Setting up a stage (dev now, prod at launch)

The same scripts serve every stage and Region. They read the stage's cells, Regions, account variables, and web address from the CDK config (`config/stages.ts`, `config/cells.ts`, `config/web.ts`) through `stage-info.ts`, so a new stage or Region needs **config changes, not new scripts**.

**AWS CLI profiles:** one per workload account, named `jobdeputy-<stage>-<cell>` (for example `jobdeputy-dev-iad`, `jobdeputy-prod-bom`), plus `jobdeputy-mgmt`. Sign in to each first with `aws sso login`.

| Script | What it does |
|---|---|
| `05-delegate-web-zone.sh [domain]` | Decision 0011: adds the NS record in `jobdeputy.com` (management account) that delegates a stage's web zone to the zone in its workload account. `07` runs it for you. |
| `06-stage-ci.sh <stage>` | Connects the stage to GitHub Actions. Deploys `jobdeputy-cicd-<stage>-iad` (the OIDC deploy role, plus the PR role for dev), then creates the GitHub environment `<stage>` (deploys from `main` only) with `AWS_DEPLOY_ROLE_ARN`, `JD_ALERT_EMAIL`, and `JD_ACCOUNT_<STAGE>_<CELL>` for every cell. For dev it also fills `pr`. Needs `ALERT_EMAILS=a@x.com,b@y.com`. |
| `07-stage-web.sh <stage>` | Gives the stage its web address: deploys `jobdeputy-<stage>-web-dns` and delegates it (`05`). |
| `stage-info.ts <stage>` | Prints the stage's cells, Regions, account variables, profiles, and web domain as JSON for the scripts above. |

All of them are safe to re-run.

```sh
cd infra
ALERT_EMAILS=you@example.com,teammate@example.com ./bootstrap/06-stage-ci.sh dev
./bootstrap/07-stage-web.sh dev        # once, before the first deploy that includes the web stack
```

**When to re-run:**

- `06` after the repository is re-created (a new repo ID in `config/github.ts`), or when a role, account, or alert list changes.
- `07` only if the stage's zone is re-created. The zone is kept on delete, so this shouldn't happen.

**Prod at launch:**

1. Create the accounts (`01`).
2. Add the profiles.
3. Add prod's address to `WEB_SITES` in `config/web.ts`.
4. Run `06-stage-ci.sh prod`, then `07-stage-web.sh prod`.

How CI deploys into prod's other cell accounts (`bom`, `lhr`) is decided at launch. Today the CI/CD stack lives only in each stage's `iad` account.

## Lifting the budget stop

After reviewing the spend, detach `jd-budget-stop` from `Workloads` (Organizations → Policies) and reset the budget action. Human admins signed in through IAM Identity Center are not blocked by it, so they can clean up resources.
