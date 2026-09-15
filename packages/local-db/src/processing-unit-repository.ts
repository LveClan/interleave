import { createHash } from "node:crypto";
import {
  type BlockId,
  composeProcessingUnitState,
  coveredTime,
  type ElementId,
  mediaSegments,
  type ProcessingUnitGeometry,
  type SourceBlockProcessingView,
} from "@interleave/core";
import {
  assets,
  documentBlocks,
  documents,
  elements,
  sourceLocations,
  sources,
} from "@interleave/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import { newRowId } from "./ids";
import { mediaProcessingData, parseClip } from "./media-processing-repository";
import { ReverifyPropagationRepository } from "./reverify-propagation-repository";
import type { DbClient } from "./types";

export interface ProcessingUnit {
  id: BlockId;
  order: number;
  geometry: ProcessingUnitGeometry;
  hash: string;
  preview: string;
  text: string;
  contentVersion?: string;
}

export const pdfPageKey = (page: number): BlockId => `pdf:page:${page}` as BlockId;
interface TextNode {
  text?: string;
  attrs?: { blockId?: string };
  content?: TextNode[];
}

/** Geometry is projected from trusted source metadata; reads never materialize rows. */
export class ProcessingUnitRepository {
  constructor(private readonly db: DbClient) {}

  units(sourceId: ElementId): ProcessingUnit[] | null {
    if (
      !this.db
        .select({ id: elements.id })
        .from(elements)
        .where(
          and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
        )
        .get()
    )
      return null;
    const source = this.db.select().from(sources).where(eq(sources.elementId, sourceId)).get();
    if (!source || (!source.mediaKind && !source.snapshotKey?.toLowerCase().endsWith(".pdf")))
      return null;
    const blocks = this.db
      .select()
      .from(documentBlocks)
      .where(eq(documentBlocks.documentId, sourceId))
      .all()
      .sort((a, b) => a.order - b.order);
    const doc = this.db.select().from(documents).where(eq(documents.elementId, sourceId)).get();
    const texts = new Map<string, string>();
    const visit = (node: TextNode): string => {
      const text = node.text ?? (node.content ?? []).map(visit).join(" ");
      if (node.attrs?.blockId) texts.set(node.attrs.blockId, text.replace(/\s+/g, " ").trim());
      return text;
    };
    if (doc) visit(JSON.parse(doc.prosemirrorJson));
    const media = mediaProcessingData(this.db, sourceId);
    if (media) {
      const cues = blocks.filter((block) => block.timestampMs != null);
      const contentVersion = createHash("sha256")
        .update(
          JSON.stringify([
            media.identity,
            cues.map((b) => [b.timestampMs, texts.get(b.stableBlockId)]),
          ]),
        )
        .digest("hex");
      return mediaSegments(
        media.durationMs,
        cues.map((b) => b.timestampMs as number),
        media.observedMs,
      ).map((segment, order) => {
        const text = cues
          .filter(
            (b) =>
              (b.timestampMs as number) >= segment.startMs &&
              (segment.endMs == null || (b.timestampMs as number) < segment.endMs),
          )
          .map((b) => texts.get(b.stableBlockId) ?? "")
          .join(" ");
        return {
          id: `media:segment:${segment.startMs}` as BlockId,
          order,
          geometry: { kind: "media_segment" as const, ...segment },
          hash: createHash("sha256")
            .update(JSON.stringify([media.identity, segment, text]))
            .digest("hex"),
          text,
          preview: text.slice(0, 180),
          contentVersion,
        };
      });
    }
    const pages = new Map<number, string[]>();
    for (const block of blocks) {
      if (block.page == null) continue;
      const page = pages.get(block.page) ?? [];
      page.push(texts.get(block.stableBlockId) ?? "");
      pages.set(block.page, page);
    }
    const asset = this.db
      .select({ hash: assets.contentHash })
      .from(assets)
      .where(
        and(
          eq(assets.owningElementId, sourceId),
          eq(assets.relativePath, source.snapshotKey ?? ""),
        ),
      )
      .get();
    return [...pages]
      .sort(([a], [b]) => a - b)
      .map(([page, text], order) => ({
        id: pdfPageKey(page),
        order,
        geometry: { kind: "pdf_page", page },
        hash: createHash("sha256")
          .update(JSON.stringify([asset?.hash ?? source.snapshotKey, text]))
          .digest("hex"),
        preview: text.join(" ").slice(0, 180),
        text: text.join(" "),
      }));
  }

