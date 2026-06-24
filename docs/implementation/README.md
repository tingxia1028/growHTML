# Implementation Workflow

This directory is the control surface for larger implementation work. Keep it updated while building, not only after the work is done.

## Files

- `00-research-and-plan.md`: research notes, task breakdown, implementation plan, dependencies, and verification methods.
- `01-progress-log.md`: current status, active task, completed steps, blocked items, and next action.
- `02-verification-log.md`: commands run, manual checks, screenshots, test evidence, and unresolved risk.
- `03-agent-task-template.md`: template for handing isolated work to subagents.
- `04-decision-log.md`: important implementation decisions and why they were made.

## Workflow

1. Define the goal in `00-research-and-plan.md`.
2. Break the goal into tasks with explicit dependencies.
3. For each task, write both an implementation approach and a verification method before coding.
4. Mark which tasks can run in parallel and which files or modules each task may touch.
5. Use `03-agent-task-template.md` when a task is safe to delegate to a subagent.
6. Update `01-progress-log.md` whenever the active step changes.
7. Record every meaningful verification attempt in `02-verification-log.md`.
8. Record non-obvious choices in `04-decision-log.md`.

## Parallel Work Rules

A task is safe for a subagent when all of these are true:

- The task has clear input, output, and acceptance criteria.
- It can be completed without changing the same files as another active task, or the conflict risk is explicitly managed.
- Its verification method is known before the subagent starts.
- It does not require product decisions that are still unresolved.

Avoid parallelizing tasks that share state-heavy files, public types, migrations, or UI layout primitives unless the integration path is already clear.

## Update Discipline

- Before coding: update the plan and verification method.
- During coding: update the progress log when the current step changes.
- After coding: update verification evidence and decision notes.
- Before final response: make sure the progress log reflects the actual repository state.
