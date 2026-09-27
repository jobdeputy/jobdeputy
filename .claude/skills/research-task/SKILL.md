---
name: research-task
description: Run the research step for a JobDeputy task: investigate options, record findings in the task file, and bring a recommendation to the human for alignment. Use when starting a task from docs/tasks/.
---

# Research a task

Argument: a task ID such as `T05`, or a task file path.

1. Read `CLAUDE.md`, the task file in `docs/tasks/`, its dependency tasks, and every accepted record in `docs/decisions/`. Accepted decisions are constraints. Do not reopen them.
2. Set the task status to `researching` in the task file and in `docs/tasks/README.md`.
3. Investigate only what this task needs. Do not design for later tasks.
   - Read the existing code that the task touches.
   - For external choices (libraries, services), check current documentation, maintenance activity, license compatibility with open source, and cost.
   - Keep the async-first rule and the BYOT rule in mind.
4. Write the findings into the task's **Research** section: 2 to 4 options, trade-offs, a recommendation, and open questions for the human.
5. Set the status to `awaiting-alignment`.
6. Present to the human: the recommendation first, then the options in brief, then the questions. **Stop and wait.** Do not implement.

After the human agrees, record the outcome in the **Decision** section with the date. If the choice is architectural, also add a `docs/decisions/NNNN-*.md` record and a row in `docs/decisions/README.md`.