  views(sourceId: ElementId): SourceBlockProcessingView[] | null {
    const units = this.units(sourceId);
    if (!units) return null;
    const repo = new BlockProcessingRepository(this.db);
    const rows = new Map(repo.listRows(sourceId).map((row) => [row.stableBlockId, row]));
    const locations = this.db
      .select({ outputId: elements.id, page: sourceLocations.page, clip: sourceLocations.clip })
      .from(sourceLocations)
      .innerJoin(elements, eq(elements.id, sourceLocations.elementId))
      .where(
        and(
          eq(sourceLocations.sourceElementId, sourceId),
          isNull(elements.deletedAt),
          inArray(elements.type, ["extract", "card", "media_fragment"]),
        ),
      )
      .all();
    const outputsFor = (geometry: ProcessingUnitGeometry) => [
      ...new Set(
        locations
          .filter((loc) => {
            if (geometry.kind === "pdf_page") return loc.page === geometry.page;
            const clip = parseClip(loc.clip);
            return (
              clip &&
              clip.endMs > geometry.startMs &&
              (geometry.endMs == null || clip.startMs < geometry.endMs)
            );
          })
          .map((loc) => loc.outputId as ElementId),
      ),
    ];
    const media = mediaProcessingData(this.db, sourceId);
    const views: SourceBlockProcessingView[] = units.map((unit) => {
      const row = rows.get(unit.id);
      const outputElementIds = outputsFor(unit.geometry);
      let remainingState = row?.state ?? "unread";
      if (
        media &&
        unit.geometry.kind === "media_segment" &&
        unit.geometry.endMs != null &&
        remainingState === "unread" &&
        row?.lastAction !== "mark_unread" &&
        coveredTime(media.coverage, {
          startMs: unit.geometry.startMs,
          endMs: unit.geometry.endMs,
        }) >=
          unit.geometry.endMs - unit.geometry.startMs
      )
        remainingState = "read";
      return {
        sourceElementId: sourceId,
        stableBlockId: unit.id,
        order: unit.order,
        geometry: unit.geometry,
        preview: unit.preview,
        locatable: true,
        canMarkRead:
          unit.geometry.kind === "pdf_page" ||
          (unit.geometry.endMs != null &&
            coveredTime(media?.coverage ?? [], {
              startMs: unit.geometry.startMs,
              endMs: unit.geometry.endMs,
            }) >=
              unit.geometry.endMs - unit.geometry.startMs),
        state: composeProcessingUnitState(remainingState, outputElementIds.length),
        remainingState,
        storedState: row?.state ?? null,
        blockContentHash: unit.hash,
        outputElementIds,
        derivedFrom: row ? "explicit" : "missing",
      };
    });
    for (const row of rows.values()) {
      if (
        (!row.stableBlockId.startsWith("pdf:page:") &&
          !row.stableBlockId.startsWith("media:segment:")) ||
        units.some((u) => u.id === row.stableBlockId)
      )
        continue;
      if (row.state !== "stale_after_edit") continue;
      const page = Number(row.stableBlockId.slice(9));
      const geometry: ProcessingUnitGeometry = row.stableBlockId.startsWith("pdf:page:")
        ? { kind: "pdf_page", page }
        : ((row.metadata?.unitGeometry as ProcessingUnitGeometry | undefined) ?? {
            kind: "media_segment",
            startMs: Number(row.stableBlockId.slice(14)),
            endMs: null,
          });
      views.push({
        sourceElementId: sourceId,
        stableBlockId: row.stableBlockId,
        order: views.length,
        state: row.state,
        remainingState: row.state,
        storedState: row.state,
        blockContentHash: row.blockContentHash,
        outputElementIds: outputsFor(geometry),
        derivedFrom: "explicit",
        geometry,
        locatable: false,
      });
    }
    return views;
  }

