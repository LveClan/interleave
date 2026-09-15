# M29 Basic Check Repairs (2026-09-15)

Scope: user-requested Linux basic checks and repairs after T130-T134 implementation.
Baseline commit: `2f1c684`. Environment: WSL2 Linux, Node 22.20.0, pnpm 9.12.1.
All test commands use at most two Vitest workers. Electron, GUI, real playback,
Windows packaging and performance acceptance remain deferred. M29 remains `[~]`.

## Initial Results

- `pnpm lint`: one formatting error in `0044_snapshot.json`, 20 non-null assertion warnings.
- `pnpm typecheck`, followed by `pnpm exec turbo run typecheck --continue --concurrency=2`
  to finish packages skipped by fail-fast: 11/15 packages passed, 14 diagnostics including
  repeated dependency errors. Main defects: invalid scheduler action in fixtures, nullable
  asset path, transaction cast, optional IPC field, icon name and numeric translation arguments.
- `pnpm exec vitest run --maxWorkers=2`: 4997 passed, 23 failed; 463/476 files passed.
  Duration 854.21 seconds. `pnpm test --maxWorkers=2` was rejected by pnpm's argument parser
  before testing, so the exact underlying Vitest command was used.

## Failure Causes And Repairs

| Original failures | Cause and correction |
| --- | --- |
| 8 Library/concept property cases | Every generated world reran all migrations, exceeding 30 seconds. Reuse the empty migrated connection with rollback/release savepoints and fresh repository instances. Preserve all seeds, random-case counts and assertions. |
| 2 block-processing projection cases | Single-source reads filled missing hashes while batched reads returned null. Both now use current document hashes, calculated once per source. |
| 2 topic boundary cases, domain and desktop | Chapter support admitted every topic. A shared trusted predicate admits actual sources, registered sections and EPUB spine chapters; ordinary topics retain their original processing boundary and attention scheduling. |
| 1 schema table inventory | Expected list omitted `source_media_playback` and `source_sections`. Include both additive migrations in the inventory. |
| 1 conversion-session scan | Queue count delegated to an unbounded item query. Restore SQL count/limit paths for reads unaffected by chapter ownership. Libraries containing ownership records still apply the existing ownership filter. |
| 1 old briefing assertion | The test still expected PDF/media rejection after T132/T133 added support. Assert their honest unknown history while retaining missing/deleted rejection. |
| 1 Library navigation | A casual Library open was incorrectly tagged as a scheduled queue return. Explicitly preserve casual entry behavior. |
| 1 Home navigation assertion | A due-queue preview legitimately carries queue-entry context; update the expected route. |
| 2 SourceReader loading assertions | Tests asserted metadata and retirement controls before the asynchronous inspector response. Wait for the expected content/control. |
| 1 PDF reader assertion | Old scroll-position bar was intentionally removed in T132. Assert page position separately and absence of invented processing percentage. |
| 1 CommandPalette keyboard case | Passive keyboard subscription could lag a committed result list. Install the current handler during the layout phase. |
| 1 queue Done interaction | Establish the mounted guard before a visible trigger can be clicked; reset per-test summary mocks. Also clamp long dismissal timers to prevent 32-bit overflow and rapid refresh. |
| 1 inspector date input | A mount-time synchronization effect could overwrite user input with unchanged persisted values. Reset inputs only when those persisted values change. |

Type fixes preserve the command vocabulary and narrow IPC contracts. Numeric translation
placeholders consistently accept numbers, the chapter back button uses the existing icon map,
and the migration snapshot change is formatting only. No language was enabled.

## Verification

Focused checks completed during repair:

- Eight repository/schema files: 72 passed.
- Library/concept property files: 22 passed in 59.97 seconds, with unchanged 30-second
  per-test limit and original random-case counts.
- Seven affected UI/navigation files: 229 passed and one intermittent queue failure;
  queue rerun passed all 57 cases, followed by the mounted-guard repair.
- Six affected files selected by `-t 'intent|Enter|reschedul|topic|chapter|block processing mutations'`:
  36 passed, 300 not selected.
- Final `pnpm typecheck`: 15/15 packages passed; 14 unchanged results reused from cache.
- `pnpm lint`: passed; the one new unused-variable warning was then removed and its file
  passed Biome. The remaining 20 warnings predate these repairs.
- `git diff --check`: passed.

The full rerun also exposed migration-setup timeouts in three queue and six search property
cases. These two files now use the same independently reviewed savepoint isolation; seeds,
150 cases per property and assertions are unchanged. A further Inbox focus race was fixed:
clear old selection's pending triage intent in the layout phase, before first-frame clicks,
while keeping cancelled responses and cross-selection replay protection intact.

Final evidence:

- Full `pnpm exec vitest run --maxWorkers=2`: 5010 passed, 10 failed; 473/476 files passed,
  1190.53 seconds. All 23 original failures passed. The ten new failures were nine
  migration-setup timeouts and the Inbox focus race; those files had already been loaded
  before their final edits and therefore required a separate rerun.
- `pnpm exec vitest run packages/local-db/src/queue-concept-counts.property.test.ts
  packages/local-db/src/search-concept-counts.property.test.ts
  apps/web/src/pages/inbox/InboxScreen.test.tsx --maxWorkers=2`: **77/77 passed**, 39.69 seconds.
  This covers all cases in the three affected files, not only their failed cases.
- Combined unchanged full-run results and final affected-file reruns prove **5020/5020
  tests across 476 files** on the final code. This is combined evidence, not a claim that
  the preceding single full invocation exited successfully.
- Following the final property and Inbox changes, `pnpm --filter @interleave/local-db
  typecheck` and `pnpm --filter @interleave/web typecheck` passed. Other packages retain
  the prior full 15/15 typecheck evidence. Final affected-file Biome and diff checks passed.

Independent review of the actual diff and subsequent property-isolation changes passed.
The reviewer ran no extra tests and made no edits.

Local evidence: `/tmp/interleave-basic-checks-jj2FP5/` (baseline) and
`/tmp/interleave-fix-checks-lggOln/` (repairs). These are local logs, not portable repository assets.
