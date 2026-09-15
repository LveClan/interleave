import {
  type ElementId,
  type IsoTimestamp,
  isTerminalSourceBlockProcessingState,
  type SourceReturnBriefing,
  shouldShowSourceReturnBriefing,
} from "@interleave/core";
import {
  elements,
  type InterleaveDatabase,
  operationLog,
  reviewLogs,
  sourceBlockProcessing,
  sourceLocations,
  sources,
} from "@interleave/db";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { BlockProcessingService } from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { LapseClusterQuery, type LapseClusterQueryInput } from "./lapse-cluster-query";
import { windowStart } from "./lapse-window";
import { ProcessingUnitRepository, pdfPageKey } from "./processing-unit-repository";
import { SourceYieldQuery } from "./source-yield-query";
import { retentionFor } from "./topic-knowledge-state-query";

export class SourceReturnBriefingQuery {
  constructor(private readonly db: InterleaveDatabase) {}

  get(input: {
    sourceId: ElementId;
    asOf: IsoTimestamp;
    scheduledReturn: boolean;
    clusters?: Pick<LapseClusterQueryInput, "enabled" | "minLapses" | "minCards" | "windowDays">;
  }): SourceReturnBriefing | null {
    const { sourceId, asOf } = input;
    const source = this.db
      .select()
      .from(elements)
      .where(
        and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
      )
      .get();
    if (!source) return null;
    const metadata = this.db.select().from(sources).where(eq(sources.elementId, sourceId)).get();
    const documents = new DocumentRepository(this.db);
    const blocks = documents.listBlocks(sourceId);
    const geometry = new ProcessingUnitRepository(this.db).views(sourceId);
    // T130 owns document geometry only. PDF/media use their specialized readers.
    if (
      !geometry &&
      (metadata?.mediaKind ||
        metadata?.snapshotKey?.toLowerCase().endsWith(".pdf") ||
        blocks.length === 0 ||
        blocks.some((block) => block.page != null || block.timestampMs != null))
    )
      return null;
    const readPoint = documents.getReadPoint(sourceId);
    const processing = new BlockProcessingService(this.db);
    const summary = processing.getSourceProcessingSummary(sourceId);
    const liveIds = new Set(
      geometry
        ? geometry.filter((v) => v.locatable).map((v) => v.stableBlockId)
        : blocks.map((block) => block.stableBlockId),
    );
    const views = processing
      .listBlockViews(sourceId)
      .filter((view) => liveIds.has(view.stableBlockId));
    const lastExtraction = this.db
      .select({
        elementId: elements.id,
        at: elements.createdAt,
        label: sourceLocations.label,
        blockIds: sourceLocations.blockIds,
        page: sourceLocations.page,
      })
      .from(sourceLocations)
      .innerJoin(elements, eq(elements.id, sourceLocations.elementId))
      .where(
        and(
          eq(sourceLocations.sourceElementId, sourceId),
          inArray(elements.type, ["extract", "media_fragment"]),
          isNull(elements.deletedAt),
        ),
      )
      .orderBy(desc(elements.createdAt), desc(elements.id), desc(sourceLocations.id))
      .get();
    let extractionBlockId: string | null = null;
    if (lastExtraction) {
      try {
        const ids: unknown = JSON.parse(lastExtraction.blockIds);
        if (Array.isArray(ids))
          extractionBlockId = ids.find((id) => typeof id === "string" && liveIds.has(id)) ?? null;
      } catch {
        /* An old malformed anchor remains descriptive, never a jump target. */
      }
      if (geometry && lastExtraction.page != null && liveIds.has(pdfPageKey(lastExtraction.page)))
        extractionBlockId = pdfPageKey(lastExtraction.page);
    }
    const actions = this.db
      .select({ at: sourceBlockProcessing.lastActionAt })
      .from(sourceBlockProcessing)
      .where(
        and(
          eq(sourceBlockProcessing.sourceElementId, sourceId),
          inArray(sourceBlockProcessing.lastAction, [
            "mark_read",
            "mark_unread",
            "mark_ignored",
            "mark_processed_without_output",
            "mark_needs_later",
            "mark_extracted",
          ]),
        ),
      )
      .all();
    // Reconciliation overwrites the row's last action. The command log preserves
    // earlier explicit reading actions, without guessing from source updatedAt.
    const lastReadingOp = this.db
      .select({ at: operationLog.createdAt })
      .from(operationLog)
      .where(
        and(
          eq(operationLog.elementId, sourceId),
          lte(operationLog.createdAt, asOf),
          sql`(${operationLog.opType} = 'set_read_point' OR
          (${operationLog.opType} = 'update_document' AND
           CASE WHEN json_valid(${operationLog.payload}) THEN json_extract(${operationLog.payload}, '$.blockProcessing.action') END
           IN ('mark_read', 'mark_processed_without_output', 'mark_ignored', 'mark_needs_later', 'mark_unread', 'mark_extracted')))`,
        ),
      )
      .orderBy(desc(operationLog.createdAt), desc(operationLog.id))
      .limit(1)
      .get();
    const lastVisitAt =
      [readPoint?.updatedAt, lastExtraction?.at, lastReadingOp?.at, ...actions.map((row) => row.at)]
        .filter((at): at is string => !!at && Number.isFinite(Date.parse(at)) && at <= asOf)
        .sort()
        .at(-1) ?? null;
    const yieldRow = new SourceYieldQuery(this.db).getSourceYield(sourceId, asOf);
    const windowDays = 30;
    const reviews = this.db
      .select({ rating: reviewLogs.rating })
      .from(reviewLogs)
      .innerJoin(elements, eq(elements.id, reviewLogs.elementId))
      .where(
        and(
          eq(elements.sourceId, sourceId),
          eq(elements.type, "card"),
          isNull(elements.deletedAt),
          isNull(reviewLogs.editMarkerAt),
          gte(reviewLogs.reviewedAt, windowStart(asOf, windowDays)),
          lte(reviewLogs.reviewedAt, asOf),
        ),
      )
      .all();
    const clusters = new LapseClusterQuery(this.db).list({
      ...input.clusters,
      sourceId,
      asOf,
      limit: Number.MAX_SAFE_INTEGER,
    });
    return {
      sourceId,
      asOf,
      show: shouldShowSourceReturnBriefing(lastVisitAt, asOf, input.scheduledReturn),
      lastVisitAt,
      visitEvidence: lastVisitAt ? "reading_activity" : "unknown",
      readPct: yieldRow?.readPct ?? 0,
      readPctDelta: null,
      stateCounts: summary.stateCounts,
      unresolvedBlocks: summary.unresolvedBlocks,
      needsReverifyOutputs: summary.needsReverifyOutputs,
      cards: {
        count: yieldRow?.cardsCreated ?? 0,
        mature: yieldRow?.matureCards ?? 0,
        leeches: yieldRow?.leeches ?? 0,
        retention: retentionFor(reviews),
        reviewCount: reviews.length,
        windowDays,
      },
      strugglingGroups: { count: clusters.length, windowDays: input.clusters?.windowDays ?? 30 },
      lastExtraction: lastExtraction
        ? {
            elementId: lastExtraction.elementId,
            at: lastExtraction.at,
            label: lastExtraction.label,
            blockId: extractionBlockId,
          }
        : null,
      nextUnresolvedBlockId:
        views.find((view) => !isTerminalSourceBlockProcessingState(view.state))?.stableBlockId ??
        null,
      firstDeferredBlockId:
        views.find((view) => view.state === "needs_later")?.stableBlockId ?? null,
    };
  }
}
