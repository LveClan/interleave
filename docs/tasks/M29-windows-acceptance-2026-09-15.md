# M29 Windows Functional Acceptance (2026-09-15)

Scope: T130-T134 functional acceptance on native Windows, following the Linux
basic-check repairs and Windows environment/build/start verification. Baseline:
`a56b456`. Application data is isolated in temporary E2E directories. The real
user database was not opened or modified.

## Environment And Review

- Windows checkout: `D:\CODE\interleave`, Windows 11 x64, native Node `22.23.2`,
  pnpm `9.12.1`, Electron `39.8.10`, native Node/Electron SQLite binaries.
- Source edits and Linux checks: `/home/lilis/LveClanCode/interleave`, Node
  `22.20.0`, pnpm `9.12.1`. Only task-owned source files were copied between
  checkouts; platform dependencies and native binaries remain separate.
- All Electron runs use `--project=electron --workers=1`, launched through
  `node scripts/desktop.mjs pnpm exec playwright test`. `E2E_BASE_URL` is set to
  avoid starting the unrelated renderer-only server; Electron loads built `app://`.
- Original implementation independent reviews remain recorded in the milestone
  spec. During acceptance the user explicitly required one agent and prohibited
  further workers. The initial three test authors were stopped. Subsequent fixes,
  execution and final diff review were performed by the coordinating agent alone;
  this acceptance review is self-review, not a new independent review.

## Acceptance Evidence

| Task | Windows coverage |
| --- | --- |
| T130 | Existing `source-return-briefing.spec.ts`: casual/queue/process entry gates, current counts and unknown history, dismiss, both jumps, invalid IPC rejection, light/dark/900px screenshots and restart. |
| T131 | `source-pending.spec.ts`: defer two paragraphs through the UI, compare Done/rail/briefing/durable counts, keyboard navigation, resume read/unread, receipt undo, process reader and restart. Read remains unresolved. Foreign-key integrity and operation-log writes checked. |
| T132 | `pdf-processing.spec.ts`: real PDF pages and pixels, explicit page decisions, text and region outputs with unresolved remainder, Done/yield/briefing/pending consistency, receipt undo, process-to-full-reader entry and restart. Real local WASM OCR changes a page and flags its live output without changing lineage. A 1000-page PDF is imported into the M20 scale fixture, scrolled to the last page and reopened after restart. |
| T133 | `media-processing.spec.ts`: real local VP8 video and MP3 playback, decoded moving/color pixels, pauses and seeks without invented coverage, segment decisions and undo, cross-segment clip counted once, Done/scheduling/yield/briefing, process entry, source-location/operation-log integrity and restart. Uses committed 184-second media; the test plays selected intervals in real time. |
| T134 | `structural-skim.spec.ts`: real 300-page PDF outline, mixed verdicts, priority, chapter queue and parent exclusion, complete batch undo, chapter read-point/Done and restart. EPUB reuses original chapter topics and preserves extraction lineage. Document headings and manual ranges prove atomic overlap rejection and disjoint scheduling. |

The unified Windows acceptance invocation passed **10/10**, zero skipped/flaky,
in **181.46 seconds**. Later PDF navigation/alignment changes have passing
affected-file and related-flow reruns. The final EPUB chapter selection-action
and extraction/restart rerun passed (1/1, 7.1 seconds).

Related Electron regression covered media import/clip, PDF import/region,
processed paragraphs and the source reader. The initial run had 23 passes, an
old region-drag coordinate failure, a timing-scope failure and one dependent
test not run. After repair, all five PDF import/region/restart tests and the
1000-page acceptance passed together (6/6). The PDF/media process-entry rerun
passed 2/2. These are combined final evidence, not a claim that the initial
regression invocation succeeded.

## Repairs

- PDF pages were flex-shrunk from their measured height (1109px to 130px in the
  reproduced two-page case), preventing correct scroll/page actions. Pages now
  retain their geometry. Narrow readers preserve a usable scroll area and safe
  horizontal alignment; programmatic jumps update the header page count.
- Offscreen PDF canvases/text layers are released, in-flight render tasks are
  cancelled, and returning pages render again. Distinct sibling keys avoid
  undefined React reconciliation between skim and processing controls.
- Windows media could load metadata but failed real playback with
  `FFmpegDemuxer: data source error`. Registering `media` with standard URL
  semantics enables Chromium's subsequent range reads. URLs still contain only
  canonical element ids; main resolves the asset vault path.
- Narrow media readers stack video and transcript, allow toolbar wrapping and
  retain usable player dimensions. Pixel/screenshot checks confirm actual media.
- Chapter toolbar mouse-down handlers preserve selection through the global
  selection-dismiss listener, so extraction, read-point and state actions use the
  selected passage.
