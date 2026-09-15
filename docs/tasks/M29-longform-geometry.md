# M29 — Long-form geometry & the re-entry payoff (T130–T134)

> A 400-page PDF is the canonical incremental-reading object, and PDF import was a flagship
> Part II milestone — but the 7-state block-processing model exists ONLY for ProseMirror
> document sources: `PdfReader.tsx` and `MediaReader.tsx` contain zero block-processing
> references (verified), so for exactly the formats where IR earns its keep, done-gates, yield,
> and scheduling are structurally blind. The schema documents "One read-point per element"
> (`packages/db/src/schema/relations.ts`), `docs/concept.md`'s own pipeline begins with "skim
> and triage" — zero matching features anywhere — and `needs_later` deferrals are write-only
> (recorded, counted at exit via `doneIntentBreakdown.ts`, never honored on return; zero
> scheduler references). This milestone makes books, papers, and lectures first-class: durable
> geometry, a structural skim gear, and scheduled returns that orient instead of dumping the
> user at a scroll position. Ideation survivor #5 (+#5c/d re-entry payoff).
>
> **Slicing rationale (why this order):** T130/T131 are cheap, ship on existing block rows for
> document sources, and pay off every scheduled return immediately. T132/T133 are the substrate
> build (largest item in Part III) that extends the same payoff — and #1's yield scheduling,
> #6's flow stats, and honest Done breakdowns — to PDF/media. T134 rides on T132's geometry.
>
> **Shared context for every task in this file.** Read
> `docs/solutions/architecture-patterns/durable-source-block-processing-state.md` (the 7-state
> model, content-hash reconciliation, "extracted" derived from live lineage, the markDone gate)
> and `docs/solutions/design-patterns/non-modal-intent-menu-replacing-confirm-gate.md` (the
> breakdown copy derives from domain predicates).
>
> **Standard gates (inherited by every task below):** `pnpm lint` · `pnpm typecheck` ·
> `pnpm test` · relevant `pnpm e2e`; persistence survives restart; mutations transactional +
> op-logged; lineage preserved; UI follows `design/tokens.css` + kit; no unrelated refactors.
>
> **File/line references** verified 2026-06-09/10; re-verify with grep before editing.

> **2026-09-15 basic-check follow-up:** the user subsequently authorized full Linux basic
> checks and repair of their failures. See [results and repairs](./M29-basic-checks-2026-09-15.md).
> All 5020 tests have final passing evidence across the full run and affected-file reruns;
> lint and typechecking pass. This historical checkpoint is superseded by the
> [Windows functional acceptance record](./M29-windows-acceptance-2026-09-15.md).
> Task statuses below reflect acceptance commits; earlier implementation notes retain
> their original verification scope. Final acceptance followed the user's single-agent
> instruction and used self-review; original independent implementation reviews remain valid.

---

# T130 — Source re-entry briefing

- **Milestone:** M29 — Long-form geometry & re-entry
- **Status:** `[x]` Windows functional acceptance complete; commit `T130: 完成来源重返摘要的 Windows 验收`
- **Depends on:** T083
- **Roadmap line:** opening a scheduled source return renders a since-last-visit briefing —
  read %, new/deferred/stale block counts, descendant card performance, last extraction point —
  computed from existing block and yield rows, with one-click jump to the next unresolved block.

## Goal

The attention scheduler's entire output is "this source returns now" — and today the return
resumes a scroll position with zero synthesis. The briefing makes every scheduled return
cheaper forever: what happened last time, what's outstanding, where to start. Pure read-model
payoff on data the block system already stores.

## Context to load first

- Existing code: block-processing rows + `packages/local-db/src/block-processing-service.ts`
  (per-state counts — the breakdown derivation in `doneIntentBreakdown.ts` shows the predicate
  style), `useReadPoint.ts` (resume — the briefing complements, never replaces it), T083 yield
  + descendant card stats per source, reader header chrome (`SourceReader.tsx` — host surface;
  see the `process-queue-source-reader-*` solutions notes for chrome conventions).
- Invariants: read model behind typed IPC; the briefing renders only on *scheduled returns*
  (arriving via queue/process flow) or when meaningfully stale (e.g. >7 days since last visit) —
  not on every casual open; dismissible per visit.

## Deliverables

- [x] `SourceReturnBriefing` read model: last-visit timestamp, read% delta, counts by state
      (new/unread, `needs_later`, `stale_after_edit`, needs-reverify when T123 exists),
      descendant card health (count, retention, struggling clusters when T128 exists), last
      extraction point, next-unresolved-block target.
- [x] Briefing UI at the top of the reader on scheduled returns: compact, dismissible, with
      one-click "jump to next unresolved" (and "jump to first deferred" — T131 deepens this);
      copy derived from domain predicates (no renderer-invented numbers).
- [x] Tests: unit (read model math on seeded block/yield fixtures; scheduled-return gating);
      e2e — process-queue into a partially-read fixture source, briefing renders correct
      counts, jump lands on the right block, restart-safe.

## Done when

- A source arriving through the queue opens with an accurate since-last-visit briefing and a
  working jump; casual opens stay clean; dismissing it lasts the visit.
- Standard gates pass.

## Notes / risks

- Keep it glanceable: one compact strip, not a dashboard — the user is here to read.

## Implementation And Verification (2026-09-15)

Implementation commit: `T130: add source re-entry briefing` (local only).

- `SourceReturnBriefingQuery` reads document sources through `sourceReturn:briefing`, with a
  strict typed request. It reuses block-processing views/summary, scoped source yield,
  measured retention, and settings-governed T128 clusters. Reads do not materialize state,
  reschedule anything, or write an operation log; no migration or new persistent write exists.
