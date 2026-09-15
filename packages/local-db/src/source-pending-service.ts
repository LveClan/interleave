import type {
  BlockId,
  ElementId,
  ResumeSourceBlockReceipt,
  ResumeSourceBlockRequest,
  SourcePendingBlocks,
} from "@interleave/core";
import {
  elementReverifyProvenance,
  elements,
  type InterleaveDatabase,
  sourceBlockProcessing,
  sources,
} from "@interleave/db";
import { and, eq, isNull } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import {
  BlockProcessingService,
  computeBlockContentHashes,
  computeBlockTexts,
} from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { newRowId } from "./ids";
import { ProcessingUnitRepository } from "./processing-unit-repository";
import { ProcessingUnitService } from "./processing-unit-service";
import { SourceSectionRepository } from "./source-section-repository";

/** Document-only rail. Derived output verification is never resolved here. */
export class SourcePendingService {
  constructor(private readonly db: InterleaveDatabase) {}

  list(sourceId: ElementId): SourcePendingBlocks | null {
    const source = this.db
      .select()
      .from(elements)
      .where(
        and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
      )
      .get();
    if (!source) return null;
    const sections = new SourceSectionRepository(this.db);
    if (sections.epubChapters(sourceId)) {
      const service = new BlockProcessingService(this.db);
      const views = service.listBlockViews(sourceId);
      return {
        sourceId,
        summary: service.getSourceProcessingSummary(sourceId),
        entries: views
          .filter((v) => v.state === "needs_later" || v.state === "stale_after_edit")
          .map((v) => {
            const locatable = sections.unitIds(v.sourceElementId).includes(v.stableBlockId);
            return {
              blockId: v.stableBlockId,
              order: locatable ? v.order : null,
              state: v.state as "needs_later" | "stale_after_edit",
              preview: "",
              contentHash: v.blockContentHash,
              locatable,
              canResume: false,
              topicId:
                sections.topicForUnit(sourceId, v.sourceElementId, v.stableBlockId) ??
                v.sourceElementId,
            };
          }),
      };
    }
    const geometry = new ProcessingUnitRepository(this.db).views(sourceId);
    if (geometry)
      return {
        sourceId,
        summary: new BlockProcessingService(this.db).getSourceProcessingSummary(sourceId),
        entries: geometry
          .filter((v) => v.state === "needs_later" || v.state === "stale_after_edit")
          .map((v) => ({
            blockId: v.stableBlockId,
            order: v.locatable ? v.order : null,
            state: v.state as "needs_later" | "stale_after_edit",
            preview: v.preview ?? "",
            contentHash: v.blockContentHash,
            locatable: v.locatable === true,
            canResume: v.locatable === true,
            ...(v.canMarkRead === undefined ? {} : { canResumeRead: v.canMarkRead }),
            ...(v.geometry === undefined ? {} : { geometry: v.geometry }),
          })),
      };
    const meta = this.db.select().from(sources).where(eq(sources.elementId, sourceId)).get();
    const docs = new DocumentRepository(this.db);
    const blocks = docs.listBlocks(sourceId);
    if (
      meta?.mediaKind ||
      meta?.snapshotKey?.toLowerCase().endsWith(".pdf") ||
      blocks.some((b) => b.page != null || b.timestampMs != null)
    )
      return null;
    const document = docs.findById(sourceId);
    if (!document) return null;
    const text = computeBlockTexts(document.prosemirrorJson);
    const hashes = computeBlockContentHashes(document.prosemirrorJson);
    const order = new Map(blocks.map((b) => [b.stableBlockId, b.order]));
    const service = new BlockProcessingService(this.db);
    const reverifyBlocks = new Set(
      this.db
        .select({ blockId: elementReverifyProvenance.stableBlockId })
        .from(elementReverifyProvenance)
        .innerJoin(elements, eq(elements.id, elementReverifyProvenance.elementId))
        .where(
          and(eq(elementReverifyProvenance.sourceElementId, sourceId), isNull(elements.deletedAt)),
        )
        .all()
        .map((row) => row.blockId),
    );
    const entries = service
      .listBlockViews(sourceId)
      .filter((view) => view.state === "needs_later" || view.state === "stale_after_edit")
      .map((view) => {
        const locatable = order.has(view.stableBlockId) && text.has(view.stableBlockId);
        return {
          blockId: view.stableBlockId,
          order: locatable ? (order.get(view.stableBlockId) ?? null) : null,
          state: view.state as "needs_later" | "stale_after_edit",
          preview: (text.get(view.stableBlockId) ?? "").slice(0, 180),
          contentHash: hashes.get(view.stableBlockId) ?? null,
          locatable,
          canResume:
            locatable &&
            view.outputElementIds.length === 0 &&
            !reverifyBlocks.has(view.stableBlockId),
        };
      })
      .sort(
        (a, b) =>
          (a.order ?? Infinity) - (b.order ?? Infinity) || a.blockId.localeCompare(b.blockId),
      );
    return { sourceId, entries, summary: service.getSourceProcessingSummary(sourceId) };
  }

