# AWS bootstrap runbook

One-time organization setup for [T03](../../docs/tasks/t03-infrastructure-foundation.md), following decisions [0004](../../docs/decisions/0004-regional-cells-and-data-residency.md) and [0005](../../docs/decisions/0005-pre-launch-cost-guardrails.md). Run the scripts from the management account with an IAM Identity Center admin profile. Account IDs and emails are passed as environment variables and never committed.

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

```sh
export AWS_PROFILE=jobdeputy-mgmt
DEV_IAD_EMAIL=... ADMIN_USERNAME=... ./01-organization.sh
./02-guardrails.sh
ALERT_EMAIL=... ./03-budget.sh
```

Prod accounts (`jobdeputy-prod-iad`, `-bom`, `-lhr`) are created at launch by extending `01-organization.sh`. `02-guardrails.sh` already knows their Regions.

## Lifting the budget stop

After reviewing the spend, detach `jd-budget-stop` from `Workloads` (Organizations → Policies) and reset the budget action. Human admins signed in through IAM Identity Center are not blocked by it, so they can clean up resources.
