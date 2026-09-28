## Summary

<!-- What does this PR do and why? One or two sentences. -->

**Task:** <!-- e.g. docs/tasks/t05-profile-api.md -->
**Decision records:** <!-- e.g. docs/decisions/0002-stack.md, or "none" -->

## What changed

<!-- List the meaningful changes. Reviewers should understand the PR from this list alone. -->

-

## How it was tested

<!-- Describe what you ran and what you checked. Include commands. -->

| Check | How | Result |
|---|---|---|
| Unit tests | <!-- command --> | <!-- pass / fail, counts --> |
| Integration / end-to-end | | |
| Manual check | <!-- steps --> | |

### Proof

<!--
Attach evidence: test output, logs, screenshots, screen recordings, API request/response samples.
Paste text output inside a collapsible block. Drag images or videos into this box to attach them.
Use synthetic data only — no real résumés, credentials, or personal data.
-->

<details>
<summary>Test output</summary>

```text

```

</details>

## Error cases

<!-- Which failure paths exist and how each is handled? Mark each one tested or not tested. -->

| Scenario | Expected behaviour | Tested? |
|---|---|---|
| <!-- e.g. unreachable URL --> | <!-- e.g. job marked failed with reason, retried 3 times --> | <!-- yes: test name / no: why --> |

- [ ] Invalid input is rejected with a clear error.
- [ ] External failures (network, timeouts, third-party errors) are handled and do not crash the worker.
- [ ] Async jobs end in a clear final state (succeeded or failed with a reason) and retries are safe to repeat.
- [ ] Not applicable: <!-- explain -->

## LLM and agent call safety

<!-- Required if this PR adds or changes any LLM call, agent loop, tool-calling loop, or retry around an AI provider. Otherwise tick "Not applicable". -->

- [ ] **Not applicable:** no LLM or agent calls were added or changed.
- [ ] **Loops are bounded:** every agent, tool-calling, self-correction, or retry loop stops after **at most 3 iterations**.
- [ ] **Best result on stop:** when the limit is reached, the loop stops and returns the best result produced so far, clearly marked as partial or low-confidence. It does not fail silently or start over.
- [ ] **No hidden multipliers:** queue or job retries do not re-run a whole LLM loop (for example, 3 job retries × 3 loop iterations = 9 calls). The total calls per job is capped.
- [ ] **Token limits:** every call sets a maximum output token limit, and inputs such as crawled pages are truncated to a stated size.
- [ ] **Timeouts:** every call has a timeout.
- [ ] **No spend without intent:** LLM calls use the user's own credentials (BYOT) only for actions the user started. Nothing spends tokens automatically in the background.
- [ ] **Usage is visible:** the number of calls and tokens used per job is logged. Prompts and credentials are not logged.
- [ ] **Tested:** a test forces the model or stub to never finish and proves the loop stops at 3 and returns the best result.

**Calls per job (worst case):** <!-- e.g. "1 extraction call + up to 3 repair iterations = 4 max" -->

## Data schema

- [ ] **Not applicable:** no table, attribute, item kind, or S3 path changed.
- [ ] [docs/data-model.md](../docs/data-model.md) is updated, with a change-log line.
- [ ] Renamed or removed attributes bump `schemaVersion`, and old items still read correctly.
- [ ] New tables or key changes have a decision record.
- [ ] No forbidden data (government ID numbers, bank or card details); secrets and sensitive data only in `vault`.

## Security review

<!-- Did this PR introduce any new attack surface? Answer each question. -->

- [ ] **Secrets:** no secrets, keys, or personal data in code, tests, logs, or screenshots.
- [ ] **User credentials (BYOT):** not logged, not returned in API responses, not shared across users.
- [ ] **Access control:** users can only read or change their own data.
- [ ] **Data residency:** user data stays in the user's home Region. No cross-Region replication, references, or central user store ([0004](../docs/decisions/0004-regional-cells-and-data-residency.md)).
- [ ] **Untrusted input:** URLs, uploaded files, and crawled content are validated. No SSRF, injection, or unsafe file handling.
- [ ] **Cost:** nothing added that costs money while idle. Throttles, concurrency, and retention are set. Only services allowed by [0005](../docs/decisions/0005-pre-launch-cost-guardrails.md) are used.
- [ ] **Dependencies:** new dependencies are necessary, maintained, and have no known critical vulnerabilities.
- [ ] **No new threats**, or new threats are listed below with their mitigations.

**New threats and mitigations:**
<!-- e.g. "The crawler can reach internal IPs → blocked private ranges; test: test_blocks_private_ip". Write "None" if nothing is new. -->

## Documentation

- [ ] Task file status and notes updated.
- [ ] `docs/tasks/README.md` board updated.
- [ ] `CLAUDE.md` updated if commands, structure, or rules changed.
- [ ] A decision record was added if an architectural choice was made.

## Reviewer notes

<!-- Anything reviewers should focus on, known limitations, or follow-up work. -->
