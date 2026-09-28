# T11: Integration tests on every PR (before merge)

- **Status:** awaiting-alignment
- **Depends on:** T04
- **Branch / PR:** `t11-pr-integration-tests`

## Goal

A PR cannot merge unless the **whole** integration suite passes against a real deployed stack built from the PR's code. So a new feature cannot break an existing one without it being caught before merge ([docs/testing.md](../testing.md)). Runs before T05, so every later feature is protected.

## Scope

- In: a temporary stack per PR in the dev account, the full suite (`JD_FULL=1`), guaranteed cleanup, a PR-only AWS role, a required check, and skipping for docs-only PRs.
- Out: the post-merge run on `main` (already exists and stays), prod pipelines, and narrowing the CDK execution role (release blocker [#8](https://github.com/jobdeputy/jobdeputy/issues/8)).

## Research

### Flow

```text
PR opened or updated
  → deploy jobdeputy-dev-pr<N>-iad from the PR's code   (~3 min)
  → pnpm test:integration with JD_FULL=1                  (~1–2 min; minutes of buffer)
  → destroy the stack, even if tests failed or the run was cancelled   (~2 min)
PR closed → destroy again (safety net)
Daily → delete any jobdeputy-dev-pr* stack older than 24 hours (backstop)
```

It is **one required check, "Integration"**. For PRs that change only Markdown files, the job detects this in its first step and passes without deploying, because a skipped required check would block the merge.

### Who can run it (security)

| Case | Behaviour |
|---|---|
| Branch pushed to this repo (maintainers with write access) | Runs. |
| PR from a fork | **Never gets AWS access.** GitHub gives fork PRs no secrets and no OIDC token, and the job also checks that the PR comes from this repo. A maintainer who has reviewed the code can push the branch to this repo to run it. |
| Someone edits the workflow in their PR | Only people with write access can push branches here, and they are trusted. The AWS role limits what they can reach (below). |

The run uses a new GitHub environment `pr`. The AWS role trusts only OIDC tokens for `environment:pr` from this repo.

### PR role permissions: the main choice

| Option | How | Assessment |
|---|---|---|
| A. Assume the CDK bootstrap roles (as the `main` deploy does) | Same as today's deploy role | Simple. But nothing in IAM stops a PR run from deploying to, or deleting, the shared `jobdeputy-dev-iad` or the CI/CD stack; only the workflow's naming does. |
| **B. Direct CloudFormation access limited to `jobdeputy-dev-pr*` stacks (recommended)** | The role can create, update, and delete **only** stacks named `jobdeputy-dev-pr*`. It uploads assets to the CDK bucket and passes the CDK execution role to CloudFormation. The CDK CLI uses these credentials directly when it is not allowed to assume its bootstrap roles. | **IAM enforces** that a PR can never touch shared stacks. The queue and stack-read test permissions are likewise limited to `jobdeputy-dev-pr*`. One detail (the CDK CLI's fallback to direct credentials) is proven in the first implementation step; if it does not work, we come back to you before using A. |

With both options, what a stack *contains* is still created by the CDK execution role, which has admin rights until release blocker #8 is fixed. B protects the shared stacks by name; #8 protects everything else.

### Other details

- **Concurrency:** one run per PR at a time. A new push waits for the current run instead of cancelling it, because cancelling in the middle of a deploy leaves a stack stuck in progress. Different PRs run in parallel. Each stack uses at most 3 of the account's 10 Lambda executions at once, and runs are short.
- **Stack name:** `jobdeputy-dev-pr<N>-iad`, built with the existing `owner` option (`pr<N>` fits its naming rule). No alert emails are subscribed for PR stacks.
- **Cost:** $0. GitHub Actions is free for public repos, and the stack exists for about 7 minutes. Tables and logs are deleted with it (dev stacks use the destroy removal policy).
- **Time added per code PR:** about 7–8 minutes. Docs-only PRs take seconds.
- **Branch protection:** "Integration" is added to the required checks together with the existing three.

### Open questions

1. Option **B** (IAM-enforced `jobdeputy-dev-pr*` stacks only) is my recommendation. OK?
2. Is it OK to skip docs-only (Markdown-only) PRs?
3. Is the daily backstop cleanup of PR stacks older than 24 hours OK?

## Decision

Pending.

## Done when

- [ ] A code PR deploys its own stack, runs the full suite, and destroys the stack, and "Integration" is a required check.
- [ ] A failing integration test blocks the merge (proven with a deliberately broken commit on this PR, then reverted).
- [ ] Cleanup works when tests fail and when the PR is closed; the backstop removes old PR stacks.
- [ ] The PR role cannot create, change, or delete stacks outside `jobdeputy-dev-pr*` (proven with the IAM policy simulator).
- [ ] Docs-only PRs pass the check without deploying.
