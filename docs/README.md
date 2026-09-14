# Documentation & build-orchestration system

This `docs/` tree is the control plane for building **Interleave**, a local-first
incremental reading application. It exists so that we can build the product
**one feature at a time**, while keeping the whole
plan coherent across hundreds of small steps.

Use this file when picking up roadmap work.

## How the docs fit together

| File | Role | Changes how often |
|------|------|-------------------|
| [`concept.md`](./concept.md) | What incremental reading is and why it works. The product "why". | Rarely |
| [`architecture.md`](./architecture.md) | Stack, rationale, monorepo layout, Docker. | Occasionally |
| [`internationalization.md`](./internationalization.md) | Desktop language resources, contribution workflow, verification and migration inventory. | When languages or migrated surfaces change |
| [`domain-model.md`](./domain-model.md) | The universal `Element` model, types/statuses/stages, schema. | When the data model evolves |
| [`scheduling-and-priority.md`](./scheduling-and-priority.md) | FSRS card scheduling vs. the topic/extract scheduler, priority model. | When scheduling rules evolve |
| [`roadmap.md`](./roadmap.md) | **The task queue.** Task IDs, dependencies, status, and done-criteria. | After every completed task |
| [`tasks/_TEMPLATE.md`](./tasks/_TEMPLATE.md) | The contract every detailed task spec follows. | Rarely |
| [`tasks/M*.md`](./tasks/) | Expanded, ready-to-build specs for one milestone at a time. | Per milestone |
| [`../AGENTS.md`](../AGENTS.md) | The engineering charter: invariants, scoped instruction map, native pnpm commands, definition of done. | Rarely |

The split is deliberate: an agent rebuilds almost no context per task because the
stable knowledge lives in the reference docs and only the *next thing to do* lives
in the roadmap.

## The orchestration loop

Each unit of work is one roadmap task. The `build-tasks` skill under
`.agents/skills/` provides the independent review and commit workflow using the current agent
runtime. The `.claude/skills/` entries point to the same instructions; no particular orchestration
tool or upstream author's local configuration is required. To build a task:

1. **Pick a task.** Follow the user's selected tasks or milestone. Otherwise choose the
   lowest-numbered unchecked task in `roadmap.md` whose dependencies are all `[x]`.
   For an open-ended "continue the roadmap" request, complete one eligible task by default.
2. **Load context.** Read `AGENTS.md`, the relevant scoped instruction files, the relevant
   reference docs, and the task's
   linked spec or plan. If neither exists, draft and review the selected milestone's spec from
   the roadmap entry (`Goal` + `Done when` + `Depends on`) and current code before implementation.
3. **Inspect first.** Look at the existing schema, repositories, services, and
   tests touched by the task before writing anything. Do not rewrite unrelated code.
4. **Build the feature + its tests** in one coherent change.
5. **Verify and independently review.** Follow the root `AGENTS.md` Definition of Done and the
   skill's review gate. Reuse check results for unchanged code and rerun affected checks after
   fixes. Docker is reserved for the future encrypted-backup server.
6. **Confirm acceptance.** A persistence-sensitive task is not done unless it survives app
   restart and preserves source lineage. Missing review or blocked checks leave it incomplete.
7. **Update the roadmap and commit.** After the gate passes, check `[x]`, note downstream changes,
   and include only task-owned changes in one commit on the current task branch. Use an English
   subject such as `T021: extraction into scheduled child extract`. A same-commit roadmap entry
   can reference that unique subject; report the actual hash after the commit succeeds. If commit
   fails, leave the task explicitly incomplete and preserve its implementation for recovery.

## Just-in-time task specs

Detailed task files (`tasks/M*.md`) are written **one milestone ahead**, not all at
once. The roadmap already records every step's intent and done-criteria, so nothing
is lost — but expanding a spec *after* the prior milestone is built lets it reference
real files, real repository signatures, and real test helpers instead of guesses.

Generate a missing spec only for the milestone selected next. An existing linked plan can already
provide the detailed task contract; do not duplicate it just to satisfy a filename convention.
If independent review is unavailable, the build skill permits local work against an explicitly
unreviewed draft while keeping both the spec and implementation incomplete pending review.

## Parallelism

Independent inspection and review can use available subagents. Assign explicit scopes and file
ownership, and keep a reviewer independent from the changes it evaluates. Build roadmap tasks
sequentially by default; parallel builds need disjoint dependencies and file ownership. Serialize
shared build outputs and Electron verification. If independent agents are unavailable, complete
local work and record the outstanding review instead of claiming that self-review is independent.

## Status legend (used in `roadmap.md`)

- `[ ]` not started
- `[~]` in progress (note the agent/branch)
- `[x]` done (note the commit/PR)
- `[!]` blocked (note the blocker)