- FSRS card summaries no longer run chapter ownership reads. Parent remainder
  checks validate each chapter once per query and reuse its unit set instead of
  repeating content/ownership scans for every page. Existing eligibility,
  stale-range, undo and transaction tests are retained.
- Test fixes use current selectors/contracts, explicit due scheduling, read-point
  block-to-page mappings, unambiguous select values, and crop coordinates inside
  the visible viewport. A native subtitles picker is provided a fixture in the
  audio test to avoid waiting for a real dialog.

## Performance

The 300-page/15-section mixed-verdict pass took **3533ms**, excluding fixture
generation, import and initial outline load. The complete PDF chapter test took
about **24 seconds** after the ownership fix, including undo and restart.

The final 1000-page run imported in **8853ms**, opened in **6445ms**, and retained
only the current canvas window. Ten measured samples follow one warm-up:

| Path | p50 (ms) | p95 (ms) | Budget (ms) |
| --- | ---: | ---: | ---: |
| Processing units | 79.5 | 124.9 | 2000 |
| Processing summary | 20.3 | 27.0 | 2000 |
| Source yield | 272.9 | 602.7 | 10000 |
| Queue read | 3187.0 | 3485.2 | 4000 |

Queue measurement fixes `asOf`, matching the existing M20 read benchmark and
excluding the separate daily-policy materialization workflow. An earlier
measurement included policy execution and exceeded 4000ms; it is not counted
as a passing queue benchmark. No budget was increased.

## Final Checks

- Root `pnpm lint`: passed, with existing and fixture non-null-assertion warnings.
- Root `pnpm typecheck`: 15/15 packages passed.
- Root `pnpm test -- --maxWorkers=1`: **5021 passed, 2 failed**, 475/476 files,
  604.33 seconds. Both failures were asynchronous assertions in
  `SourceReader.test.tsx`: delete before inspector readiness and querying the
  original URL before provenance loaded. Fixes wait for those states. Duplicate
  skim/pending sibling keys were also removed from the text reader.
- Final `pnpm exec vitest run apps/web/src/pages/source/SourceReader.test.tsx
  apps/web/src/pages/source/SectionReader.test.tsx --maxWorkers=1`: **34/34 passed**.
  Combined with unchanged full-run results, all **5023 tests across 476 files**
  have passing evidence on the final implementation. The earlier full invocation
  did not itself exit successfully.
- Changed repository/protocol tests and PDF lifecycle tests have passing focused
  evidence; final chapter state-action Electron check passed.
- Final text-reader key changes: Windows briefing/pending rerun **2/2 passed**.
- Closeout self-review compared 1369 app/package/test/design files with the Windows
  checkout. Runtime source content agrees; media protocol differences were comments
  and formatting, and the remaining differences were unit tests and `CLAUDE.md`
  symlink representations.
- Closeout focused rerun initially found one equivalent readiness race in the
  video-reader provenance test (**102 passed, 1 failed**). Waiting for the source
  link before asserting its URL fixed it. Final rerun of `SourceReader`,
  `SectionReader`, `PdfReader`, media protocol, queue query and source structure
  tests passed **103/103 across six files** in 15.28 seconds. This test-only fix
  preserves the existing Windows runtime evidence and the combined 5023-test result.
- Closeout root `pnpm lint`: passed (31 non-null-assertion warnings);
  `pnpm typecheck`: **15/15 packages passed**. Closeout logs use
  `/tmp/interleave-m29-closeout-*.log`.
- `git diff --check`: passed.

Local logs and screenshots are under `D:\CODE\interleave\.interleave\m29-*`
and `.interleave/m29-results/`; Linux check logs are `/tmp/interleave-m29-*.log`.
These paths describe local evidence, not portable repository assets. The test
files reproduce the acceptance using isolated data.

## Acceptance Commits

| Task | Local acceptance commit |
| --- | --- |
| T130 | `c5e0551` (`T130: 完成来源重返摘要的 Windows 验收`) |
| T131 | `ef45f90` (`T131: 完成待处理段落的 Windows 验收`) |
| T132 | `7556b4d` (`T132: 完成 PDF 处理状态与千页规模验收`) |
| T133 | `e2286ee` (`T133: 完成媒体播放覆盖的 Windows 验收`) |
| T134 | `T134: 完成结构略读与章节调度验收` (this commit) |

All five task statuses and deliverable checklists reflect functional acceptance.
The earlier implementation/basic-check notes retain their historical scope;
their deferred checks are superseded by this record. Commits are local only.

## Scope Limits

This is functional acceptance of the native Windows desktop source build.
Installer packaging, signing, publishing, external YouTube playback control and
live model-backed search are outside this milestone. Media coverage for embedded
players remains explicitly unavailable as recorded in T133's implementation.
Long media time spans are tested with bounded real playback and domain coverage
logic; this is not a many-hour unattended playback endurance run. Existing CSS
highlight/chunk-size build warnings remain unrelated to these acceptance fixes.
