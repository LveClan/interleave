import { createHash } from "node:crypto";
import type {
  BlockId,
  ElementId,
  SourceBlockOutputType,
  SourceBlockProcessingDerivation,
  SourceBlockProcessingState,
  SourceBlockProcessingSummary,
  SourceBlockProcessingView,
  SourceBlockReconcileReport,
} from "@interleave/core";
import {
  coveredTime,
  isTerminalSourceBlockProcessingState,
  priorityToLabel,
} from "@interleave/core";
import {
  documentBlocks,
  documents,
  elementReverifyProvenance,
  elements,
  type InterleaveDatabase,
} from "@interleave/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import { newRowId } from "./ids";
import { mediaProcessingData } from "./media-processing-repository";
import { ProcessingUnitRepository } from "./processing-unit-repository";
import { ReverifyPropagationRepository } from "./reverify-propagation-repository";
import { SourceSectionRepository } from "./source-section-repository";
import type { DbClient } from "./types";

interface PmNode {
  readonly type?: string;
  readonly text?: string;
  readonly attrs?: { readonly blockId?: unknown; readonly alt?: unknown; readonly title?: unknown };
  readonly content?: readonly PmNode[];
}

const ROW_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "codeBlock",
  "image",
  "horizontalRule",
]);

function shouldCarryBlockId(type: string, parentType?: string): boolean {
  if (!ROW_BLOCK_TYPES.has(type)) return false;
  if ((parentType === "listItem" || parentType === "blockquote") && type !== "listItem") {
    return false;
  }
  return true;
}

function nodeText(node: PmNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") {
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    const title = typeof node.attrs?.title === "string" ? node.attrs.title : "";
    return `${alt} ${title}`.trim();
  }
  return (node.content ?? []).map(nodeText).join(" ");
}

function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function computeBlockContentHashes(doc: unknown): Map<BlockId, string> {
  return new Map([...computeBlockTexts(doc)].map(([id, text]) => [id, hashText(text)]));
}

export function computeBlockTexts(doc: unknown): Map<BlockId, string> {
  const texts = new Map<BlockId, string>();
  if (!doc || typeof doc !== "object") return texts;
  const visit = (node: PmNode, parentType?: string): void => {
    const type = node.type ?? "";
    if (shouldCarryBlockId(type, parentType)) {
      const blockId = node.attrs?.blockId;
      if (typeof blockId === "string" && blockId.length > 0) {
        texts.set(blockId as BlockId, normalizeBlockText(nodeText(node)));
      }
    }
    for (const child of node.content ?? []) visit(child, type);
  };
  visit(doc as PmNode);
  return texts;
}

export interface MarkBlockInput {
  readonly sourceElementId: ElementId;
  readonly stableBlockId: BlockId;
  readonly blockContentHash?: string | null;
}

export interface DeriveExtractionInput {
  readonly sourceElementId: ElementId;
  readonly outputElementId: ElementId;
  readonly outputType: SourceBlockOutputType;
  readonly sourceLocationId: string | null;
  readonly blockIds: readonly BlockId[];
}

export interface DoneGateResult {
  readonly canMarkDone: boolean;
  readonly unresolvedBlocks: number;
  readonly staleAfterEditBlocks: number;
  readonly highPriorityUnresolvedBlocks: number;
}

export class BlockProcessingService {
  private readonly repo: BlockProcessingRepository;
  private readonly reverify: ReverifyPropagationRepository;

  constructor(private readonly db: InterleaveDatabase) {
    this.repo = new BlockProcessingRepository(db);
    this.reverify = new ReverifyPropagationRepository(db);
  }

  markBlockIgnored(input: MarkBlockInput): SourceBlockProcessingView {
    return this.markExplicit(input, "ignored", "mark_ignored");
  }

  markBlockProcessed(input: MarkBlockInput): SourceBlockProcessingView {
    return this.markExplicit(input, "processed_without_output", "mark_processed_without_output");
  }

