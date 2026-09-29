# T14: Security and hygiene

- **Status:** done
- **Depends on:** T13
- **Branch / PR:** `t14-security-hygiene`, [#25](https://github.com/jobdeputy/jobdeputy/pull/25) (merged); follow-up [#27](https://github.com/jobdeputy/jobdeputy/pull/27) (Dependabot PRs need a maintainer's `safe-to-test` label)

## Goal

Close the gaps found in the thorough check after T13, before starting T06.

## Research

Findings from the check on 2026-09-29, and the fix for each:

| # | Finding | Fix |
|---|---|---|
| A | Dependabot alerts were off, and Dependabot only watched GitHub Actions, not npm packages: a newly published vulnerability in a dependency would go unnoticed. | Dependabot alerts and security updates turned on (repository settings); npm added to `dependabot.yml` (weekly, grouped); `pnpm audit --audit-level high` fails CI. |
| B | Workflows used actions by moving tags (`@v6`), and any action was allowed. A hijacked tag could run code in workflows that hold AWS credentials. | Every action pinned to its exact commit, with the version in a comment (Dependabot updates both); the gitleaks image pinned by digest. After merge: only GitHub-owned, verified, and listed actions allowed, and full-SHA pinning required (repository settings). |
| C | CDK's built-in bucket-emptying helper leaves a log group with no expiry for every PR stack, never deleted. | `scripts/cleanup-log-groups.sh`: after a PR stack is deleted, its log groups go; the daily clean-up also deletes any left from deleted PR stacks and sets 14-day retention on any dev log group without one. The PR role may only describe log groups, delete PR-stack ones, and set retention. |
| D | IAM Access Analyzer was off. | `infra/bootstrap/04-access-analyzer.sh`: an organization-wide analyzer (free) that flags anything shared publicly or outside the organization. `us-east-1` now; the prod Regions at launch (#22). |
| E | Task docs out of date (T13 boxes and board status). | Updated. |

Tickets opened for launch-time items: #21 (CloudTrail organization trail, release blocker), #22 (production wiring, release blocker), #23 (Node.js 24 before 2027-04-30), #24 (CDK asset garbage collection).

## Decision

Agreed with the maintainer on 2026-09-29: do A–E now as T14, one PR, then start T06; tickets for the rest.

## Done when

- [x] Dependabot alerts and security updates on; npm in Dependabot; `pnpm audit` in CI.
- [x] All actions pinned to commits; the gitleaks image pinned by digest.
- [x] After merge (2026-09-29): only GitHub-owned, verified, and listed actions allowed, and full-SHA pinning required (repository settings). Proof: Nightly passed 17/17 and the daily clean-up passed under the new rules.
- [x] Leftover log groups cleaned (4 deleted, 2 given retention, 0 without retention left in dev); workflows keep it that way.
- [x] Organization Access Analyzer active, with its findings reviewed: the first scan (119 resources) found 4, all intended (the two GitHub OIDC roles, limited to this repository by tested trust policies, and the two IAM Identity Center admin roles). Archive rules that match both the principal and the role-name pattern archive them, so **0 findings are active** and any new one stands out.
