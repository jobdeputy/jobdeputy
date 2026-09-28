# Contributing

## Development setup

1. Install Node 22 (see `.nvmrc`), then run `npm install -g corepack@latest && corepack enable pnpm`.
2. Run `pnpm install`, then `pnpm verify`. Unit and guard tests need no AWS account.
3. **Optional, for deploying:** use your own AWS account, or ask a maintainer for access to the JobDeputy dev account. Then run `cd infra && pnpm cdk deploy -c stage=dev -c owner=<you>`. Remove it with `cdk destroy` when done.

## Workflow

1. Pick or create a task in [docs/tasks/](docs/tasks/README.md).
2. Branch from an up-to-date `main`:

   ```sh
   git switch main && git pull
   git switch -c t05-profile-api      # tasks: tNN-short-slug
   # other work: fix/<slug>, chore/<slug>, docs/<slug>
   ```

3. Commit in small, focused steps. Imperative subject line, for example "Add crawl request endpoint".
4. Push and open a pull request into `main`. Fill in **every** section of the PR template, including test proof and the security review.
5. CI must pass. Resolve review comments.
6. **Squash merge** into `main`, then delete the branch.

`main` is protected: no direct pushes and no force pushes.

## Integration tests on PRs

Every PR must pass the **Integration** check: the PR's code is deployed to its own temporary AWS stack, the full integration suite runs, and the stack is deleted ([docs/testing.md](docs/testing.md)). PRs from forks get no AWS access, so the check fails for them; after reviewing the code, a maintainer pushes the branch to this repository to run it. A push that changes only Markdown reuses the previous commit's passing result, so doc fixes do not redeploy.

## Keeping a branch current

Rebase onto `main` instead of merging `main` into your branch:

```sh
git fetch origin && git rebase origin/main
git push --force-with-lease
```

## Rules

- No secrets, credentials, real résumés, or personal data in commits, tests, fixtures, or screenshots. Use synthetic data.
- New behaviour needs tests. Bug fixes need a test that fails without the fix.
- If you change a decision, add a new record in `docs/decisions/`; don't silently edit an old one.

## AI-assisted contributions

AI-assisted work is welcome and follows the same rules. Agents start from [CLAUDE.md](CLAUDE.md). A human reviews and is accountable for every merged PR.

### Claude Code cloud sessions (maintainers)

Cloud sessions clone the repo from GitHub, so they pick up `CLAUDE.md`, `.claude/settings.json`, and the project skills automatically.

- **Research and alignment happen with a human first.** Only hand a task to the cloud once its **Decision** section is filled in and pushed to `main`:

  ```sh
  claude --cloud "Run /implement-task T04"
  ```

- The session works on a task branch and opens a PR using the template. Review it like any other PR.
- Use `/autofix-pr` on a PR branch to let Claude respond to CI failures and review comments.
- Put secrets that tests need into the cloud environment's settings, never into the repo. Keep network access at **Trusted** unless a task needs more.
- Set the cloud environment's setup script to run [`scripts/cloud-setup.sh`](scripts/cloud-setup.sh). It installs pnpm and the dependencies, so sessions can run `pnpm verify`. Cloud sessions never get AWS credentials.