  markBlockNeedsLater(input: MarkBlockInput): SourceBlockProcessingView {
    return this.markExplicit(input, "needs_later", "mark_needs_later");
  }

  markBlockUnread(input: MarkBlockInput): SourceBlockProcessingView {
    return this.markExplicit(input, "unread", "mark_unread");
  }

  private markExplicit(
    input: MarkBlockInput,
    state: SourceBlockProcessingState,
    action: "mark_ignored" | "mark_processed_without_output" | "mark_needs_later" | "mark_unread",
  ): SourceBlockProcessingView {
    const blockContentHash =
      input.blockContentHash === undefined
        ? this.computeCurrentBlockHash(input.sourceElementId, input.stableBlockId)
        : input.blockContentHash;
    this.db.transaction((tx) => {
      this.requireSourceElement(tx, input.sourceElementId);
      this.requireBlock(tx, input.sourceElementId, input.stableBlockId);
      if (state !== "extracted") {
        this.requireNoLiveOutputs(input.sourceElementId, input.stableBlockId);
      }
      this.repo.upsertStateWithin(tx, {
        ...input,
        blockContentHash,
        state,
        action,
      });
    });
    return this.getBlockView(input.sourceElementId, input.stableBlockId);
  }

  deriveBlockStateFromExtractionWithin(tx: DbClient, input: DeriveExtractionInput): void {
    this.requireSourceElement(tx, input.sourceElementId);
    const blockHashes = this.computeCurrentBlockHashes(input.sourceElementId);
    for (const blockId of input.blockIds) {
      this.requireBlock(tx, input.sourceElementId, blockId);
      this.repo.upsertStateWithin(tx, {
        sourceElementId: input.sourceElementId,
        stableBlockId: blockId,
        state: "extracted",
        action: "mark_extracted",
        blockContentHash: blockHashes.get(blockId) ?? null,
        metadata: { outputElementId: input.outputElementId },
      });
      this.repo.addOutputWithin(tx, {
        sourceElementId: input.sourceElementId,
        stableBlockId: blockId,
        outputElementId: input.outputElementId,
        outputType: input.outputType,
        sourceLocationId: input.sourceLocationId,
      });
    }
  }

  reconcileSourceDocumentWithin(
    tx: DbClient,
    sourceElementId: ElementId,
    prosemirrorJson: unknown,
  ): SourceBlockReconcileReport {
    this.requireSourceElement(tx, sourceElementId);
    const report = this.repo.reconcileStaleWithin(
      tx,
      sourceElementId,
      computeBlockContentHashes(prosemirrorJson),
    );
    // T123 — propagate the dirty bit downstream in the SAME transaction. A single
    // batchId groups this run's flag flips so they audit + (T124) undo as one unit.
    if (report.staled.length > 0 || report.unStaled.length > 0) {
      this.reverify.propagateReverify(tx, sourceElementId, report, newRowId());
    }
    return report;
  }

  getBlockView(sourceElementId: ElementId, stableBlockId: BlockId): SourceBlockProcessingView {
    const view = this.listBlockViews(sourceElementId).find(
      (row) => row.stableBlockId === stableBlockId,
    );
    if (!view) throw new Error(`BlockProcessingService: block ${stableBlockId} not found`);
    return view;
  }

