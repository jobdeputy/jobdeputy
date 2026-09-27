# 0002: LLM and agent loop limits and token budget

- **Status:** Accepted
- **Date:** 2026-09-27
- **Task:** t01

## Context

JobDeputy uses LLMs and agents, often with the user's own credentials (BYOT). A loop that never finishes, such as an agent that keeps retrying, a self-correction cycle, or a tool-calling loop, burns the user's tokens and money without producing value. Queue retries can multiply this hidden cost.

## Decision

Every LLM call and agent loop in the product must follow these rules:

1. **Maximum 3 iterations** for any loop around a model: agent steps, tool calls, self-correction or repair, and validation retries.
2. **Stop with the best result.** When the limit is reached, stop and return the best result produced so far, marked as partial or low-confidence with a reason. Never start over.
3. **Cap calls per job.** Queue or job retries must not re-run a whole LLM loop. Each job has a fixed worst-case number of calls, stated in the PR.
4. **Bound every call.** Each call sets a maximum output token limit and a timeout. Inputs such as crawled pages are truncated to a stated size.
5. **No spend without intent.** User credentials are used only for actions the user started. Nothing spends tokens automatically in the background.
6. **Measure usage.** Calls and tokens used per job are logged, without prompts or credentials.
7. **Prove it.** A test uses a stub model that never finishes and shows that the loop stops at 3 and returns the best result.

These rules are checked before merge through the "LLM and agent call safety" section of the PR template, and the `prepare-pr` skill enforces them.

## Why

It protects users' money under BYOT, keeps costs predictable, and a bounded best-effort result is better than an unbounded perfect attempt.

## Consequences

- Some outputs will be partial. The UI and API must show that clearly.
- The limit is 3 by default. Raising it for a specific feature needs a new decision record that justifies it.
- A shared helper (for example, a bounded loop wrapper) should be built the first time an LLM feature is added, so every feature uses the same limits.
