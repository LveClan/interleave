import { createHash } from "node:crypto";
import type { BlockId, ElementId } from "@interleave/core";
import {
  documentBlocks,
  documents,
  elements,
  sourceLocations,
  sourceSections,
  sources,
} from "@interleave/db";
import { and, eq, isNull } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import { ProcessingUnitRepository } from "./processing-unit-repository";
import type { DbClient } from "./types";

export const rangeHash = (ids: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(ids)).digest("hex");
export class SourceSectionRepository {
  constructor(private readonly db: DbClient) {}
  isProcessingSource(id: string): boolean {
    const element = this.db.select().from(elements).where(eq(elements.id, id)).get();
    if (!element || element.deletedAt) return false;
    if (element.type === "source") return true;
    return (
      element.type === "topic" &&
      (this.find(id) !== null ||
        (element.parentId != null &&
          this.epubChapters(element.parentId)?.some((c) => c.topic.id === id) === true))
    );
  }
  find(topicId: string) {
    return (
      this.db.select().from(sourceSections).where(eq(sourceSections.topicId, topicId)).get() ?? null
    );
  }
  list(sourceId: string, includeDeleted = false) {
    return this.db
      .select({ section: sourceSections, topic: elements })
      .from(sourceSections)
      .innerJoin(elements, eq(elements.id, sourceSections.topicId))
      .where(
        and(
          eq(sourceSections.sourceId, sourceId),
          includeDeleted ? undefined : isNull(elements.deletedAt),
        ),
      )
      .all();
  }
  epubChapters(sourceId: string) {
    const source = this.db.select().from(sources).where(eq(sources.elementId, sourceId)).get();
    if (!source?.snapshotKey?.toLowerCase().endsWith(".epub")) return null;
    return this.db
      .select({ topic: elements, location: sourceLocations })
      .from(elements)
      .innerJoin(sourceLocations, eq(sourceLocations.elementId, elements.id))
      .where(
        and(
          eq(elements.parentId, sourceId),
          eq(elements.type, "topic"),
          eq(sourceLocations.sourceElementId, sourceId),
          isNull(elements.deletedAt),
          // T067's spine anchors have no block span; later manual subranges do.
          eq(sourceLocations.blockIds, "[]"),
        ),
      )
      .all()
      .sort((a, b) => (a.location.page ?? 0) - (b.location.page ?? 0));
  }
  unitIds(documentId: string): string[] {
    const units = new ProcessingUnitRepository(this.db).units(documentId as ElementId);
    return (
      units?.map((unit) => unit.id) ??
      this.db
        .select()
        .from(documentBlocks)
        .where(eq(documentBlocks.documentId, documentId))
        .all()
        .sort((a, b) => a.order - b.order)
        .map((block) => block.stableBlockId)
    );
  }
  valid(section: typeof sourceSections.$inferSelect): boolean {
    const wanted: string[] = JSON.parse(section.unitIds);
    if (!wanted.length) return false;
    const current = this.unitIds(section.documentId);
    if (section.documentId !== section.sourceId) {
      const document = this.db
        .select({ deletedAt: elements.deletedAt })
        .from(elements)
        .where(eq(elements.id, section.documentId))
        .get();
      if (!document || document.deletedAt) return false;
    }
    const first = current.indexOf(wanted[0] ?? "");
    return (
      first >= 0 && rangeHash(current.slice(first, first + wanted.length)) === section.rangeHash
    );
  }
  owns(sourceId: string, documentId: string, unitId: string): boolean {
    return this.list(sourceId).some(
      ({ section }) =>
        section.documentId === documentId &&
        this.valid(section) &&
        this.activeOwnership(section) &&
        (JSON.parse(section.unitIds) as string[]).includes(unitId),
    );
  }
  /** Parent ownership depends on content, never merely the presence of a child. */
  hasRemainder(sourceId: string): boolean {
    const sections = this.list(sourceId);
    if (!sections.length) return true;
    const owned = new Map<string, Set<string>>();
    for (const { section } of sections) {
      if (!this.valid(section) || !this.activeOwnership(section)) continue;
      const ids = owned.get(section.documentId) ?? new Set<string>();
      for (const id of JSON.parse(section.unitIds) as string[]) ids.add(id);
      owned.set(section.documentId, ids);
    }
    const chapters = this.epubChapters(sourceId);
    const documents = chapters ? chapters.map((c) => c.topic.id) : [sourceId];
    return documents.some((documentId) => {
      const rows = new BlockProcessingRepository(this.db).listRows(documentId as ElementId);
      const liveIds = this.unitIds(documentId);
      if (
        rows.some((row) => row.state === "stale_after_edit" && !liveIds.includes(row.stableBlockId))
      )
        return true;
      const states = new Map(rows.map((row) => [row.stableBlockId, row.state]));
      const outputs = new Set(
        new BlockProcessingRepository(this.db)
          .listLiveOutputs(documentId as ElementId)
          .map((row) => row.stableBlockId),
      );
      return liveIds.some(
        (id) =>
          !["ignored", "processed_without_output"].includes(states.get(id as BlockId) ?? "") &&
          !(outputs.has(id as BlockId) && states.get(id as BlockId) !== "stale_after_edit") &&
          !owned.get(documentId)?.has(id),
      );
    });
  }
  isQueueOwner(id: string): boolean {
    const section = this.find(id);
    if (section) {
      const source = this.db
        .select({ status: elements.status, deletedAt: elements.deletedAt })
        .from(elements)
        .where(eq(elements.id, section.sourceId))
        .get();
      return (
        !!source &&
        !source.deletedAt &&
        !["done", "dismissed", "suspended", "deleted"].includes(source.status) &&
        section.verdict !== "ignore" &&
        this.valid(section)
      );
    }
    const element = this.db.select().from(elements).where(eq(elements.id, id)).get();
    if (
      element?.type === "topic" &&
      element.parentId &&
      this.epubChapters(element.parentId)?.some((c) => c.topic.id === id)
    )
      return false;
    return this.hasRemainder(id);
  }
  activeOwnership(section: typeof sourceSections.$inferSelect): boolean {
    const topic = this.db
      .select({ status: elements.status })
      .from(elements)
      .where(eq(elements.id, section.topicId))
      .get();
    if (!topic) return false;
    if (!["done", "dismissed", "suspended", "deleted"].includes(topic.status)) return true;
    const ids: string[] = JSON.parse(section.unitIds);
    const views = new ProcessingUnitRepository(this.db).views(section.documentId as ElementId);
    if (views)
      return ids.every((id) =>
        views.some(
          (v) =>
            v.stableBlockId === id &&
            ["ignored", "processed_without_output", "extracted"].includes(v.state),
        ),
      );
    const repo = new BlockProcessingRepository(this.db);
    const states = new Map(
      repo.listRows(section.documentId as ElementId).map((row) => [row.stableBlockId, row.state]),
    );
    const outputs = new Set(
      repo.listLiveOutputs(section.documentId as ElementId).map((row) => row.stableBlockId),
    );
    return ids.every(
      (id) =>
        ["ignored", "processed_without_output"].includes(states.get(id as BlockId) ?? "") ||
        (states.get(id as BlockId) !== "stale_after_edit" && outputs.has(id as BlockId)),
    );
  }
  titleForSection(id: string): string | null {
    const section = this.find(id);
    return section
      ? (this.db
          .select({ title: elements.title })
          .from(elements)
          .where(eq(elements.id, section.sourceId))
          .get()?.title ?? null)
      : null;
  }
  topicForUnit(sourceId: string, documentId: string, unitId: string): string | null {
    return (
      this.list(sourceId).find(
        ({ section }) =>
          section.documentId === documentId &&
          this.valid(section) &&
          (JSON.parse(section.unitIds) as string[]).includes(unitId),
      )?.topic.id ?? null
    );
  }
  body(documentId: string, ids: readonly string[]): unknown {
    const doc = this.db.select().from(documents).where(eq(documents.elementId, documentId)).get();
    if (!doc) return { type: "doc", content: [] };
    const wanted = new Set(ids);
    const prune = (node: {
      type?: string;
      attrs?: { blockId?: string };
      content?: unknown[];
    }): unknown | null => {
      if (node.attrs?.blockId && wanted.has(node.attrs.blockId)) return node;
      const content = node.content
        ?.map((child) => prune(child as typeof node))
        .filter((n) => n !== null);
      if (!content?.length) return null;
      return { ...node, content };
    };
    return prune(JSON.parse(doc.prosemirrorJson)) ?? { type: "doc", content: [] };
  }
  currentRange(documentId: string, start: string, end: string): BlockId[] {
    const ids = this.unitIds(documentId);
    const from = ids.indexOf(start),
      to = ids.indexOf(end);
    if (from < 0 || to < from) throw new Error("Section range unavailable");
    return ids.slice(from, to + 1) as BlockId[];
  }
}