  listBlockViews(sourceElementId: ElementId, canonical = false): SourceBlockProcessingView[] {
    const sections = new SourceSectionRepository(this.db);
    if (!canonical) {
      const section = sections.find(sourceElementId);
      if (section && section.documentId !== sourceElementId) {
        const ids = new Set<string>(JSON.parse(section.unitIds));
        return this.listBlockViews(section.documentId as ElementId, true).filter((v) =>
          ids.has(v.stableBlockId),
        );
      }
      const chapters = sections.epubChapters(sourceElementId);
      if (chapters)
        return chapters.flatMap((chapter) =>
          this.listBlockViews(chapter.topic.id as ElementId, true),
        );
    }
    this.requireSourceElement(this.db, sourceElementId);
    const units = new ProcessingUnitRepository(this.db).views(sourceElementId);
    if (units) return units;
    const blocks = this.repo.listSourceBlocks(sourceElementId);
    const rows = new Map(
      this.repo.listRows(sourceElementId).map((row) => [row.stableBlockId, row]),
    );
    const currentBlockIds = new Set(blocks.map((block) => block.stableBlockId));
    const currentHashes = this.computeCurrentBlockHashes(sourceElementId);
    const readPointOrder = this.repo.getReadPointOrder(sourceElementId);
    const outputsByBlock = new Map<BlockId, ElementId[]>();
    for (const output of this.repo.listLiveOutputs(sourceElementId)) {
      const list = outputsByBlock.get(output.stableBlockId) ?? [];
      list.push(output.outputElementId);
      outputsByBlock.set(output.stableBlockId, list);
    }

    const views = blocks.map((block) => {
      const row = rows.get(block.stableBlockId) ?? null;
      const outputElementIds = outputsByBlock.get(block.stableBlockId) ?? [];
      let state: SourceBlockProcessingState;
      let derivedFrom: SourceBlockProcessingDerivation;
      if (row?.state === "stale_after_edit") {
        state = "stale_after_edit";
        derivedFrom = "explicit";
      } else if (outputElementIds.length > 0) {
        state = "extracted";
        derivedFrom = "explicit";
      } else if (row && row.state !== "extracted") {
        state = row.state;
        derivedFrom = "explicit";
      } else if (readPointOrder != null && block.order <= readPointOrder) {
        state = "read";
        derivedFrom = "read_point";
      } else {
        state = "unread";
        derivedFrom = "missing";
      }
      return {
        sourceElementId,
        stableBlockId: block.stableBlockId,
        order: block.order,
        state,
        storedState: row?.state ?? null,
        blockContentHash: row?.blockContentHash ?? currentHashes.get(block.stableBlockId) ?? null,
        outputElementIds,
        derivedFrom,
      };
    });

    let missingOrder = blocks.length;
    for (const row of rows.values()) {
      if (currentBlockIds.has(row.stableBlockId) || row.state !== "stale_after_edit") continue;
      views.push({
        sourceElementId,
        stableBlockId: row.stableBlockId,
        order: missingOrder++,
        state: "stale_after_edit",
        storedState: row.state,
        blockContentHash: row.blockContentHash,
        outputElementIds: outputsByBlock.get(row.stableBlockId) ?? [],
        derivedFrom: "explicit",
      });
    }

    return views;
  }

