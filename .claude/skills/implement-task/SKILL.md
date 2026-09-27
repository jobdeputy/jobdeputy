---
name: implement-task
description: Implement a JobDeputy task whose Decision section is agreed. Works on a task branch, with tests and error handling, and keeps the docs current. Use after research-task alignment.
---

# Implement a task

Argument: a task ID such as `T05`.

1. Confirm the task's **Decision** section is filled in. If it is empty, stop and run the research step instead.
2. Branch from an up-to-date `main`: `git switch main && git pull && git switch -c tNN-short-slug`. Set the status to `in-progress`.
3. Implement in small commits. For every change:
   - Write tests for the success path **and** the failure paths.
   - Make long-running work asynchronous (queue plus worker), with clear final states and retries that are safe to repeat.
   - Validate all untrusted input: URLs, files, crawled content, and request bodies.
   - Never log or return user credentials. Use synthetic data only.
   - For any LLM or agent call, follow [0002](../../../docs/decisions/0002-llm-loop-and-token-budget.md): at most 3 loop iterations, then return the best result so far marked as partial. Also set a maximum output token limit and a timeout, add no retry multipliers, and write a test with a stub that never finishes.
4. Run the full test and lint suite locally and keep the output as proof for the PR.
5. Update the task file's **Done when** checkboxes, `docs/tasks/README.md`, and `CLAUDE.md` if commands or structure changed.
6. Run `/prepare-pr`.
