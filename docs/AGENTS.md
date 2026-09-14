# AGENTS.md

This directory is Interleave's build control plane. Treat `docs/roadmap.md` as the task queue
and the reference docs as product constraints, not optional background.

## Before Starting Roadmap Work

1. Read `docs/README.md`.
2. Use the user's selected tasks or milestone. Otherwise pick the lowest-numbered unchecked
   roadmap task whose dependencies are all `[x]`.
3. Read the selected entry's linked spec or plan. If neither exists, use its `Goal`, `Depends on`,
   and `Done when` to draft and review the selected milestone's spec before implementation.
   If independent review is unavailable, follow the build skill's unreviewed-draft fallback;
   neither the spec nor implementation can be marked complete pending that review.
4. Load only the reference docs relevant to the task: `concept.md`, `architecture.md`,
   `domain-model.md`, `scheduling-and-priority.md`, and `design-system.md` for UI work.
5. Search `docs/solutions/` for prior lessons before changing related architecture, tests, UI
   behavior, IPC, persistence, scheduling, or lineage.

## Roadmap And Specs

- `docs/roadmap.md` is the source of truth for task status.
- Preserve task IDs (`T001` etc.) in commits, specs, and summaries.
- Status markers are `[ ]`, `[~]`, `[x]`, and `[!]`.
- When finishing a roadmap task, mark it `[x]`, record the commit or PR, and note downstream
  changes only after acceptance, required review, and verification pass. Failed or missing review
  and blocked verification leave the task incomplete.
- Use `docs/tasks/_TEMPLATE.md` for new milestone specs.
- Do not reorder, rename, or broaden roadmap tasks casually; the app is built one coherent feature
  at a time.

## Solution Notes

Write or update `docs/solutions/` only for reusable lessons likely to recur. Keep YAML frontmatter
with searchable `module`, `problem_type`, and `tags` values. Keep each note specific to the
observed problem, why it mattered, the fix, and prevention.

## Verification Language

Follow the root `AGENTS.md` Definition of Done for verification scope, including documentation-only
changes and reuse of checks on unchanged code. Native `pnpm` is canonical for implementation
checks. Docker is reserved for encrypted-backup infrastructure, not desktop verification.