- Historical audit: the database has no per-open visit records or visit-time read-percentage
  denominator. `lastVisitAt` therefore means **last recorded reading activity**, explicitly
  labeled in the UI, from read-points, direct extraction, and explicit block actions. Existing
  operation-log evidence preserves earlier actions overwritten by automatic reconciliation;
  reconciliation/backfill and generic `elements.updatedAt` are not visits. `readPctDelta` is
  `null` and displayed as unknown. Block counts and card health are current totals; retention
  is labeled as a rolling 30-day graded-review rate, excluding edit markers.
- Prior recorded activity is required. Queue/process returns show the briefing; casual opens
  show it only after strictly more than seven days. First opens remain quiet. Dismissal lasts
  the host visit, including same-source search changes. PDF/media and non-source bodies are
  excluded from T130. Recent extraction labels remain descriptive when their block was removed.
- Both the standalone reader and process workbench mount the compact shared component. The
  standalone strip sits outside the document scroller so restoring a distant read-point cannot
  hide it. Jumps use live stable block IDs, excluding removed stale blocks. Explicit URL targets
  take priority over automatic resume; a briefing click wins over late read-point/reread loads;
  unavailable reread targets fall back to the stored read-point. Source changes discard pending
  results and reset visit UI. English/Chinese resources follow existing i18n conventions without
  enabling another language.
- Independent review found and verified fixes for reconciliation misclassified as a visit,
  briefing visibility after automatic scrolling, dismissal resetting on search changes, and
  invalid reread targets preventing resume. Light/dark and 900px screenshots were inspected.
- Environment: clean `main` checkout, WSL2 Linux, Node `22.20.0`, pnpm `9.12.1` selected from the
  installed Node 22 toolchain. Electron uses the real WSLg GUI with `DISPLAY=:0`; the first launch
  without DISPLAY failed before app initialization. This was an environment failure, not a pass.
- Passed focused checks during implementation: 194 tests across query, briefing, reader,
  ProcessQueue and QueueScreen; IPC contract, queue routing and i18n resource checks also passed.
  Final behavior after the reread fallback fix: `pnpm exec vitest run
  packages/local-db/src/source-return-briefing-query.test.ts
  apps/web/src/pages/source/SourceReturnBriefing.test.tsx
  apps/web/src/pages/source/SourceReader.test.tsx --maxWorkers=2` passed **44 tests** in 7.12s.
  Coverage includes all-table read-only snapshots, retention scoping, historical unknowns,
  stale targets, display gates, per-visit dismissal, A/B/A response isolation, and delayed jumps.
- `DISPLAY=:0 pnpm e2e tests/electron/source-return-briefing.spec.ts` passed: real queue entry,
  process entry, counts, viewport visibility, both jumps, dismissal, IPC rejection, and restart.
  The related run adding `source-reader.spec.ts`, `read-points.spec.ts`, `processed-spans.spec.ts`
  and `reread-proposals.spec.ts` recorded **15 passed / 1 timeout** (`processed-spans`, 30s).
  These Electron results precede the final missing/error-reread fallback fix; that fix has final
  focused host coverage, and final Electron rerun remains for unified verification.
- `pnpm lint` passed with non-null-assertion warnings in fixture tests; `pnpm typecheck` passed
  all 15 workspace tasks before the final fallback/import cleanup. Full `pnpm test` was stopped
  at the user's request after roughly six minutes, with failures observed in PDF-region,
  concept-members and LibraryScreen tests. A concurrent targeted PDF retry also timed out.
  These failures have not been resolved or classified as harmless; no full-suite pass is claimed.
- **User-directed checkpoint:** on 2026-09-15 the user requested stopping full unit tests,
  running only focused feature checks, and committing now. Unified tests, remaining failure
  investigation and final broad verification wait for an explicit later request. Keep T130
  `[~]` until that verification is complete. No further tasks, push, publication or deployment.

Downstream: T131 can reuse the live unresolved/deferred targets and state predicates. Historical
percentage deltas require an explicit visit snapshot design; current counters cannot supply one.
PDF/media geometry remains T132/T133 scope.

---

# T131 — Honor `needs_later`

- **Milestone:** M29 — Long-form geometry & re-entry
- **Status:** `[x]` Windows functional acceptance complete; commit `T131: 完成待处理段落的 Windows 验收`
- **Depends on:** T130
- **Roadmap line:** deferred blocks are reachable via a jump rail (listing `needs_later` and
  `stale_after_edit` blocks) and un-deferring/resolving updates the durable state — block
  deferral stops being write-only.

## Goal

A user who marks a paragraph "needs later" today gets nothing back: the mark is counted at exit
and never seen again (zero scheduler references; no navigation). After this task, deferred
blocks are first-class targets on return — a rail lists them, jumping is one key, resolving
updates the durable state. The deferral promise finally pays.

## Context to load first

- Existing code: `needs_later` write path (`ProcessedSpanButtons.tsx` — the marking control)
  and exit counting (`doneIntentBreakdown.ts`); block-state read paths +
  `scheduler-service.ts:137` (the aggregate `unresolvedRatio` — deferred blocks already feed it
  as unresolved); reader decoration machinery (`packages/editor` reader decorations — the rail
  highlights ride this); T130's briefing (the rail is its deep half).
- Invariants: state transitions through the block-processing service (domain-gated like
  `markDone`); rail order = document order; resolving a block from the rail writes the same
  states the inline controls write.

## Deliverables

- [x] Jump rail in the reader: a collapsible list/strip of `needs_later` +
      `stale_after_edit` (+ needs-reverify when T123 exists) blocks with snippet previews;
      keyboard next/prev-deferred navigation; entry from the T130 briefing.
- [x] Resolution affordances at the rail/inline: un-defer (back to unread/read), mark read /
      extract (existing verbs), each updating durable block state via the service.
