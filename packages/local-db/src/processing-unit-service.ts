import type {
  BlockId,
  ElementId,
  ResumeSourceBlockReceipt,
  SetProcessingUnitRequest,
} from "@interleave/core";
import { coveredTime } from "@interleave/core";
import { elements, type InterleaveDatabase } from "@interleave/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  BlockProcessingRepository,
  type SourceBlockProcessingRow,
} from "./block-processing-repository";
import { BlockProcessingService } from "./block-processing-service";
import { newRowId } from "./ids";
import { mediaProcessingData } from "./media-processing-repository";
import { ProcessingUnitRepository } from "./processing-unit-repository";

export class ProcessingUnitService {
  constructor(private readonly db: InterleaveDatabase) {}

  private requireSource(sourceId: ElementId) {
    if (
      !this.db
        .select({ id: elements.id })
        .from(elements)
        .where(
          and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
        )
        .get()
    )
      throw new Error("Source unavailable");
  }

  open(sourceId: ElementId) {
    this.db.transaction((tx) => {
      this.requireSource(sourceId);
      new ProcessingUnitRepository(tx).reconcileWithin(sourceId, true);
    });
    const processing = new BlockProcessingService(this.db);
    return {
      blocks: new ProcessingUnitRepository(this.db).views(sourceId) ?? [],
      summary: processing.getSourceProcessingSummary(sourceId),
    };
  }

  set(input: SetProcessingUnitRequest): ResumeSourceBlockReceipt {
    return this.db.transaction((tx) => {
      const sourceId = input.sourceId as ElementId;
      this.requireSource(sourceId);
      const geometry = new ProcessingUnitRepository(tx);
      const unit = geometry.units(sourceId)?.find((row) => row.id === input.blockId);
      const view = geometry.views(sourceId)?.find((row) => row.stableBlockId === input.blockId);
      if (
        !view?.locatable ||
        view.blockContentHash !== input.contentHash ||
        view.state !== input.expectedState
      )
        throw new Error("Processing unit changed or is unavailable");
      const repo = new BlockProcessingRepository(tx);
      if (view.geometry?.kind === "media_segment") {
        const segment = view.geometry;
        if (segment.endMs == null && input.state !== "unread" && input.state !== "needs_later")
          throw new Error("Duration unknown; cannot finish an open segment");
        if (
          input.state === "read" &&
          (segment.endMs == null ||
            coveredTime(mediaProcessingData(tx, sourceId)?.coverage ?? [], {
              startMs: segment.startMs,
              endMs: segment.endMs,
            }) <
              segment.endMs - segment.startMs)
        )
          throw new Error("Segment has not been played completely");
      }
      const previous = repo.findRow(sourceId, view.stableBlockId);
      const receipt = { sourceId, blockId: input.blockId, token: newRowId() };
      repo.upsertStateWithin(tx, {
        sourceElementId: sourceId,
        stableBlockId: view.stableBlockId,
        state: input.state,
        action:
          input.state === "processed_without_output"
            ? "mark_processed_without_output"
            : `mark_${input.state}`,
        blockContentHash: view.blockContentHash,
        metadata: {
          ...(unit?.contentVersion ? { contentVersion: unit.contentVersion } : {}),
          unitGeometry: view.geometry,
          unitUndo: { token: receipt.token, previous, outputs: view.outputElementIds },
        },
      });
      return receipt;
    });
  }

  undo(receipt: ResumeSourceBlockReceipt): boolean {
    return this.db.transaction((tx) => {
      const sourceId = receipt.sourceId as ElementId;
      this.requireSource(sourceId);
      const repo = new BlockProcessingRepository(tx);
      const current = repo.findRow(sourceId, receipt.blockId as BlockId);
      const marker = current?.metadata?.unitUndo as
        | { token: string; previous: SourceBlockProcessingRow | null; outputs: string[] }
        | undefined;
      const view = new ProcessingUnitRepository(tx)
        .views(sourceId)
        ?.find((row) => row.stableBlockId === receipt.blockId);
      if (
        !current ||
        marker?.token !== receipt.token ||
        !view?.locatable ||
        current.blockContentHash !== view.blockContentHash ||
        JSON.stringify(marker.outputs) !== JSON.stringify(view.outputElementIds)
      )
        return false;
      repo.upsertStateWithin(tx, {
        sourceElementId: sourceId,
        stableBlockId: current.stableBlockId,
        state: marker.previous?.state ?? "unread",
        action: marker.previous?.lastAction ?? "reconcile_document_blocks",
        blockContentHash: current.blockContentHash,
        preStaleHash: marker.previous?.preStaleHash ?? null,
        metadata: marker.previous?.metadata ?? null,
      });
      return true;
    });
  }
}