  /**
   * Batched (perf U10) read-only block views for many sources at once. Mirrors
   * {@link listBlockViews} per source but resolves every underlying read with one
   * grouped `IN (sourceIds)` pass, returning a `Map<ElementId, …views>`.
   *
   * Unlike {@link listBlockViews}, this does NOT call `requireSourceElement`: it is a
   * pure read projection over whatever `sourceIds` the caller passes (the caller is
   * responsible for scoping to live sources). A stale / soft-deleted / non-source id
   * simply yields an empty view list instead of throwing — so one stale id can never
   * crash a whole-library rollup (see
   * `docs/solutions/runtime-errors/block-processing-stale-source-ids-zero-summary.md`).
   * Mutation paths keep the strict `requireSourceElement` guard.
   */
  listBlockViewsForMany(
    sourceIds: readonly ElementId[],
  ): Map<ElementId, SourceBlockProcessingView[]> {
    const result = new Map<ElementId, SourceBlockProcessingView[]>();
    if (sourceIds.length === 0) return result;

    const blocksBySource = this.repo.listSourceBlocksForMany(sourceIds);
    const rowsBySource = this.repo.listRowsForMany(sourceIds);
    const readPointOrderBySource = this.repo.getReadPointOrderForMany(sourceIds);
    const outputsBySource = this.repo.listLiveOutputsForMany(sourceIds);

    for (const sourceElementId of sourceIds) {
      const sections = new SourceSectionRepository(this.db);
      if (sections.find(sourceElementId) || sections.epubChapters(sourceElementId)) {
        result.set(sourceElementId, this.listBlockViews(sourceElementId));
        continue;
      }
      const units = new ProcessingUnitRepository(this.db).views(sourceElementId);
      if (units) {
        result.set(sourceElementId, units);
        continue;
      }
      const blocks = blocksBySource.get(sourceElementId) ?? [];
      const currentHashes = blocks.length
        ? this.computeCurrentBlockHashes(sourceElementId)
        : new Map<BlockId, string>();
      const rows = new Map(
        (rowsBySource.get(sourceElementId) ?? []).map((row) => [row.stableBlockId, row]),
      );
      const currentBlockIds = new Set(blocks.map((block) => block.stableBlockId));
      const readPointOrder = readPointOrderBySource.get(sourceElementId) ?? null;
      const outputsByBlock = new Map<BlockId, ElementId[]>();
      for (const output of outputsBySource.get(sourceElementId) ?? []) {
        const list = outputsByBlock.get(output.stableBlockId) ?? [];
        list.push(output.outputElementId);
        outputsByBlock.set(output.stableBlockId, list);
      }

      const views = blocks.map((block) => {
        const row = rows.get(block.stableBlockId) ?? null;
        const outputElementIds = outputsByBlock.get(block.stableBlockId) ?? [];
        let state: SourceBlockProcessingState;
        let derivedFrom: SourceBlockProcessingDerivation;
        if (row?.state === "stale_after_edit") {
          state = "stale_after_edit";
          derivedFrom = "explicit";
        } else if (outputElementIds.length > 0) {
          state = "extracted";
          derivedFrom = "explicit";
        } else if (row && row.state !== "extracted") {
          state = row.state;
          derivedFrom = "explicit";
        } else if (readPointOrder != null && block.order <= readPointOrder) {
          state = "read";
          derivedFrom = "read_point";
        } else {
          state = "unread";
          derivedFrom = "missing";
        }
        return {
          sourceElementId,
          stableBlockId: block.stableBlockId,
          order: block.order,
          state,
          storedState: row?.state ?? null,
          blockContentHash: row?.blockContentHash ?? currentHashes.get(block.stableBlockId) ?? null,
          outputElementIds,
          derivedFrom,
        };
      });

      let missingOrder = blocks.length;
      for (const row of rows.values()) {
        if (currentBlockIds.has(row.stableBlockId) || row.state !== "stale_after_edit") continue;
        views.push({
          sourceElementId,
          stableBlockId: row.stableBlockId,
          order: missingOrder++,
          state: "stale_after_edit",
          storedState: row.state,
          blockContentHash: row.blockContentHash,
          outputElementIds: outputsByBlock.get(row.stableBlockId) ?? [],
          derivedFrom: "explicit",
        });
      }

      result.set(sourceElementId, views);
    }
    return result;
  }

  /**
   * Batched (perf U10) per-source processing summary map. Folds
   * {@link listBlockViewsForMany} into the same {@link SourceBlockProcessingSummary}
   * shape {@link getSourceProcessingSummary} produces single-source, sharing the fold
   * via {@link summarizeViews}. Stale-tolerant like {@link listBlockViewsForMany}: an
   * id with no live source / no blocks yields the empty zero-summary, never a throw.
   * The reverify-output count is resolved only for sources that actually have a
   * `stale_after_edit` block (mirroring the single-source skip on the clean path).
   */
  getSourceProcessingSummaryForMany(
    sourceIds: readonly ElementId[],
  ): Map<ElementId, SourceBlockProcessingSummary> {
    const result = new Map<ElementId, SourceBlockProcessingSummary>();
    if (sourceIds.length === 0) return result;
    const viewsBySource = this.listBlockViewsForMany(sourceIds);
    const priorityBySource = this.repo.sourcePriorityForMany(sourceIds);
    for (const sourceElementId of sourceIds) {
      const views = viewsBySource.get(sourceElementId) ?? [];
      result.set(
        sourceElementId,
        this.summarizeViews(sourceElementId, views, priorityBySource.get(sourceElementId) ?? null),
      );
    }
    return result;
  }

