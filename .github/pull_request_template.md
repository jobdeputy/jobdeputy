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

## Security review

<!-- Did this PR introduce any new attack surface? Answer each question. -->

- [ ] **Secrets:** no secrets, keys, or personal data in code, tests, logs, or screenshots.
- [ ] **User credentials (BYOT):** not logged, not returned in API responses, not shared across users.
- [ ] **Access control:** users can only read or change their own data.
- [ ] **Untrusted input:** URLs, uploaded files, and crawled content are validated. No SSRF, injection, or unsafe file handling.
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