- [x] Scheduler note: deferred-block presence already pressures return via `unresolvedRatio` —
      verify and add a unit test pinning that contract (no new scheduler input here; T112 owns
      interval shaping).
- [x] Tests: unit (rail read model, transitions); e2e — defer two blocks, exit (breakdown
      counts them), return via queue, rail lists them, jump + resolve one, counts update,
      restart-safe.

## Done when

- Deferred blocks are visible, navigable, and resolvable on every return; the exit breakdown,
  rail, and block rows always agree; deferral demonstrably round-trips.
- Standard gates pass.

## Notes / risks

- This is the trust-repair task for the marking feature — if the rail is buried, the feature
  stays "write-only" in practice. Make next-deferred a first-class shortcut (T048 registry).

## T131 Implementation And Basic Verification (2026-09-15)

Final acceptance: [Windows evidence](./M29-windows-acceptance-2026-09-15.md).
`source-pending.spec.ts` covers both readers, keyboard navigation, state/receipt undo,
queue return and restart; the final briefing/pending rerun passed 2/2. The original
implementation review below is retained; acceptance fixes were self-reviewed under
the user's single-agent instruction. Earlier deferred checks are now superseded.

Local implementation commit: `T131: make deferred source passages actionable`.
The user explicitly authorized building on T130's implementation while keeping T130 `[~]`.
This is an implementation/review checkpoint, not completion of the standard gates.

- `SourcePendingService.list` provides a document-only read model through strict typed
  `sourcePending:list` IPC. Deferred and stale blocks appear in document order with bounded,
  normalized current-text previews. Removed/unlocatable stale blocks sort last and remain
  visible as unavailable; they cannot navigate or mutate. PDF/media and non-source bodies
  are excluded. Shared block text extraction preserves the existing content-hash calculation.
- Both readers host the shared `SourcePendingRail`, with a compact collapsible list, T130
  briefing entry, click navigation and `Alt+[` / `Alt+]` previous/next navigation registered
  in the shortcut catalogue. Existing text selection/extraction controls remain the extraction
  workflow. The rail does not introduce a bulk-extraction command or a scheduler algorithm.
- Resume explicitly chooses `unread` or `read`; neither is terminal. Trusted writes revalidate
  the source, live geometry, expected state and current content hash, and refuse blocks with
  live output lineage or live reverify provenance (including transitive descendants when a
  directly anchored extract was deleted). A distinct output count links to the existing
  source-scoped `/maintenance/reverify` workflow. No rail action clears provenance or flags.
- `sourcePending:resume` and `sourcePending:undo` reuse the block repository's transactional,
  operation-logged writes. A trusted stored preimage plus opaque receipt token implements the
  same guarded receipt approach used by existing non-global undo workflows. Undo refuses later
  state/content/output changes; it does not join global undo, whose `update_document` operations
  are not generally invertible. No schema migration or new scheduling state was introduced.
- Source-scoped change events refresh the rail, briefing counts and standalone processing
  decorations after edits, extraction, read-point or block changes. Existing undo notifications
  refresh the read models too. Briefing entry history and dismissal remain visit-scoped. Read
  sequences and keyed source instances discard stale reads/mutations. User jumps retain T130's
  precedence over late read-point/reread responses, verify the live editor target, and commit
  filter visibility before scrolling. Missing editor targets leave selection unchanged.
- State mutations compare the editor's normalized ProseMirror node to `persistedDoc`, the last
  acknowledged saved body, so neither editor nor persistence debounce can authorize an outdated
  decision. Schema normalization permits imported default attributes without false dirty states.
- Independent review found and verified fixes for hidden-filter jump ordering, unsaved-editor
  state changes (including raw-JSON comparison false positives), stale processing reads
  overwriting current statistics, and hidden transitive reverify counts. No unresolved
  implementation finding remains. GUI appearance was not tested in this checkpoint.

Actual basic checks (Node 22.20.0 / pnpm 9.12.1; all Vitest runs `--maxWorkers=2`):

- `pnpm exec vitest run packages/local-db/src/source-pending-service.test.ts --maxWorkers=2`:
  final **8 passed**. Covers ordering/filtering, current previews, unavailable locations, read-only
  operation count, resume/undo guards, forced operation-log failure rollback, foreign keys,
  preserved lineage/provenance and scheduler `source_unresolved_shortened` with ratio `1/3`.
- `pnpm exec vitest run apps/web/src/pages/source/SourcePendingRail.test.tsx
  apps/web/src/pages/source/SourceReader.test.tsx apps/web/src/pages/source/useDocument.test.tsx
  apps/web/src/pages/source/useProcessedSpans.test.tsx --maxWorkers=2`: **54 passed** after
  the interaction fixes. This includes keyboard/click targeting, source switch isolation,
  pending mutation isolation, unsaved-edit refusal and stale reload suppression.
- `pnpm exec vitest run apps/web/src/pages/source/pendingEditor.test.ts --maxWorkers=2`:
  **1 passed**, covering the final normalized-editor guard used by both hosts.
- `pnpm exec vitest run apps/web/src/pages/source/SourcePendingRail.test.tsx
  apps/web/src/pages/source/SourceReturnBriefing.test.tsx
  apps/desktop/src/shared/contract.test.ts --maxWorkers=2`: **301 passed** at that stage;
  subsequent rail edits were covered by the 54-test run. IPC allowlist/strict payloads,
  briefing refresh/history/dismissal and rail entry were verified.
- `apps/web/src/shell/shortcuts.test.ts` passed in the first focused UI run. That run caught
  a synthetic window key target without `closest`; it was fixed and the rail rerun passed.