  resume(input: ResumeSourceBlockRequest): ResumeSourceBlockReceipt {
    if (new ProcessingUnitRepository(this.db).units(input.sourceId as ElementId))
      return new ProcessingUnitService(this.db).set(input);
    return this.db.transaction((tx) => {
      const sourceId = input.sourceId as ElementId;
      const blockId = input.blockId as BlockId;
      const entry = this.list(sourceId)?.entries.find((row) => row.blockId === blockId);
      if (
        !entry?.canResume ||
        entry.state !== input.expectedState ||
        entry.contentHash !== input.contentHash
      ) {
        throw new Error("Pending block changed or is unavailable");
      }
      const repo = new BlockProcessingRepository(this.db);
      const previous = repo.findRow(sourceId, blockId);
      if (!previous) throw new Error("Pending block is unavailable");
      const receipt = { sourceId, blockId, token: newRowId() };
      repo.upsertStateWithin(tx, {
        sourceElementId: sourceId,
        stableBlockId: blockId,
        state: input.state,
        action: input.state === "read" ? "mark_read" : "mark_unread",
        blockContentHash: entry.contentHash,
        metadata: { pendingResume: { token: receipt.token, previous } },
      });
      return receipt;
    });
  }

  undo(receipt: ResumeSourceBlockReceipt): boolean {
    if (new ProcessingUnitRepository(this.db).units(receipt.sourceId as ElementId))
      return new ProcessingUnitService(this.db).undo(receipt);
    return this.db.transaction((tx) => {
      const sourceId = receipt.sourceId as ElementId;
      const blockId = receipt.blockId as BlockId;
      const repo = new BlockProcessingRepository(this.db);
      const row = repo.findRow(sourceId, blockId);
      const marker = row?.metadata?.pendingResume as
        | { token?: string; previous?: ReturnType<typeof repo.findRow> }
        | undefined;
      if (
        !row ||
        marker?.token !== receipt.token ||
        !marker.previous ||
        (row.state !== "read" && row.state !== "unread")
      )
        return false;
      if (!this.list(sourceId)) return false;
      const doc = new DocumentRepository(this.db).findById(sourceId);
      if (
        !doc ||
        computeBlockContentHashes(doc.prosemirrorJson).get(blockId) !== row.blockContentHash
      )
        return false;
      if (
        new BlockProcessingService(this.db).getBlockView(sourceId, blockId).outputElementIds
          .length > 0
      )
        return false;
      const previous = marker.previous;
      repo.upsertStateWithin(tx, {
        sourceElementId: sourceId,
        stableBlockId: blockId,
        state: previous.state,
        action: previous.state === "needs_later" ? "mark_needs_later" : "mark_stale_after_edit",
        blockContentHash: previous.blockContentHash,
        preStaleHash: previous.preStaleHash,
        metadata: previous.metadata,
      });
      // Restore the exact original hash, including a legacy null, within the logged command.
      tx.update(sourceBlockProcessing)
        .set({ blockContentHash: previous.blockContentHash })
        .where(eq(sourceBlockProcessing.id, row.id))
        .run();
      return true;
    });
  }
}
