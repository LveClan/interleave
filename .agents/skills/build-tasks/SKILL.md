---
name: build-tasks
description: Implement selected or next Interleave roadmap tasks with independent review and one commit per completed task. Use when asked to build roadmap tasks or continue the roadmap.
---

# Build Roadmap Tasks

Complete the selected tasks in dependency order through implementation, independent review,
fixes, verification, and one commit per completed task. Follow the root `AGENTS.md` for project
invariants, user precedence, working-tree preservation, English commits, and verification scope.

## Scope And Context

- Honor the user's selected task IDs, milestone, count, and exclusions. For an open-ended
  "continue the roadmap" request, complete one eligible task by default and state that scope.
- Within that scope, pick the lowest-numbered unchecked task whose dependencies are complete.
  If a selected task has an unmet dependency outside the scope, report it before expanding work.
- Read `docs/README.md`, the selected roadmap entries, their linked specs or plans, and applicable
  scoped `AGENTS.md` files. Consult only relevant reference docs and prior solutions.
- If the selected milestone lacks a detailed spec or plan, draft it using `docs/tasks/_TEMPLATE.md`
  and current code, obtain independent review, and commit it with an English subject such as
  `docs: add M29 task specs` before implementation. Existing linked plans satisfy this requirement.
  If independent review is unavailable, keep the draft explicitly unreviewed and continue local
  implementation against it; both spec and implementation retain the outstanding review gate.

## Available Runtime

Use the current checkout root and available collaboration tools. No named orchestration product,
personal filesystem path, model, signing provider, or resume API is required.

The coordinating agent may implement directly or assign a builder. Use a separate reviewer that
did not author the changes. Give agents the task contract, repository path, file ownership,
relevant evidence, and outstanding findings. They share a workspace unless explicitly isolated:
preserve others' changes and serialize overlapping edits, shared build outputs, and Electron runs.
The coordinator owns roadmap updates and commits; builders and reviewers do not commit.

If independent review is unavailable, finish the implementation, applicable checks, and a clearly
labeled self-review. Record independent review as outstanding; do not mark the task complete or
make its completion commit. Missing orchestration tooling alone does not prevent local work.

## Implementation And Review

1. Inspect the affected code and tests, then implement the acceptance criteria. Add tests for
   changed behavior and meaningful risks, using the root verification policy for docs-only work.
2. Obtain independent review of the actual diff, acceptance criteria, architecture invariants,
   and verification evidence. For UI behavior, include the relevant design references and light
   and dark states. For persistence, include restart, transaction, lineage, and operation-log proof.
3. Fix all demonstrated problems in task scope, including minor defects and meaningful test gaps.
   Findings need a file/location, evidence, impact, and actionable correction. Personal taste and
   unrelated improvements are not blocking findings. Record unrelated discoveries separately.
4. Re-review fixes and the behavior they can affect. Reuse the independent reviewer where possible;
   avoid restarting the entire audit without a reason. Broaden review for newly exposed risks.
5. After six review rounds, reassess recurring findings and the repair approach. Continue when
   there is a concrete feasible correction; do not repeat unchanged attempts. If an actual blocker
   prevents progress, record it and preserve the work. Every candidate for completion must have
   been independently reviewed after its last fix.

The reviewer returns a clear passed/failed verdict, check evidence, unresolved findings, and
deferred items with reasons. Defer a large refactor only when its omission does not violate the
task's acceptance criteria or a project invariant. Effort alone cannot waive a correctness issue.

If a reviewer fails to return a verdict, try recovering the review using available tools. If it
remains unavailable, progress is blocked, or a required check cannot be completed, preserve the
work and leave the task incomplete. Do not commit it as completed or start its dependent tasks.

## Verification Evidence

Establish baseline results when needed to distinguish existing failures from regressions. Record
unrelated failures separately; they do not justify unrelated edits or six identical retry rounds.
Unresolved failures in required checks still prevent a completion claim.

Follow the root Definition of Done. The coordinator owns evidence that all required checks cover
the final code state. The reviewer independently inspects that evidence and runs focused checks
where needed to substantiate findings or resolve uncertainty. Every role need not repeat a full
suite on unchanged code. After fixes, rerun affected checks and refresh any required result that
the changes invalidate. Bound heavy checks, preserve their results, and report unfinished checks.

## Completion And Recovery

Commit only when acceptance criteria, required verification, and independent review pass with
no unresolved task-blocking findings. Then:

- Update the selected task to `[x]` and add a newest-first Progress-log entry with downstream
  notes. Keep deferred items visible even when the task passes.
- Include only task-owned changes in one commit on the current task branch, using an English
  subject such as `T130: add source re-entry briefing`. Follow existing Git identity and signing
  configuration; no model coauthor trailer is required. Do not push without authorization.
- A roadmap entry included in that commit can reference its unique subject. Report the actual
  hash after success; do not invent a self-referential hash or amend repeatedly to obtain one.
- If the commit fails, leave the task explicitly incomplete and preserve the implementation and
  check results. Report the real cause rather than assuming a particular signing application.

On interruption, recover from Git state, roadmap status, and recorded findings/checks. Verify
which results still describe the current tree and resume only outstanding work. Do not replay
completed tasks or assume a proprietary workflow cache exists.

Report completed task IDs and commits, verification results, deferred items, and any incomplete
task with its exact blocker. Summarize successful checks; include relevant output for failures.