- `pnpm exec vitest run apps/web/src/pages/queue/ProcessQueue.test.tsx -t
  'renders a source as an inline reading workbench|keeps specialized|sets a source read-point inline'
  --maxWorkers=2`: **4 selected passed**; other cases were not selected, not claimed as verified.
- Biome check/format on task-modified files only and `git diff --check`: passed. The only Biome
  warnings are three pre-existing non-null assertions in the modified T130 briefing test.

Per explicit user instructions, no full `pnpm test`, workspace typecheck, Electron E2E, GUI
validation, app/server launch, Windows switch or system configuration change was performed.
Unified verification still needs final typechecking, actual reader/process layout and keyboard
behavior, real IPC/restart persistence, and the remaining standard gates. Existing T130 deferred
verification is unchanged. T131 remains `[~]` until the user requests that unified pass.

---

# T132 — PDF block-state parity

- **Milestone:** M29 — Long-form geometry & re-entry
- **Status:** `[x]` Windows functional acceptance complete; commit `T132: 完成 PDF 处理状态与千页规模验收`
- **Depends on:** T064, T065
- **Roadmap line:** PDF sources carry durable per-page/per-region processing state (the
  existing 7-state vocabulary + reconciliation), feeding source progress, Done-intent
  breakdowns, yield, and the scheduler exactly as document blocks do.

## Goal

Give the heaviest sources real geometry: per-page (and per-extracted-region) processing state
for PDFs, in the same 7-state vocabulary the document reader uses — so a 400-page book has
honest progress, an honest Done breakdown, real yield ratios, and scheduler pressure that sees
it. The hard design (durable per-unit state, reconciliation, lineage-derived "extracted") is
already done for documents; this is extension to a second geometry.

## Context to load first

- Existing code: the block-processing schema/service/repository (what a "block row" needs —
  this task generalizes the unit key from ProseMirror block ID to a page/region key for PDF
  sources; inspect how rows join to elements and how reconciliation hashes content),
  `PdfReader.tsx` (page rendering, text layer, region extraction — :107/:869 show the current
  extraction-rectangle overlay; read-point per page), PDF text extraction from T064 (page text
  for content-hashing), DoneIntentMenu breakdown + `unresolvedRatio` consumers (they must Just
  Work once rows exist).
- Invariants: same state vocabulary and transition gates (no PDF-special states); "extracted"
  derived from live output lineage exactly as documents do (region extracts already carry page
  + coordinates — T065); reconciliation on re-import (content-hash per page; a re-OCRed or
  re-imported page transitions to `stale_after_edit` like an edited block).

## Deliverables

- [x] Unit model: page-level rows for every PDF source (created lazily on first open or at
      import — decide and document; lazy avoids 400-row writes for never-opened files), plus
      region-level derivation for extracted regions (a page with live region extracts counts
      extracted; remaining page text stays unread/read — document the page-state composition
      rule).
- [x] Reader integration: page states driven by reading position + explicit verbs (mark-read,
      ignore, needs-later at page granularity — a compact per-page affordance, not per-line
      chrome); the existing extraction flows set extracted state via lineage derivation.
- [x] Consumers verified: source progress, Done-intent breakdown, `sourceProcessing` ratios,
      T083 read%, T130 briefing, T131 rail — all render PDF sources with no special-casing
      (tests per consumer).
- [x] Reconciliation: page-content hashes; re-import/OCR transitions changed pages to
      `stale_after_edit` (and T123 propagation picks it up when present).
- [x] Tests: unit (row lifecycle, composition rule, reconciliation); e2e — read a fixture PDF,
      mark pages, extract a region, exit shows an honest breakdown, return shows the briefing,
      restart-safe.

## Done when

- A PDF source reports honest per-page progress everywhere documents do; the Done gate's
  breakdown is populated; yield and scheduler pressure see PDF work; re-import staleness works.
- Standard gates pass.

## Notes / risks

- Largest task in Part III — keep granularity disciplined: PAGES (with regions as derivation
  inputs), not text-line blocks; finer granularity is a non-goal and a tarpit.
- 1000-page fixtures: verify row-count performance against the M20 large-collection harness.

---

## T132 Implementation And Basic Verification (2026-09-15)

Final acceptance: [Windows evidence](./M29-windows-acceptance-2026-09-15.md).
`pdf-processing.spec.ts` covers page decisions, partial extraction, real OCR,
consumer consistency and restart. The final PDF import/region/1000-page rerun
passed 6/6 with unchanged performance budgets; the related process-entry rerun
passed 2/2. Offscreen canvases are released and re-rendered on return. Original
independent review is retained; final fixes were self-reviewed under the user's
single-agent instruction. Earlier deferred checks are now superseded.

Local commit: `T132: persist PDF page processing states`. This checkpoint follows the user's
explicit limited verification scope; T130/T131 remain pending unified verification.

- `ProcessingUnitRepository` projects PDF pages from trusted `document_blocks.page`, keyed
  `pdf:page:N` in the existing processing table. Rows materialize lazily on reader open or first
  extraction. No schema change/migration is needed: existing keys have no document-block FK.
  The typed geometry on views is shared infrastructure for T133, not a new Element model.
- Each page stores the state of its **remaining content**. Live text/region output locations
  separately supply output IDs/counts. A partial extraction does not make a page terminal:
  unread/read/deferred remain unresolved. Explicit finish changes the remainder to processed;
  with live outputs its composed state is extracted. Ignore and finish are terminal; read is not.
  Deleted outputs cease contributing; removed stale pages retain live output counts and are
  explicitly unlocatable. PDF read% counts whole pages marked read/finished, never scroll position.
- Page controls provide read/unread/ignore/defer/finish plus guarded receipt undo through strict
  `processingUnits:*` IPC. Revalidation checks source liveness, geometry, current hash and state;
  undo also guards later outputs. Writes and operation logs share a transaction. Existing text
  selection, region capture and page read-points remain available. The page-position percentage
  bar was removed; page position is a caption and processing counts come from the trusted summary.