  getSourceProcessingSummary(sourceElementId: ElementId): SourceBlockProcessingSummary {
    const views = this.listBlockViews(sourceElementId);
    const priority = this.repo.sourcePriority(sourceElementId);
    return this.summarizeViews(sourceElementId, views, priority);
  }
  getAttentionProcessingSummary(sourceElementId: ElementId): SourceBlockProcessingSummary {
    const sections = new SourceSectionRepository(this.db);
    const owned = new Set(
      sections
        .list(sourceElementId)
        .filter(({ section }) => sections.valid(section) && sections.activeOwnership(section))
        .flatMap(({ section }) =>
          (JSON.parse(section.unitIds) as string[]).map((id) => `${section.documentId}:${id}`),
        ),
    );
    const views = this.listBlockViews(sourceElementId).filter(
      (view) => !owned.has(`${view.sourceElementId}:${view.stableBlockId}`),
    );
    return this.summarizeViews(sourceElementId, views, this.repo.sourcePriority(sourceElementId));
  }

  /**
   * The shared {@link SourceBlockProcessingSummary} fold over a source's resolved
   * block views — used by both {@link getSourceProcessingSummary} (single-source) and
   * {@link getSourceProcessingSummaryForMany} (batched) so the two paths can never
   * drift. The reverify-output count is resolved per source ONLY when the source has
   * a `stale_after_edit` block (the existing hot-path skip).
   */
  private summarizeViews(
    sourceElementId: ElementId,
    views: readonly SourceBlockProcessingView[],
    priority: number | null,
  ): SourceBlockProcessingSummary {
    const highPrioritySource =
      priority != null && (priorityToLabel(priority) === "A" || priorityToLabel(priority) === "B");
    const stateCounts = {
      unread: 0,
      read: 0,
      extracted: 0,
      ignored: 0,
      processed_without_output: 0,
      needs_later: 0,
      stale_after_edit: 0,
    } satisfies Record<SourceBlockProcessingState, number>;
    let terminalBlocks = 0;
    let unresolvedBlocks = 0;
    let extractedOutputCount = 0;
    for (const view of views) {
      stateCounts[view.state]++;
      extractedOutputCount += view.outputElementIds.length;
      if (isTerminalSourceBlockProcessingState(view.state)) terminalBlocks++;
      else unresolvedBlocks++;
    }
    const totalBlocks = views.length;
    const ignoredBlocks = stateCounts.ignored;
    const extractedBlockCount = views.filter((view) => view.outputElementIds.length > 0).length;
    const media = mediaProcessingData(this.db, sourceElementId);
    if (views.some((view) => view.geometry))
      extractedOutputCount = new Set(views.flatMap((view) => view.outputElementIds)).size;
    return {
      ...(media
        ? {
            playbackReadPct:
              media.durationMs == null
                ? null
                : coveredTime(media.coverage, { startMs: 0, endMs: media.durationMs }) /
                  media.durationMs,
          }
        : {}),
      sourceElementId,
      totalBlocks,
      processedBlocks: terminalBlocks,
      terminalBlocks,
      unresolvedBlocks,
      highPriorityUnresolvedBlocks: highPrioritySource ? unresolvedBlocks : 0,
      extractedBlockCount,
      extractedOutputCount,
      ignoredBlocks,
      ignoredRatio: totalBlocks === 0 ? 0 : ignoredBlocks / totalBlocks,
      terminalRatio: totalBlocks === 0 ? 1 : terminalBlocks / totalBlocks,
      staleAfterEditBlocks: stateCounts.stale_after_edit,
      // Provenance rows exist ONLY for currently-stale blocks (created on stale, deleted
      // on un-stale), so a source with zero stale blocks can have no reverify outputs —
      // skip the count query on the common clean-source summary read (a hot path).
      needsReverifyOutputs: (() => {
        const section = new SourceSectionRepository(this.db).find(sourceElementId);
        const chapters = new SourceSectionRepository(this.db).epubChapters(sourceElementId);
        if (!section && !chapters) return this.reverify.countLiveReverifyOutputs(sourceElementId);
        const keys = new Set(views.map((v) => `${v.sourceElementId}:${v.stableBlockId}`));
        const docs = [...new Set(views.map((v) => v.sourceElementId))];
        if (!docs.length) return 0;
        return new Set(
          this.db
            .select({
              id: elementReverifyProvenance.elementId,
              source: elementReverifyProvenance.sourceElementId,
              block: elementReverifyProvenance.stableBlockId,
            })
            .from(elementReverifyProvenance)
            .innerJoin(elements, eq(elements.id, elementReverifyProvenance.elementId))
            .where(
              and(
                inArray(elementReverifyProvenance.sourceElementId, docs),
                isNull(elements.deletedAt),
              ),
            )
            .all()
            .filter((row) => keys.has(`${row.source}:${row.block}`))
            .map((row) => row.id),
        ).size;
      })(),
      legacyProjectedBlocks: 0,
      canMarkDoneWithoutConfirmation: unresolvedBlocks === 0,
      stateCounts,
    };
  }

