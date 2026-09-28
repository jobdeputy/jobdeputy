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
   - new dependencies (needed, maintained, licensed, no known critical vulnerabilities);
   - **LLM and agent calls**: search the diff for model or provider calls and loops (`while`, recursion, tool-calling loops, retries). Each one must stop after at most 3 iterations and return the best result so far. It also needs a maximum output token limit, a timeout, and a worst-case count of calls per job, with no job-retry multiplier. **If any of this is missing, fix it before opening the PR. Do not open the PR with an unbounded loop.**
   Fix what you find before opening the PR.
3. Run the tests and lint. Capture the output.
4. Fill in `.github/pull_request_template.md` completely:
   - **What changed**: the meaningful changes.
   - **How it was tested**: the commands and results table.
   - **Proof**: the real test output in the collapsible block. Say which screenshots or recordings the human should attach for UI changes.
   - **Error cases**: every failure scenario, how it is handled, and whether it is tested.
   - **LLM and agent call safety**: tick each item or mark it not applicable, and state the worst-case calls per job.
   - **Security review**: answer every checkbox honestly and list new threats with their mitigations, or write "None".
   Never tick a box that is not true. Write "not applicable" with a reason instead.
5. Push, then run `gh pr create --base main --body-file <filled template>`. End the body with the project's attribution line if one is configured.
6. Report the PR URL, its check status, and any sections that still need human input. **Never merge the PR.** The maintainer merges.