- Shared summary/Done/yield/scheduler consumers see page units; T130 briefing and T131 pending
  rail use the same models. The process workbench's existing specialized-reader link opens the
  full reader with queue-entry context. No historical baseline was invented: delta stays null.
- Hashes include normalized page text and original asset hash. Accepted OCR/document updates
  and asset byte replacement reconcile inside their transactions. Changed/removed pages become
  stale, restoration uses the captured hash, and subsequent edits to an already stale page
  refresh propagation. Original location block IDs, page and rectangles are preserved.
  Page decisions never clear derived needs_reverify. The existing reverify workflow now previews
  page evidence and validates its hash; geometric rebase is clear-only and returns the page to
  unread, preserving authored extract/fragment bodies.
- Explicit pending/briefing jumps and user scrolling win over delayed restore. Identical route
  objects cannot replay old jumps; region flash cleanup has independent lifetime. Reader/control
  instances are keyed by source. Missing pages report unavailable. New copy follows static i18n
  IDs and existing tokens/icons; Chinese resources were updated without enabling the language.
- Independent actual-diff review passed. Fixed findings: removed-page output counts disappearing,
  repeated route effects cancelling region-flash expiry, and already-confirmed outputs needing
  reflagging when an already-stale page subsequently disappears. Review also inspected the final
  reverify integration, current-state checks and shared consumers. No unresolved feature finding.

Actual commands/results, Node 22.20.0 / pnpm 9.12.1 selected through command-local PATH:

- `pnpm exec vitest run packages/local-db/src/processing-unit-service.test.ts --maxWorkers=2`:
  final **7 passed** after reconciliation/removed-page fixes. An earlier additional region
  lineage run with `-t 'region outputs'` passed **1 / 5 not selected**. Seven cases cover partial outputs,
  summary/Done/yield/scheduler/briefing/pending, OCR/restoration, source verification, receipt
  undo, forced operation-log failure rollback, enforced FKs and closing/reopening SQLite.
- `pnpm exec vitest run packages/local-db/src/processing-unit-service.test.ts
  apps/desktop/src/shared/contract.test.ts packages/i18n/src/resources.test.ts --maxWorkers=2`:
  repository and IPC **297 passed**, i18n **1 failed** on dynamic IDs; fixed static message IDs.
- `pnpm exec vitest run packages/i18n/src/resources.test.ts
  apps/web/src/pages/source/PdfReader.test.tsx
  apps/web/src/pages/source/ProcessingUnitControls.test.tsx --maxWorkers=2`: **10 passed** after
  those fixes, including delayed restore, route replay, active-page commands and receipt undo.
- Biome check/format on modified TS/TSX/CSS files only; `git diff --check`: passed.

Deferred by user: whole-workspace typecheck/lint/test, Electron IPC/restart and real PDF/OCR
flows, light/dark and process-reader GUI checks, large-PDF performance. No app/server/player,
Electron, Windows switch, system configuration change, push or deployment was performed.

---

# T133 — Media segment states

- **Milestone:** M29 — Long-form geometry & re-entry
- **Status:** `[~]` 已实现并审查，统一验收待进行
- **Depends on:** T073, T074
- **Roadmap line:** audio/video sources track per-segment processed state (derived from
  playback and fragment extraction), feeding the same surfaces — "watched 40%, 2 segments
  deferred" is durable data, not memory.

## Goal

The media analog of T132: lectures and podcasts get durable per-segment state — watched
ranges, deferred segments, extracted fragments — so media sources stop being black boxes to
progress, Done breakdowns, yield, and scheduling.

## Context to load first

- Existing code: `MediaReader.tsx` (playback, timestamped read-point from T073), media-fragment
  extraction (T074 — start/end timestamps; fragments are the "extracted" lineage source),
  T132's generalized unit-key design (segments are time ranges; reuse the same row model with
  a time-range key — coordinate the schema so PDF and media don't fork the table shape),
  transcript availability (T073 — segment boundaries can follow transcript chunks when present,
  else fixed-length windows; document the rule).
- Invariants: same 7-state vocabulary; watched-state derives from actual playback coverage
  (player time-update accumulation, debounced + persisted main-side), never from scrubbing
  past; "extracted" derives from live fragment lineage.

## Deliverables

- [ ] Segment model: time-range rows per media source (transcript-chunk boundaries when
      available, else fixed windows ~2–5 min); playback coverage marks read; explicit verbs for
      ignore/needs-later per segment; fragments set extracted via lineage.
- [ ] Reader integration: a segment strip on the timeline (states color-coded per tokens);
      jump-to-deferred; the T130 briefing + T131 rail consume media segments unchanged.
- [ ] Consumers verified: progress, Done breakdown, yield read%, scheduler ratios for media
      sources (tests per consumer).
- [ ] Tests: unit (coverage accumulation math, segment derivation); e2e — play parts of a
      fixture video, defer a segment, extract a fragment, exit breakdown is honest, return
      briefing + rail work, restart-safe.

## Done when

- A media source reports honest segment-level progress in every surface documents and PDFs do;
  playback genuinely watched is what counts as read.
- Standard gates pass.

## Notes / risks

- Coverage writes are high-frequency — batch/debounce persistence (the read-point pattern
  already solves this; reuse its cadence).

---

## T133 Implementation And Basic Verification (2026-09-15)

Local commit: `T133: persist media segment states and playback coverage`.
Built after local T132 commit `05996f0`; all four M29 implementation checkpoints T130-T133
retain `[~]` pending the user's explicitly requested later unified verification.

