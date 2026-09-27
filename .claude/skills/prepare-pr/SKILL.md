---
name: prepare-pr
description: Self-review the current branch and open a JobDeputy pull request with every template section filled in: changes, testing proof, error cases, and security review.
---

# Prepare a pull request

1. Check the branch is not `main`. Rebase onto `origin/main` if it is behind.
2. Review `git diff origin/main...HEAD` as a skeptical reviewer would:
   - bugs and unhandled error paths;
   - secrets, personal data, or credentials in code, tests, fixtures, or logs;
   - access control (a user reaching another user's data);
   - untrusted input (SSRF, injection, unsafe file handling, prompt injection from crawled content);
   - new dependencies (needed, maintained, licensed, no known critical vulnerabilities).
   Fix what you find before opening the PR.
3. Run the tests and lint. Capture the output.
4. Fill in `.github/pull_request_template.md` completely:
   - **What changed**: the meaningful changes.
   - **How it was tested**: the commands and results table.
   - **Proof**: the real test output in the collapsible block. Say which screenshots or recordings the human should attach for UI changes.
   - **Error cases**: every failure scenario, how it is handled, and whether it is tested.
   - **Security review**: answer every checkbox honestly and list new threats with their mitigations, or write "None".
   Never tick a box that is not true. Write "not applicable" with a reason instead.
5. Push, then run `gh pr create --base main --body-file <filled template>`. End the body with the project's attribution line if one is configured.
6. Report the PR URL and any sections that still need human input.
