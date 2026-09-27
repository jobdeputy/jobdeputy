# Contributing

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
