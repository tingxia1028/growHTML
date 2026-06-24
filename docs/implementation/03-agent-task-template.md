# Subagent Task Template

Use this template when a task is safe to run in parallel.

## Task Brief

- Task ID:
- Title:
- Goal:
- Why this can run in parallel:
- Dependencies:
- Files or directories allowed to touch:
- Files or directories to avoid:
- Related plan section:

## Required Context

Summarize only the context the subagent needs. Include links to relevant files and the exact task row from `00-research-and-plan.md`.

## Implementation Requirements

- Required behavior:
- Non-goals:
- Existing patterns to follow:
- Error handling expectations:
- UI or API contract constraints:

## Acceptance Criteria

- Criterion 1:
- Criterion 2:
- Criterion 3:

## Verification Plan

- Automated command:
- Manual check:
- Evidence to return:

## Expected Response From Subagent

The subagent should return:

- Files changed.
- Summary of implementation.
- Verification commands run and results.
- Any unresolved risks.
- Integration notes for the main agent.

## Handoff Checklist

- [ ] Scope is isolated.
- [ ] Acceptance criteria are explicit.
- [ ] Verification method is known.
- [ ] File ownership does not conflict with another active task.
- [ ] Integration owner is assigned.
