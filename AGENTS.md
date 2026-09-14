# AGENTS.md

## Project

Interleave is a desktop-first, local-first incremental reading system:

```txt
Source -> Topic -> Extract -> Clean extract -> Atomic statement -> Card -> Review -> Mature knowledge
```

It is not a read-it-later app, a generic notes app, or only a flashcard app. Every feature should
help users process too much source material without losing provenance, priority, scheduling, or
review quality.

## Context By Task

- For roadmap work, use `docs/README.md`, the selected `docs/roadmap.md` entries, and their linked
  specs or plans. Follow the user's requested task scope; otherwise choose the lowest-numbered
  unchecked task whose dependencies are complete.
- Consult `CONCEPTS.md` for domain vocabulary and `docs/solutions/` for prior lessons in the area
  being changed. Search for relevant sections instead of loading the entire documentation tree.
- Read applicable scoped instructions before editing their files. Reuse context already read
  during this task unless it changes.

## Working Agreements

- Reply in Chinese unless the user requests another language. Use English commit subjects and
  bodies, following the repository's existing task IDs and commit style.
- Carry authorized implementation through review, verification, and fixes. Make routine local
  decisions from the code and task scope; ask only when missing information materially changes
  the result or an action needs authorization that has not already been given.
- Explicit user instructions take precedence over repository workflow defaults and skills.
  Historical plans and solution notes provide context; check them against current code and the
  selected task before treating their examples as requirements.
- Use the current checkout and available tools. Discover the repository root, branch, working
  tree, and relevant tool versions; do not assume the upstream author's paths, agent runtime,
  signing provider, credentials, or hosted services exist in this fork.
- Preserve unrelated working-tree and staged changes. Include only task-owned changes in commits
  on the current task branch. Respect configured Git identity and signing; do not invent model
  coauthor trailers or change signing configuration to bypass a failure. Push or publish only
  within the user's authorization.
- When a required capability is unavailable, use an equivalent local workflow where possible.
  Complete independent work and report the exact remaining check or action. Missing tools or
  verification are never evidence that a task passed.

## Scoped Instructions

Read the applicable parent and closest scoped instruction files for the areas being changed:

- `docs/AGENTS.md` - roadmap, plans, task specs, solution docs, and documentation hygiene.
- `design/AGENTS.md` - design tokens, icon map, and immutable prototype references.
- `apps/AGENTS.md` - app-layer boundaries shared by desktop, renderer, API, extension, and site.
- `apps/desktop/AGENTS.md` - Electron main/preload, IPC, app-data paths, vault, backup, local jobs.
- `apps/web/AGENTS.md` - React renderer, UI state, routes, and desktop bridge usage.
- `apps/api/AGENTS.md` - encrypted-backup API scope.
- `apps/extension/AGENTS.md` - MV3 capture extension and loopback contract.
- `apps/site/AGENTS.md` - public/static product site boundary.
- `packages/AGENTS.md` - package-layer ownership and cross-package boundaries.
- `packages/core/AGENTS.md` - domain types and universal `Element` vocabulary.
- `packages/db/AGENTS.md` - Drizzle SQLite schema and migrations.
- `packages/local-db/AGENTS.md` - repositories, transactions, persistence, and `operation_log`.
- `packages/scheduler/AGENTS.md` - FSRS card scheduling and attention scheduling.
- `packages/editor/AGENTS.md` - Tiptap/ProseMirror document lineage.
- `packages/importers/AGENTS.md` - import pipelines, snapshots, and asset-vault ingestion.
- `packages/capture-contract/AGENTS.md` - extension-to-desktop loopback capture contract.
- `packages/ui/AGENTS.md` - shared UI primitives.
- `packages/testing/AGENTS.md` - factories, fixtures, and test helpers.
- `tests/AGENTS.md` - Electron Playwright and cross-package E2E expectations.

Each scoped `AGENTS.md` has a sibling `CLAUDE.md` symlink for Claude-compatible tooling.

Older task specs may cite former root `CLAUDE.md` sections. Use this crosswalk:

