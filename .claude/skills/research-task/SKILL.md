---
name: research-task
description: Run the research step for a JobDeputy task: investigate options, record findings on the task's GitHub issue, and bring a recommendation to the human for alignment. Use when starting a task from a GitHub issue.
---

# Research a task

Argument: the task's issue number, such as `#71`.

1. Read `CLAUDE.md`, the issue (`gh issue view NN --comments`), the issues it depends on, and every accepted record in `docs/decisions/`. Accepted decisions are constraints. Do not reopen them.
2. Add the `researching` label to the issue.
3. Investigate only what this task needs. Do not design for later tasks.
   - Read the existing code that the task touches.
   - For external choices (libraries, services), check current documentation, maintenance activity, license compatibility with open source, and cost.
   - Keep the async-first rule and the BYOT rule in mind.
4. Post the findings as a **Research** comment on the issue: 2 to 4 options, trade-offs, a recommendation, and open questions for the human.
5. Swap the label for `awaiting-alignment`.
6. Present to the human: the recommendation first, then the options in brief, then the questions. **Stop and wait.** Do not implement.

After the human agrees, post the outcome as a **Decision** comment on the issue, with the date. If the choice is architectural, also add a `docs/decisions/NNNN-*.md` record and a row in `docs/decisions/README.md`.