- `media:segment:<startMs>` keys reuse T132's processing table, remainder composition, trusted
  commands and guarded receipt undo. Additive generated migration `0044_vengeful_mach_iv`
  adds only `source_media_playback`, with source FK, nullable duration, asset identity and a
  compact JSON union of actual played ranges. It does not rebuild existing tables or anchors.
- Current import code stores subtitle **starts only**, not cue ends. Segments begin at zero,
  target three minutes, and snap forward to the first subtitle start between three and five
  minutes after the prior boundary. Without such a cue, use three-minute windows. Boundaries
  are stable start-time keys; known duration clips the last segment without an empty trailing
  segment. Unknown duration expands only to observed coverage/cue starts and leaves one open
  tail. The open tail is unresolved and cannot be marked read, ignored or finished. Duration
  discovery closes it without claiming content changed; expansion reopens formerly read or
  terminal remainder. A deferral survives; shrinking preserves an explicit unread override.
- Local audio/video events are batched every two seconds (bounded 256-event batches), flushed
  on pause/end/unmount, and interpreted main-side by the pure `PlaybackCoverage` domain class.
  It accepts continuous movement bounded by elapsed monotonic time and playback rate, resets
  at seek/rate-change, and stops at pause/wait/end. Silent seek jumps, paused samples and long
  gaps contribute no coverage. Exact interval union preserves gaps and de-duplicates replay.
  Source/version-scoped opaque sessions enforce ordered, idempotent batches; transaction
  failure preserves both the durable union and event cursor for retry. Writes append
  `mediaPlayback.record_coverage` evidence inside an `update_document` operation transaction.
- A finite segment becomes read only after complete actual coverage. Explicit mark-read is
  also checked main-side; pending actions disable it before coverage exists. Read remains
  unresolved. Clip locations derive live output relationships by interval overlap, with the
  same conservative partial-output remainder rule as PDF. Source output totals de-duplicate
  clips spanning multiple segments so geometry changes cannot invent yield increments.
- Transcript and asset changes reconcile segment hashes, preserve original block/timestamp/
  clip anchors, and propagate needs_reverify across old and current segment ranges. Current
  geometry/version metadata is refreshed after propagation; user segment actions never clear
  output verification. New asset identity invalidates old playback coverage and live sessions.
- Trusted summary, Done gate, scheduler pressure, yield, T130 briefing and T131 pending rail
  consume media segments. Actual time coverage provides read%; unknown duration carries an
  explicit unknown indicator in the reader, briefing, yield table and inspector. Historical
  delta remains null. Compact token-colored segment buttons provide state and seek targets.
- Reader/source instances are keyed; explicit source/segment/cue jumps and playback win over
  delayed restore. Seeking does not force autoplay. An out-of-range route reports unavailable
  and falls back to a valid recorded position. The existing YouTube iframe has no player-event
  API: it explicitly reports tracking/seeking unavailable, records no invented coverage, and
  retains clip lineage and conservative segment/deferral data. No new remote player API or
  download integration was added. Chinese resources were updated without enabling Chinese.
- Independent review passed after fixes for automatic-read undo, cross-segment double counts,
  growing tails inheriting old read/terminal state, explicit-unread preservation, subtitle
  metadata/range reconciliation and unavailable route fallback. No remaining feature finding.

Actual basic checks (Node 22.20.0 / pnpm 9.12.1; Vitest always `--maxWorkers=2`):

- `pnpm db:generate`: generated the additive SQL, snapshot and journal entry.
- `pnpm exec vitest run packages/core/src/media-processing.test.ts
  packages/local-db/src/media-playback-service.test.ts --maxWorkers=2`: initial **6 passed**.
  Core's three cases cover exact union, playback discontinuities and segmentation.
- `pnpm exec vitest run packages/local-db/src/media-playback-service.test.ts
  packages/local-db/src/processing-unit-service.test.ts --maxWorkers=2`: final **13 passed**
  after shared reconciliation fixes (6 media + 7 PDF). Coverage includes source relations,
  complete-playback states, scheduler/Done/yield/briefing/pending, unknown tails, cross-boundary
  clips, subtitle edits, undo, forced log failure, retries and SQLite close/reopen.
- `pnpm exec vitest run packages/db/src/migration-0044-media-playback.test.ts
  apps/web/src/pages/source/MediaReader.test.tsx --maxWorkers=2`: **3 passed** at that stage.
  Migration asserts additive DDL, source FK, coverage JSON and duration constraints.
- `pnpm exec vitest run packages/local-db/src/media-playback-service.test.ts
  apps/web/src/pages/source/useMediaCoverage.test.tsx apps/desktop/src/shared/contract.test.ts
  packages/i18n/src/resources.test.ts --maxWorkers=2`: **298 passed**. IPC allowlist, static
  translations and failed-batch retry/unmount flushing verified; later repository edits are
  covered by the 13-case run above.
- Final MediaReader **3 passed**, including clip creation, playback boundary events,
  delayed-restore protection and unavailable route fallback. ProcessingUnitControls **2 passed**
  across focused runs (page commands/undo; unknown media progress, seek and open-tail guards).
  The added media-control test initially had a missing fixture order and exact text assertion
  including a separator; both test issues were corrected, with no production behavior change.
- Biome check/format on task-modified code files only and `git diff --check`: passed.
  After final optional-field cleanup, `pnpm exec vitest run
  packages/local-db/src/media-playback-service.test.ts -t 'persists exact coverage|closes a discovered tail'
  --maxWorkers=2` passed **2 / 4 not selected**; the three affected files passed Biome again.

Deferred by user: full unit suite/workspace typecheck/lint, Electron IPC and app restart,
real player/PDF/OCR interaction and timing, light/dark desktop layouts, large-collection and
long-session performance. No application, development server, Electron or real player was
started; no Windows switch, system configuration change, push, release or deployment.
T134 and other roadmap tasks were not started.