  /** Called inside the document/asset update transaction, including accepted OCR. */
  reconcileWithin(sourceId: ElementId, initialize = false): void {
    const units = this.units(sourceId);
    if (!units) return;
    const repo = new BlockProcessingRepository(this.db);
    const old = repo
      .listRows(sourceId)
      .filter(
        (row) =>
          row.stableBlockId.startsWith("pdf:page:") ||
          row.stableBlockId.startsWith("media:segment:"),
      );
    if (!initialize && old.length === 0) return;
    // Discovering duration closes an open tail; it is geometry knowledge, not a content edit.
    for (const unit of units) {
      const prior = old.find((row) => row.stableBlockId === unit.id);
      const previousGeometry = prior?.metadata?.unitGeometry as ProcessingUnitGeometry | undefined;
      if (
        !prior ||
        !unit.contentVersion ||
        prior.metadata?.contentVersion !== unit.contentVersion ||
        prior.state === "stale_after_edit" ||
        previousGeometry?.kind !== "media_segment" ||
        unit.geometry.kind !== "media_segment" ||
        previousGeometry.startMs !== unit.geometry.startMs
      )
        continue;
      if (
        prior.blockContentHash === unit.hash &&
        JSON.stringify(prior.metadata?.unitGeometry) === JSON.stringify(unit.geometry)
      )
        continue;
      const expanded =
        previousGeometry?.kind === "media_segment" &&
        unit.geometry.kind === "media_segment" &&
        previousGeometry.endMs != null &&
        (unit.geometry.endMs == null || unit.geometry.endMs > previousGeometry.endMs);
      repo.upsertStateWithin(this.db, {
        sourceElementId: sourceId,
        stableBlockId: unit.id,
        state: expanded && prior.state !== "needs_later" ? "unread" : prior.state,
        action: expanded
          ? "reconcile_document_blocks"
          : (prior.lastAction ?? "reconcile_document_blocks"),
        blockContentHash: unit.hash,
        metadata: {
          ...(expanded ? {} : prior.metadata),
          unitGeometry: unit.geometry,
          contentVersion: unit.contentVersion,
        },
      });
    }
    const report = repo.reconcileStaleWithin(
      this.db,
      sourceId,
      new Map(units.map((unit) => [unit.id, unit.hash])),
      new Set(old.map((row) => row.stableBlockId)),
    );
    for (const unit of units) {
      if (old.some((row) => row.stableBlockId === unit.id)) continue;
      repo.upsertStateWithin(this.db, {
        sourceElementId: sourceId,
        stableBlockId: unit.id,
        state: "unread",
        action: "reconcile_document_blocks",
        blockContentHash: unit.hash,
        metadata: {
          unitGeometry: unit.geometry,
          ...(unit.contentVersion ? { contentVersion: unit.contentVersion } : {}),
        },
      });
    }
    new ReverifyPropagationRepository(this.db).propagateReverify(
      this.db,
      sourceId,
      report,
      newRowId(),
      new Map(units.map((unit) => [unit.id, unit.geometry])),
    );
    for (const unit of units) {
      if (!unit.contentVersion) continue;
      const row = repo.findRow(sourceId, unit.id);
      if (
        !row ||
        (row.metadata?.contentVersion === unit.contentVersion &&
          JSON.stringify(row.metadata.unitGeometry) === JSON.stringify(unit.geometry))
      )
        continue;
      repo.upsertStateWithin(this.db, {
        sourceElementId: sourceId,
        stableBlockId: unit.id,
        state: row.state,
        action: row.lastAction ?? "reconcile_document_blocks",
        blockContentHash: row.blockContentHash,
        preStaleHash: row.preStaleHash,
        metadata: {
          ...row.metadata,
          contentVersion: unit.contentVersion,
          unitGeometry: unit.geometry,
        },
      });
    }
  }
}