| Former section | Destination |
| --- | --- |
| Preferred stack, runtime, MVP boundaries | `apps/AGENTS.md`, `apps/desktop/AGENTS.md`, `apps/api/AGENTS.md` |
| Architectural rules, Electron runtime & security | `apps/AGENTS.md`, `apps/desktop/AGENTS.md`, `apps/web/AGENTS.md` |
| SQLite rules, asset vault, data rules | `packages/db/AGENTS.md`, `packages/local-db/AGENTS.md`, `apps/desktop/AGENTS.md` |
| Document/editor rules | `packages/editor/AGENTS.md` |
| Scheduling rules, priority rules | `packages/scheduler/AGENTS.md`, `packages/core/AGENTS.md` |
| Review rules, card-quality rules | `apps/web/AGENTS.md`, `packages/core/AGENTS.md`, `packages/local-db/AGENTS.md` |
| UX rules, key screens, design system | `design/AGENTS.md`, `apps/web/AGENTS.md`, `packages/ui/AGENTS.md` |
| Testing expectations, Definition of Done | This file, `tests/AGENTS.md`, and scoped package/app files |
| Product north star | This file and `CONCEPTS.md` |

## Runtime

The canonical product is the native Electron desktop app with native SQLite via
`better-sqlite3` and a filesystem asset vault. Use native `pnpm`; Docker is only for the later
encrypted-backup server support and is not the desktop development or test loop.
Read `package.json` for the supported Node and pnpm versions. Check the current OS and installed
tools before selecting setup commands; upstream machine-specific examples are not prerequisites.

Common commands:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Full Electron app with Vite renderer and live `window.appApi`. |
| `pnpm dev:renderer` | Bare renderer only; no Electron bridge or live local data. |
| `pnpm lint` | Biome format/lint check. |
| `pnpm typecheck` | Workspace TypeScript check. |
| `pnpm test` | Vitest unit/domain/repository tests. |
| `pnpm e2e` | Playwright E2E against the Electron app where feasible. |
| `pnpm db:generate` | Generate Drizzle SQLite migrations. |
| `pnpm db:migrate` | Apply local SQLite migrations. |
| `pnpm seed` | Load demo fixtures into the dev SQLite DB. |

## Non-Negotiable Invariants

- The renderer never opens SQLite, reads arbitrary files, or writes arbitrary files. Trusted local
  capabilities live behind validated Electron IPC exposed through the typed preload bridge.
- Never expose a generic `db.query(sql)` or generic filesystem API to the renderer.
- SQLite is the canonical local database; the filesystem is the canonical local asset vault.
  Large PDFs, images, audio, video, snapshots, exports, and backups do not belong in SQLite.
- Source lineage is sacred. Extracts, cards, highlights, read-points, media fragments, and review
  actions must be able to trace back to source metadata and document context.
- Meaningful mutations are command-shaped, transactional, and appended to `operation_log` in the
  same transaction as the state change.
- Use FSRS only for active-recall cards. Sources, topics, extracts, tasks, and synthesis work use
  the attention scheduler.
- UI work follows `design/`: `design/tokens.css`, `design/icon-map.md`, and the immutable
  `design/kit/` visual reference.
- Prefer soft delete, undo, trash, and explicit destructive confirmations over irreversible data
  loss.

## Definition Of Done

For changes to application code, dependencies, or build/test configuration, confirm the final
implementation from the repository root with:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. Relevant `pnpm e2e` / Electron Playwright coverage for user-facing, persistence, import,
   review, search, backup, or IPC behavior

During implementation and review, run focused checks for changed behavior. Required checks must
cover the final code state, but need not be rerun by every agent on unchanged code. Expand or
repeat verification when changes, failures, or unresolved concerns justify it. Record commands,
results, and any environment blockers; a blocked check is not a pass.

For documentation-only changes, check accuracy, links, examples, and `git diff --check`; validate
skill frontmatter and walk through changed workflow decisions when applicable. Run code checks
if the change also affects tooling or file discovery. A prose-only edit does not require booting
Electron or rerunning the application suite.

For persistence features, also prove data survives app restart, multi-table mutations are
transactional, foreign keys are enforced, source lineage is preserved, and `operation_log` entries
are written.

Mark roadmap work complete only after its acceptance criteria, required review, and verification
pass. Update `docs/roadmap.md` with the completed task, commit reference, and downstream notes;
keep blocked or partially verified work explicitly incomplete.