---

# T134 — Structural skim pass

- **Milestone:** M29 — Long-form geometry & re-entry
- **Status:** `[~]` 已实现并审查，统一验收待进行
- **Depends on:** T067, T132
- **Roadmap line:** long-form sources (PDF outline/TOC, EPUB chapters, long documents by
  heading) support a skim pass assigning per-section verdicts — extract-worthy / later /
  ignore — that bulk-set block states (one batch, one undo) and create per-section scheduling,
  so deep reading starts where the value is.

## Goal

The missing middle gear between 1,000 per-block micro-decisions and zero: first contact with a
long source is a pass over its STRUCTURE — triage the table of contents, kill the front matter,
prioritize chapter 7, defer chapter 2 — implementing the "skim and triage" step the product's
own concept doc has always named. Sections become the unit of intent; deep reading starts where
value is instead of at page 1.

## Implementation Rules (2026-09-15)

- Reuse T067 chapter `topic` elements. A section row binds a topic to canonical source units;
  PDF/document sections read live ranges rather than owning copied source text. EPUB sections
  reuse the existing chapter topic/body and spine location. Media skim is excluded.
- Queue ownership is by disjoint content ranges: an assigned live chapter owns its range even
  when deferred or terminal; the parent schedules only uncovered/unassigned content. When no
  unresolved remainder exists, parent due eligibility is suppressed without changing its
  lifecycle to done. The parent remains a readable aggregate/outline. Unassigned EPUB chapters
  remain reachable from that outline and count as parent remainder. Missing/invalidated ranges
  release ownership to the parent and remain visibly unavailable until reselected.
- Nested headings/bookmarks are displayed hierarchically. Selection of overlapping ranges in
  one batch, or overlap with a different existing chapter, is rejected transactionally. Reapply
  the same canonical range reuses its topic. Ranges include both boundary units; nested headings
  end immediately before the next heading of equal or higher level. PDFs use whole pages,
  including content before the first bookmark; fallback ranges and manual endpoints cover gaps.
- Source processing is canonical: chapter progress/Done use only their units, parent totals
  count each unit once, and existing extract/reverify anchors are retained. New/moved/removed
  range geometry invalidates its stored range fingerprint; source content edits continue through
  normal processing staleness. User decisions never clear output needs_reverify.
- Reapplying a deleted chapter's range restores the same topic and anchors. A new decision
  supersedes overlapping obsolete ownership permanently, including after source text restoration;
  the old chapter stays visibly unavailable. Its range fingerprint is restored by batch undo.
  Applying extract-worthy/later under a done, dismissed or suspended parent explicitly resumes
  the parent so the requested chapter return is eligible; undo restores the prior parent state.
- Batch changes carry one guarded receipt containing exact preimages and a post-apply
  fingerprint, and restore the whole batch in one transaction. Existing global undo must skip
  the batch's component operations so it cannot undo only chapter scheduling or priority.

These rules were recorded before building the skim UI. Final implementation/evidence follows
below; standard acceptance is deferred only under the user's explicit limited-check policy.

## Context to load first

