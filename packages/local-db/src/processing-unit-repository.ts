import { createHash } from "node:crypto";
import {
  type BlockId,
  composeProcessingUnitState,
  type ElementId,
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
import { and, eq, isNull } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import { newRowId } from "./ids";
import { ReverifyPropagationRepository } from "./reverify-propagation-repository";
import type { DbClient } from "./types";

export interface ProcessingUnit {
  id: BlockId;
  order: number;
  geometry: ProcessingUnitGeometry;
  hash: string;
  preview: string;
  text: string;
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
    if (!source || source.mediaKind || !source.snapshotKey?.toLowerCase().endsWith(".pdf"))
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
      .where(and(eq(assets.owningElementId, sourceId), eq(assets.relativePath, source.snapshotKey)))
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
      .select({ outputId: elements.id, page: sourceLocations.page })
      .from(sourceLocations)
      .innerJoin(elements, eq(elements.id, sourceLocations.elementId))
      .where(and(eq(sourceLocations.sourceElementId, sourceId), isNull(elements.deletedAt)))
      .all();
    const views: SourceBlockProcessingView[] = units.map((unit) => {
      const row = rows.get(unit.id);
      const outputElementIds = [
        ...new Set(
          locations
            .filter((loc) => loc.page === unit.geometry.page)
            .map((loc) => loc.outputId as ElementId),
        ),
      ];
      const remainingState = row?.state ?? "unread";
      return {
        sourceElementId: sourceId,
        stableBlockId: unit.id,
        order: unit.order,
        geometry: unit.geometry,
        preview: unit.preview,
        locatable: true,
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
        !row.stableBlockId.startsWith("pdf:page:") ||
        units.some((u) => u.id === row.stableBlockId)
      )
        continue;
      if (row.state !== "stale_after_edit") continue;
      const page = Number(row.stableBlockId.slice(9));
      views.push({
        sourceElementId: sourceId,
        stableBlockId: row.stableBlockId,
        order: views.length,
        state: row.state,
        remainingState: row.state,
        storedState: row.state,
        blockContentHash: row.blockContentHash,
        outputElementIds: [
          ...new Set(
            locations.filter((loc) => loc.page === page).map((loc) => loc.outputId as ElementId),
          ),
        ],
        derivedFrom: "explicit",
        geometry: { kind: "pdf_page", page },
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
    const old = repo.listRows(sourceId).filter((row) => row.stableBlockId.startsWith("pdf:page:"));
    if (!initialize && old.length === 0) return;
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
      });
    }
    new ReverifyPropagationRepository(this.db).propagateReverify(
      this.db,
      sourceId,
      report,
      newRowId(),
    );
  }
}