  getDoneGate(sourceElementId: ElementId): DoneGateResult {
    const summary = this.getSourceProcessingSummary(sourceElementId);
    return {
      canMarkDone: summary.canMarkDoneWithoutConfirmation,
      unresolvedBlocks: summary.unresolvedBlocks,
      staleAfterEditBlocks: summary.staleAfterEditBlocks,
      highPriorityUnresolvedBlocks: summary.highPriorityUnresolvedBlocks,
    };
  }

  private requireSourceElement(tx: DbClient, sourceElementId: ElementId): void {
    if (!new SourceSectionRepository(tx).isProcessingSource(sourceElementId)) {
      throw new Error(`BlockProcessingService: source ${sourceElementId} not found`);
    }
  }

  private requireBlock(tx: DbClient, sourceElementId: ElementId, stableBlockId: BlockId): void {
    const block = tx
      .select({ id: documentBlocks.id })
      .from(documentBlocks)
      .where(
        and(
          eq(documentBlocks.documentId, sourceElementId),
          eq(documentBlocks.stableBlockId, stableBlockId),
        ),
      )
      .get();
    if (!block) {
      throw new Error(
        `BlockProcessingService: block ${stableBlockId} does not belong to source ${sourceElementId}`,
      );
    }
  }

  private requireNoLiveOutputs(sourceElementId: ElementId, stableBlockId: BlockId): void {
    const hasLiveOutput = this.repo
      .listLiveOutputs(sourceElementId)
      .some((output) => output.stableBlockId === stableBlockId);
    if (hasLiveOutput) {
      throw new Error(
        `BlockProcessingService: block ${stableBlockId} has live extracted output lineage`,
      );
    }
  }

  private computeCurrentBlockHash(
    sourceElementId: ElementId,
    stableBlockId: BlockId,
  ): string | null {
    return this.computeCurrentBlockHashes(sourceElementId).get(stableBlockId) ?? null;
  }

  private computeCurrentBlockHashes(sourceElementId: ElementId): Map<BlockId, string> {
    const document = this.db
      .select({ prosemirrorJson: documents.prosemirrorJson })
      .from(documents)
      .where(eq(documents.elementId, sourceElementId))
      .get();
    if (!document) return new Map();
    try {
      const parsed = JSON.parse(document.prosemirrorJson) as unknown;
      return computeBlockContentHashes(parsed);
    } catch {
      return new Map();
    }
  }
}