- Existing code: structure sources — PDF outline/bookmarks (PDF.js outline API; fall back to
  heading-detection or page-range chunks when absent), EPUB chapters (T067 already creates
  chapter topics — reconcile: the skim pass should drive THAT machinery, not duplicate it),
  document headings (block tree); T132 page rows + T131 bulk state semantics (verdicts bulk-set
  underlying block/page/segment states in one `batchId`); `docs/domain-model.md` `topic` /
  `rough_topic` (the per-section schedulable unit — sections become child topic elements with
  their own priority + attention schedule); per-section read-points (the "one read-point per
  element" rule holds because sections ARE elements).
- Invariants: verdicts are bulk block-state ops + child-element creation in ONE transaction with
  undo; section elements carry full lineage (source + block/page range); the global source
  schedule and section schedules must not double-surface (decide the rule: a source with
  sectioned children schedules through its sections; the parent becomes a container — document
  and test queue eligibility accordingly, per the backend-canonical-eligibility pattern).

## Deliverables

- [ ] Structure extraction: a per-source outline (PDF outline → page ranges; EPUB chapters;
      document headings → block ranges), with a manual fallback (select a range → "make
      section").
- [ ] Skim surface: outline view with per-section verdict chips — extract-worthy (priority +
      schedule as child section-topic) / later (deferred section, returns via scheduling) /
      ignore (blocks/pages set ignored) — keyboard-first, one batch, one undo.
- [ ] Per-section scheduling: verdict-created sections are attention-scheduled child elements
      (priority inherited/adjustable), each with its own read-point; queue rows show
      "section of <source>"; parent/child surfacing rule implemented + tested.
- [ ] Done-gate integration: section terminal actions route through the DoneIntentMenu with the
      section's own breakdown; the parent's breakdown aggregates sections.
- [ ] Tests: unit (outline extraction per format, verdict batch semantics, surfacing rule);
      e2e — import a fixture PDF with an outline, run a skim pass (mixed verdicts), queue
      surfaces the extract-worthy section first, ignored front matter never surfaces,
      restart-safe.

## Done when

- A 300-page fixture book is triaged at the TOC in under a minute of verdicts; sections
  schedule independently with honest lineage and read-points; ignored matter disappears from
  pressure; one undo reverses a whole skim pass.
- Standard gates pass.

## Notes / risks

- Reconcile with T067's chapter topics FIRST (read its spec + code) — the likely design is
  "skim pass = the verdict UI over the existing chapter-topic machinery, generalized to PDF +
  documents". Do not ship two section concepts.
- Surface-ownership lesson applies (the one reverted decision in `docs/solutions/`): settle the
  parent-vs-section queue-surfacing rule in the spec BEFORE building UI.

## T134 Implementation And Basic Verification (2026-09-15)

Local commit: `T134: add structural skim and chapter scheduling`.
This is the user-authorized implementation/review checkpoint. T130-T133 remain `[~]`, and
standard unified verification is explicitly deferred.

- `SourceStructureService` resolves document heading ranges, T067 EPUB spine chapter topics,
  and PDF bookmark pages supplied by trusted PDF.js extraction. Missing structure falls back
  to 30-block or 20-page ranges. Manual inclusive endpoints create arbitrary valid ranges.
  Nested headings/bookmarks retain depth; duplicate identical page ranges collapse and
  overlapping selections are rejected before mutation. Initial unheaded content is retained.
- Additive Drizzle migration `0045_ordinary_mentallo` binds existing topic Elements to source,
  canonical document, ordered units, range fingerprint and verdict. It keeps original EPUB
  chapter documents/locations and PDF/document source text, with no copied chapter text model.
  Existing extraction anchors remain intact; chapter topics never count as knowledge outputs.
- Extract-worthy schedules a chapter now, later schedules seven days ahead, and ignore marks
  the range ignored and removes its scheduling pressure. Priority-only updates preserve prior
  processing and due dates. Chapters own disjoint ranges; the parent retains uncovered work,
  including invalidated/removed stale content. Fully owned parents leave the due queue without
  being marked done. Terminal chapters release newly stale work back to the parent.
- Each apply/finish batch includes chapter, relationship, processing and schedule writes plus
  operation logs in one transaction. Guarded stored receipts restore the whole batch, including
  a resumed parent or restored deleted topic. Later content, outputs, tags, marks, relations,
  read-points and assets prevent undo from overwriting user work. Global undo skips component
  operations of a skim batch. No source verification flag is cleared by a skim verdict.
- The compact collapsible skim list uses native keyboard-operable selects and buttons, existing
  tokens/icons and static i18n strings. Chapter readers support scoped PDF pages or document
  blocks, extraction, independent read-points, deferred navigation and their own DoneIntentMenu.
  Queue rows identify the parent and open the chapter reader. Explicit targets precede delayed
  restore; source-keyed hosts discard old responses. Invalid ranges report unavailable.
- Parent progress, Done, yield and attention pressure reuse canonical block/unit folds. Pending
  passages and re-entry targets can open their chapter; EPUB deleted blocks remain counted but
  unlocatable. Parent briefing history includes actual chapter reading/extraction evidence;
  historical read-percentage delta remains unknown. Chinese remains disabled.
- Independent actual-diff review found and verified fixes for priority-only resets, stale route
  restoration, PDF reloads, undo guards, EPUB reuse/anchors, parent/child queue ownership,
  terminal actions and receipt transport, terminal-parent returns, deleted-topic reuse,
  obsolete-range reactivation, removed-block navigation and raw enum labels. Final incremental
  review includes the EPUB briefing aggregation fix. No unresolved feature finding remains.

Actual basic verification, using command-local Node 22.20.0 / pnpm 9.12.1 in WSL2 on `main`:

- `pnpm exec vitest run packages/local-db/src/source-structure-service.test.ts
  packages/db/src/migration-0045-source-sections.test.ts
  apps/web/src/pages/source/StructuralSkim.test.tsx
  apps/web/src/pages/source/SectionReader.test.tsx --maxWorkers=2`: **13 passed / 1 failed**.
  The new EPUB deletion case omitted the normal save transaction's reconciliation call.
  It now uses `upsertWithin` plus `reconcileSourceDocumentWithin`, matching `DbService`.
- `pnpm exec vitest run packages/local-db/src/source-structure-service.test.ts
  -t 'reuses EPUB chapter' --maxWorkers=2`: **1 passed / 10 not selected**, including the final
  briefing assertions. Together with unchanged passed cases, all **11 repository cases** pass.
  Coverage includes structure boundaries, repeat/soft-delete reuse, range restoration, mixed
  batches, real due-queue projection, terminal-parent returns, guarded undo, operation-log
  failure rollback, preserved lineage, and closing/reopening a file-backed SQLite database.
- The migration case passes additive-DDL and enforced foreign-key checks. Schema/DDL also
  declare the unique range index and JSON/verdict constraints; the test does not independently
  claim to exercise every constraint. Both skim/section-reader simulated interaction cases pass.
- `pnpm exec vitest run apps/web/src/pages/source/PdfReader.test.tsx
  apps/web/src/pages/queue/openQueueItem.test.ts packages/i18n/src/resources.test.ts
  --maxWorkers=2`: **17 passed**. Covers scoped pages, stable PDF refresh, independent read-point,
  direct chapter opening, delayed navigation and static translation resources.
- `pnpm exec vitest run apps/desktop/src/shared/contract.test.ts -t 'IPC channels'
  --maxWorkers=2`: **2 passed / 289 not selected**. After adding the focused T134 schema case,
  the same file with `-t 'bounds T134' --maxWorkers=2`: **1 passed / 291 not selected**.
- `git ls-files --modified --others --exclude-standard -z | xargs -0 pnpm exec biome check
  --write --files-ignore-unknown=true`: only task-modified files formatted/checked successfully.
  Final check without `--write` and `git diff --check` also pass.

Deferred: whole-workspace lint/typecheck/tests, Electron IPC and application restart, real PDF
bookmark/EPUB import and extraction flows, light/dark GUI and keyboard ergonomics, 300-page
triage timing and large-collection performance. Basic SQLite reopen is not an Electron restart.
No application, development server, real player, Electron or full benchmark was started; no
Windows switch, system configuration change, push, release or deployment was performed.
