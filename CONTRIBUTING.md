# Contributing

## Development setup

1. Install Node 22 (see `.nvmrc`), then run `npm install -g corepack@latest && corepack enable pnpm`.
2. Run `pnpm install`, then `pnpm verify`. Unit and guard tests need no AWS account.
3. **Optional, for deploying:** use your own AWS account, or ask a maintainer for access to the JobDeputy dev account. Then run `cd infra && pnpm cdk deploy -c stage=dev -c owner=<you>`. Remove it with `cdk destroy` when done.

## Workflow

1. Pick or create a task as a [GitHub issue](https://github.com/jobdeputy/jobdeputy/issues).
2. Branch from an up-to-date `main`:

   ```sh
   git switch main && git pull
   git switch -c 71-crawl-retries     # tasks: <issue number>-short-slug
   # other work: fix/<slug>, chore/<slug>, docs/<slug>
   ```

3. Commit in small, focused steps. Imperative subject line, for example "Add crawl request endpoint".
4. Push and open a pull request into `main`. Fill in **every** section of the PR template, including test proof and the security review.
5. CI must pass. Resolve review comments.
6. **Squash merge** into `main`, then delete the branch.

`main` is protected: no direct pushes and no force pushes.

## Integration tests on PRs

Every PR must pass the **Integration** check: the PR's code is deployed to its own temporary AWS stack, the full integration suite runs, and the stack is deleted ([docs/testing.md](docs/testing.md)). PRs from forks get no AWS access, so the check fails for them; after reviewing the code, a maintainer pushes the branch to this repository to run it. A PR or push that changes only Markdown or the web app (`apps/web/`, which no stack deploys yet) passes or reuses the previous commit's passing result, so doc and design changes do not redeploy.

**Dependency updates** are done by hand in a `chore/` PR: Dependabot is off (November 13, 2026), and CI's audit step fails the build on any high or critical advisory, which is the signal to update. If Dependabot is turned back on, its PRs bring new third-party code, so they never get AWS access on their own: their Integration check fails until a maintainer approves. To approve: review the PR (what changes, the changelog, anything suspicious), then add the **`safe-to-test`** label. That run is triggered by you and deploys and tests normally. After Dependabot pushes again, remove and re-add the label. Adding any other label to a PR reuses the commit's earlier passing result instead of redeploying.

## Keeping a branch current

Rebase onto `main` instead of merging `main` into your branch:

```sh
git fetch origin && git rebase origin/main
git push --force-with-lease
```

## Rules

- No secrets, credentials, real résumés, or personal data in commits, tests, fixtures, or screenshots. Use synthetic data.
- New behaviour needs tests. Bug fixes need a test that fails without the fix.
- **UI changes need screenshot proof:** every PR that changes a screen gets phone, tablet, and desktop screenshots in the PR. CI posts them automatically (the **Web** workflow's *Post screenshots* job comments with all seven devices); add each new screen to `apps/web/e2e/screenshots.spec.ts`. Check them before asking for review: a PR without the comment, or with a screen missing, is not ready. PRs from forks get no comment (their token cannot write); attach the screenshots by hand from the `ui-screenshots` artifact of the run.
- UI follows [0012](docs/decisions/0012-web-ui-styling-and-testing.md): Tailwind classes and shadcn/ui components, not hand-written CSS; words in `apps/web/src/copy/`; one review pass against the round 7 prototype before handover.
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
