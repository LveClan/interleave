import { createHash } from "node:crypto";
import type {
  ApplySkimRequest,
  BlockId,
  ElementId,
  IsoTimestamp,
  SectionReaderData,
  SkimReceipt,
  SourceStructure,
  StructureRange,
} from "@interleave/core";
import {
  assets,
  documentBlocks,
  documentMarks,
  documents,
  elementRelations,
  elements,
  elementTags,
  type InterleaveDatabase,
  readPoints,
  settings,
  sourceBlockProcessing,
  sourceLocations,
  sourceSections,
  sources,
} from "@interleave/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { BlockProcessingRepository } from "./block-processing-repository";
import { BlockProcessingService, computeBlockContentHashes } from "./block-processing-service";
import { ElementRepository } from "./element-repository";
import { newRowId, nowIso } from "./ids";
import { OperationLogRepository, withOperationContext } from "./operation-log-repository";
import { ProcessingUnitRepository } from "./processing-unit-repository";
import { SourceRepository } from "./source-repository";
import { rangeHash, SourceSectionRepository } from "./source-section-repository";

export interface OutlineEntry {
  title: string;
  page: number;
  depth: number;
}
interface HeadingNode {
  type?: string;
  text?: string;
  attrs?: { blockId?: string; level?: number };
  content?: HeadingNode[];
}
type StateSnapshot = ReturnType<SourceStructureService["snapshot"]>;
export class SourceStructureService {
  constructor(private readonly db: InterleaveDatabase) {}
  private requireSource(sourceId: string) {
    const row = this.db
      .select({ element: elements, source: sources })
      .from(elements)
      .innerJoin(sources, eq(sources.elementId, elements.id))
      .where(
        and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
      )
      .get();
    if (!row || row.source.mediaKind) throw new Error("Skim source unavailable");
    return row;
  }
  list(sourceId: string, outline: readonly OutlineEntry[] = []): SourceStructure {
    const { element, source } = this.requireSource(sourceId);
    const repo = new SourceSectionRepository(this.db);
    const chapters = repo.epubChapters(sourceId);
    const format = chapters
      ? "epub"
      : source.snapshotKey?.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : "document";
    const ranges: StructureRange[] = [];
    const units: { id: string; label: string; documentId: string }[] = [];
    const add = (
      documentId: string,
      ids: string[],
      title: string,
      depth = 0,
      topicId: string | null = null,
    ) => {
      if (!ids.length) return;
      ranges.push(this.range(sourceId, documentId, ids, title, depth, topicId, element.priority));
    };
    if (chapters) {
      for (const chapter of chapters) {
        const ids = repo.unitIds(chapter.topic.id);
        add(chapter.topic.id, ids, chapter.topic.title, 0, chapter.topic.id);
        ids.forEach((id, i) => {
          units.push({
            id,
            label: `${chapter.topic.title}: ${i + 1}`,
            documentId: chapter.topic.id,
          });
        });
      }
    } else {
      const ids = repo.unitIds(sourceId);
      ids.forEach((id, i) => {
        units.push({ id, label: String(i + 1), documentId: sourceId });
      });
      if (format === "pdf") {
        const ordered = outline
          .filter((entry) => ids.includes(`pdf:page:${entry.page}`))
          .sort((a, b) => a.page - b.page || a.depth - b.depth);
        if (ordered.length) {
          const first = ids.indexOf(`pdf:page:${ordered[0]?.page}`);
          if (first > 0) add(sourceId, ids.slice(0, first), "Front matter");
          ordered.forEach((entry, i) => {
            const next = ordered
              .slice(i + 1)
              .find((other) => other.depth <= entry.depth && other.page > entry.page);
            add(
              sourceId,
              ids.slice(
                ids.indexOf(`pdf:page:${entry.page}`),
                next ? ids.indexOf(`pdf:page:${next.page}`) : undefined,
              ),
              entry.title,
              entry.depth,
            );
          });
        } else
          for (let i = 0; i < ids.length; i += 20)
            add(sourceId, ids.slice(i, i + 20), `Pages ${i + 1}-${Math.min(i + 20, ids.length)}`);
      } else {
        const doc = this.db.select().from(documents).where(eq(documents.elementId, sourceId)).get();
        const headings: { id: string; level: number; title: string }[] = [];
        const walk = (node: HeadingNode): string => {
          const text = node.text ?? (node.content ?? []).map(walk).join(" ");
          if (node.type === "heading" && node.attrs?.blockId && ids.includes(node.attrs.blockId))
            headings.push({ id: node.attrs.blockId, level: node.attrs.level ?? 1, title: text });
          return text;
        };
        if (doc) walk(JSON.parse(doc.prosemirrorJson));
        headings.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        if (headings.length) {
          const first = ids.indexOf(headings[0]?.id ?? "");
          if (first > 0) add(sourceId, ids.slice(0, first), "Introduction");
          headings.forEach((heading, i) => {
            const next = headings.slice(i + 1).find((h) => h.level <= heading.level);
            add(
              sourceId,
              ids.slice(ids.indexOf(heading.id), next ? ids.indexOf(next.id) : undefined),
              heading.title,
              heading.level - 1,
            );
          });
        } else
          for (let i = 0; i < ids.length; i += 30)
            add(
              sourceId,
              ids.slice(i, i + 30),
              `Passages ${i + 1}-${Math.min(i + 30, ids.length)}`,
            );
      }
    }
    for (const { section, topic } of repo.list(sourceId))
      if (!ranges.some((r) => r.key === section.rangeKey)) {
        const ids: string[] = JSON.parse(section.unitIds);
        ranges.push({
          key: section.rangeKey,
          title: topic.title,
          depth: 0,
          documentId: section.documentId,
          unitIds: ids,
          fingerprint: repo.valid(section)
            ? this.range(sourceId, section.documentId, ids, topic.title).fingerprint
            : rangeHash(ids),
          topicId: topic.id,
          verdict: section.verdict as StructureRange["verdict"],
          priority: topic.priority,
          valid: repo.valid(section),
        });
      }
    return {
      sourceId,
      format,
      ranges: [...new Map(ranges.map((range) => [range.key, range])).values()],
      units,
    };
  }
  range(
    sourceId: string,
    documentId: string,
    ids: string[],
    title: string,
    depth = 0,
    topicId: string | null = null,
    priority = 0.5,
  ): StructureRange {
    this.requireSource(sourceId);
    const repo = new SourceSectionRepository(this.db);
    if (
      documentId !== sourceId &&
      !repo.epubChapters(sourceId)?.some((c) => c.topic.id === documentId)
    )
      throw new Error("Range document is not a chapter");
    const key = `${documentId}:${ids[0]}:${ids.at(-1)}`;
    const existing = repo.list(sourceId).find(({ section }) => section.rangeKey === key);
    const hashes = new ProcessingUnitRepository(this.db)
      .units(documentId as ElementId)
      ?.map((u) => [u.id, u.hash]) ?? [
      ...computeBlockContentHashes(
        JSON.parse(
          this.db.select().from(documents).where(eq(documents.elementId, documentId)).get()
            ?.prosemirrorJson ?? "null",
        ),
      ),
    ];
    const map = new Map(hashes as [string, string][]);
    return {
      key,
      title,
      depth,
      documentId,
      unitIds: ids,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(ids.map((id) => [id, map.get(id)])))
        .digest("hex"),
      topicId: existing?.topic.id ?? topicId,
      verdict: (existing?.section.verdict as StructureRange["verdict"]) ?? null,
      priority: existing?.topic.priority ?? priority,
      valid: true,
    };
  }
  manual(sourceId: string, documentId: string, start: string, end: string, title: string) {
    const repo = new SourceSectionRepository(this.db);
    return this.range(sourceId, documentId, repo.currentRange(documentId, start, end), title);
  }
  reader(topicId: string): SectionReaderData | null {
    const repo = new SourceSectionRepository(this.db);
    const section = repo.find(topicId);
    if (!section) return null;
    const topic = this.db
      .select()
      .from(elements)
      .where(and(eq(elements.id, topicId), isNull(elements.deletedAt)))
      .get();
    if (!topic) return null;
    const source = this.requireSource(section.sourceId);
    const ids: string[] = JSON.parse(section.unitIds);
    const pdf = ids.some((id) => id.startsWith("pdf:page:"));
    const blocks = this.db
      .select()
      .from(documentBlocks)
      .where(eq(documentBlocks.documentId, section.documentId))
      .all();
    const selected = pdf
      ? blocks.filter((b) => b.page != null && ids.includes(`pdf:page:${b.page}`))
      : blocks.filter((b) => ids.includes(b.stableBlockId));
    const processing = new BlockProcessingService(this.db);
    return {
      topicId,
      sourceId: section.sourceId,
      sourceTitle: source.element.title,
      title: topic.title,
      contentDocumentId: section.documentId,
      valid: repo.valid(section),
      format: pdf ? "pdf" : "document",
      document: repo.body(
        section.documentId,
        selected.map((b) => b.stableBlockId),
      ),
      blockPages: Object.fromEntries(
        selected.filter((b) => b.page != null).map((b) => [b.stableBlockId, b.page as number]),
      ),
      blocks: processing.listBlockViews(topicId as ElementId).map((view) => ({
        ...view,
        blockContentHash: this.hashForView(view.sourceElementId, view.stableBlockId),
      })),
      summary: processing.getSourceProcessingSummary(topicId as ElementId),
    };
  }
  setUnit(input: {
    topicId: string;
    blockId: string;
    contentHash: string;
    state: "read" | "unread" | "ignored" | "needs_later" | "processed_without_output";
  }) {
    return this.db.transaction((tx) => {
      const reader = this.reader(input.topicId);
      const view = reader?.blocks.find((b) => b.stableBlockId === input.blockId);
      if (
        !reader?.valid ||
        !view ||
        this.hashForView(reader.contentDocumentId, input.blockId) !== input.contentHash
      )
        throw new Error("Section changed");
      if (view.outputElementIds.length && !view.geometry)
        throw new Error("Extracted block has live outputs");
      new BlockProcessingRepository(tx).upsertStateWithin(tx, {
        sourceElementId: reader.contentDocumentId as ElementId,
        stableBlockId: input.blockId as BlockId,
        state: input.state,
        blockContentHash: input.contentHash,
        action: `mark_${input.state}`,
      });
      if (input.state === "needs_later")
        new ElementRepository(this.db).rescheduleWithin(
          tx,
          input.topicId as ElementId,
          new Date(Date.now() + 7 * 86400000).toISOString() as IsoTimestamp,
          "scheduled",
        );
      return this.reader(input.topicId);
    });
  }
  hashForView(documentId: string, blockId: string): string | null {
    return (
      new ProcessingUnitRepository(this.db)
        .units(documentId as ElementId)
        ?.find((u) => u.id === blockId)?.hash ?? this.hash(documentId, blockId)
    );
  }
  finish(topicId: string, intent: "finished" | "return_later" | "abandon"): SkimReceipt {
    const reader = this.reader(topicId);
    if (!reader?.valid) throw new Error("Section unavailable");
    const token = newRowId();
    return this.db.transaction((tx) =>
      withOperationContext(tx, { skimBatch: token, batchId: token }, () => {
        const previous = this.snapshot(reader.sourceId);
        const states = new BlockProcessingRepository(tx);
        for (const view of reader.blocks) {
          if (view.outputElementIds.length && !view.geometry) continue;
          const state =
            intent === "finished"
              ? "processed_without_output"
              : intent === "abandon"
                ? "ignored"
                : "needs_later";
          states.upsertStateWithin(tx, {
            sourceElementId: reader.contentDocumentId as ElementId,
            stableBlockId: view.stableBlockId,
            state,
            action: `mark_${state}`,
            blockContentHash: this.hashForView(reader.contentDocumentId, view.stableBlockId),
          });
        }
        new ElementRepository(this.db).rescheduleWithin(
          tx,
          topicId as ElementId,
          intent === "return_later"
            ? (new Date(Date.now() + 7 * 86400000).toISOString() as IsoTimestamp)
            : null,
          intent === "return_later" ? "scheduled" : "done",
        );
        const after = this.snapshot(reader.sourceId);
        tx.insert(settings)
          .values({ key: `skim.receipt:${token}`, value: JSON.stringify({ previous, after }) })
          .run();
        new OperationLogRepository(tx).append(tx, {
          opType: "update_document",
          elementId: topicId,
          payload: { sectionFinish: intent },
        });
        return { sourceId: reader.sourceId, token };
      }),
    );
  }
  apply(input: ApplySkimRequest): SkimReceipt {
    this.requireSource(input.sourceId);
    const token = newRowId();
    return this.db.transaction((tx) =>
      withOperationContext(tx, { skimBatch: token, batchId: token }, () => {
        const service = new SourceStructureService(tx as InterleaveDatabase);
        const repo = new SourceSectionRepository(tx);
        const previous = service.snapshot(input.sourceId);
        const seen = new Set<string>();
        const validated = input.decisions.map((decision) => {
          const r = decision.range;
          const registeredTopic = repo.find(r.documentId);
          if (
            registeredTopic &&
            registeredTopic.rangeKey !== r.key &&
            rangeHash(r.unitIds) !== rangeHash(repo.unitIds(r.documentId))
          )
            throw new Error("Select the complete updated EPUB chapter");
          const ids = repo.currentRange(r.documentId, r.unitIds[0] ?? "", r.unitIds.at(-1) ?? "");
          const current = service.range(
            input.sourceId,
            r.documentId,
            ids,
            r.title,
            r.depth,
            r.topicId,
            decision.priority,
          );
          if (current.fingerprint !== r.fingerprint || rangeHash(ids) !== rangeHash(r.unitIds))
            throw new Error("Section changed; refresh skim");
          for (const id of ids) {
            const key = `${r.documentId}:${id}`;
            if (seen.has(key)) throw new Error("Overlapping section selections");
            seen.add(key);
            if (
              repo
                .list(input.sourceId)
                .some(
                  ({ section }) =>
                    section.rangeKey !== current.key &&
                    section.topicId !== current.documentId &&
                    section.documentId === r.documentId &&
                    repo.valid(section) &&
                    (JSON.parse(section.unitIds) as string[]).includes(id),
                )
            )
              throw new Error("Range belongs to another chapter");
          }
          return { ...decision, range: current };
        });
        const sourceRepo = new SourceRepository(this.db);
        const elementsRepo = new ElementRepository(this.db);
        for (const { range, verdict, priority } of validated) {
          const existing = repo
            .list(input.sourceId, true)
            .find(
              ({ section }) =>
                section.rangeKey === range.key ||
                (section.topicId === range.documentId &&
                  rangeHash(range.unitIds) === rangeHash(repo.unitIds(range.documentId))),
            );
          const epub = repo
            .epubChapters(input.sourceId)
            ?.find(
              (c) =>
                c.topic.id === range.documentId &&
                range.unitIds.length === repo.unitIds(range.documentId).length,
            );
          const topicId =
            existing?.topic.id ??
            epub?.topic.id ??
            sourceRepo.createTopicWithDocumentWithin(tx, {
              title: range.title,
              priority,
              status: "active",
              stage: "rough_topic",
              parentId: input.sourceId as ElementId,
              sourceId: input.sourceId as ElementId,
              body: "",
            }).element.id;
          if (existing?.topic.deletedAt) elementsRepo.restoreWithin(tx, topicId as ElementId);
          // A new decision supersedes obsolete ownership, even if old source text later returns.
          for (const { section } of repo.list(input.sourceId, true)) {
            if (
              section.topicId !== topicId &&
              section.documentId === range.documentId &&
              (JSON.parse(section.unitIds) as string[]).some((id) => range.unitIds.includes(id))
            ) {
              tx.update(sourceSections)
                .set({ rangeHash: "" })
                .where(eq(sourceSections.topicId, section.topicId))
                .run();
            }
          }
          if (!existing && !epub) {
            elementsRepo.addRelationWithin(tx, {
              fromElementId: input.sourceId as ElementId,
              toElementId: topicId as ElementId,
              relationType: "parent_child",
            });
            sourceRepo.createElementLocationWithin(tx, {
              elementId: topicId as ElementId,
              sourceElementId: range.documentId as ElementId,
              blockIds: range.unitIds.filter((id) => !id.startsWith("pdf:page:")) as BlockId[],
              page: range.unitIds[0]?.startsWith("pdf:page:")
                ? Number(range.unitIds[0].slice(9))
                : null,
              label: range.title,
            });
          }
          tx.insert(sourceSections)
            .values({
              topicId,
              sourceId: input.sourceId,
              documentId: range.documentId,
              rangeKey: range.key,
              unitIds: JSON.stringify(range.unitIds),
              rangeHash: rangeHash(range.unitIds),
              verdict,
            })
            .onConflictDoUpdate({
              target: sourceSections.topicId,
              set: {
                rangeKey: range.key,
                verdict,
                unitIds: JSON.stringify(range.unitIds),
                rangeHash: rangeHash(range.unitIds),
              },
            })
            .run();
          const dueAt =
            verdict === "ignore"
              ? null
              : (new Date(
                  Date.now() + (verdict === "later" ? 7 * 86400000 : 0),
                ).toISOString() as IsoTimestamp);
          if (!existing || existing.topic.priority !== priority) {
            elementsRepo.updateWithin(tx, topicId as ElementId, { priority });
          }
          const rangeChanged = existing?.section.rangeHash !== rangeHash(range.unitIds);
          const reopening =
            existing &&
            existing.topic.priority === priority &&
            ["done", "dismissed"].includes(existing.topic.status) &&
            !repo.activeOwnership(existing.section);
          if (
            !existing ||
            existing.topic.deletedAt ||
            existing.section.verdict !== verdict ||
            rangeChanged ||
            reopening
          ) {
            elementsRepo.rescheduleWithin(
              tx,
              topicId as ElementId,
              dueAt,
              verdict === "ignore" ? "done" : "scheduled",
            );
            const hashes = new Map(
              new BlockProcessingService(this.db)
                .listBlockViews(range.documentId as ElementId)
                .map((view) => [view.stableBlockId, view]),
            );
            const processing = new BlockProcessingRepository(tx);
            for (const id of range.unitIds) {
              if (
                existing &&
                rangeChanged &&
                existing.section.verdict === verdict &&
                JSON.parse(existing.section.unitIds).includes(id)
              )
                continue;
              const view = hashes.get(id as BlockId);
              if (view?.outputElementIds.length && !view.geometry) continue;
              processing.upsertStateWithin(tx, {
                sourceElementId: range.documentId as ElementId,
                stableBlockId: id as BlockId,
                state:
                  verdict === "ignore" ? "ignored" : verdict === "later" ? "needs_later" : "unread",
                action:
                  verdict === "ignore"
                    ? "mark_ignored"
                    : verdict === "later"
                      ? "mark_needs_later"
                      : "mark_unread",
                blockContentHash: service.hashForView(range.documentId, id),
              });
            }
          }
        }
        const parent = service.requireSource(input.sourceId).element;
        const resumesWork = validated.some((decision) => decision.verdict !== "ignore");
        if (
          (resumesWork && ["done", "dismissed", "suspended"].includes(parent.status)) ||
          (parent.dueAt == null &&
            !["done", "deleted", "dismissed", "suspended"].includes(parent.status))
        )
          elementsRepo.updateWithin(tx, parent.id as ElementId, {
            status: "scheduled",
            dueAt: nowIso(),
          });
        const after = service.snapshot(input.sourceId);
        tx.insert(settings)
          .values({ key: `skim.receipt:${token}`, value: JSON.stringify({ previous, after }) })
          .run();
        new OperationLogRepository(tx).append(tx, {
          opType: "update_document",
          elementId: input.sourceId,
          payload: { skimApply: { token, topicIds: validated.map((v) => v.range.key) } },
        });
        return { sourceId: input.sourceId, token };
      }),
    );
  }
  private hash(documentId: string, blockId: string): string | null {
    const doc = this.db.select().from(documents).where(eq(documents.elementId, documentId)).get();
    return (
      computeBlockContentHashes(doc ? JSON.parse(doc.prosemirrorJson) : null).get(
        blockId as BlockId,
      ) ?? null
    );
  }
  snapshot(sourceId: string) {
    const topics = this.db
      .select()
      .from(elements)
      .where(eq(elements.parentId, sourceId))
      .all()
      .filter((e) => e.type === "topic");
    const ids = [sourceId, ...topics.map((t) => t.id)];
    return {
      relations: this.db
        .select()
        .from(elementRelations)
        .where(
          or(
            inArray(elementRelations.fromElementId, ids),
            inArray(elementRelations.toElementId, ids),
          ),
        )
        .all(),
      tags: this.db.select().from(elementTags).where(inArray(elementTags.elementId, ids)).all(),
      marks: this.db
        .select()
        .from(documentMarks)
        .where(inArray(documentMarks.documentId, ids))
        .all(),
      assets: this.db.select().from(assets).where(inArray(assets.owningElementId, ids)).all(),
      elements: this.db.select().from(elements).where(inArray(elements.id, ids)).all(),
      sections: this.db
        .select()
        .from(sourceSections)
        .where(eq(sourceSections.sourceId, sourceId))
        .all(),
      states: this.db
        .select()
        .from(sourceBlockProcessing)
        .where(inArray(sourceBlockProcessing.sourceElementId, ids))
        .all(),
      docs: this.db.select().from(documents).where(inArray(documents.elementId, ids)).all(),
      points: this.db.select().from(readPoints).where(inArray(readPoints.elementId, ids)).all(),
      locations: this.db
        .select()
        .from(sourceLocations)
        .where(inArray(sourceLocations.sourceElementId, ids))
        .all(),
      descendants: this.db.select().from(elements).where(eq(elements.sourceId, sourceId)).all(),
    };
  }
  undo(receipt: SkimReceipt): boolean {
    return this.db.transaction((tx) =>
      withOperationContext(tx, { skimBatch: receipt.token, batchId: receipt.token }, () => {
        const row = tx
          .select()
          .from(settings)
          .where(eq(settings.key, `skim.receipt:${receipt.token}`))
          .get();
        if (!row) return false;
        const saved = JSON.parse(row.value) as { previous: StateSnapshot; after: StateSnapshot };
        if (JSON.stringify(this.snapshot(receipt.sourceId)) !== JSON.stringify(saved.after))
          return false;
        const previousIds = new Set(saved.previous.elements.map((e) => e.id));
        for (const element of saved.after.elements) {
          if (previousIds.has(element.id)) continue;
          tx.delete(elementRelations).where(eq(elementRelations.toElementId, element.id)).run();
          tx.delete(sourceLocations).where(eq(sourceLocations.elementId, element.id)).run();
          tx.delete(documents).where(eq(documents.elementId, element.id)).run();
          tx.delete(sourceSections).where(eq(sourceSections.topicId, element.id)).run();
          tx.delete(elements).where(eq(elements.id, element.id)).run();
        }
        for (const element of saved.previous.elements)
          tx.update(elements).set(element).where(eq(elements.id, element.id)).run();
        tx.delete(sourceSections).where(eq(sourceSections.sourceId, receipt.sourceId)).run();
        for (const section of saved.previous.sections)
          tx.insert(sourceSections).values(section).run();
        const ids = saved.previous.elements.map((e) => e.id);
        tx.delete(sourceBlockProcessing)
          .where(inArray(sourceBlockProcessing.sourceElementId, ids))
          .run();
        for (const state of saved.previous.states)
          tx.insert(sourceBlockProcessing).values(state).run();
        tx.delete(settings).where(eq(settings.key, row.key)).run();
        new OperationLogRepository(tx).append(tx, {
          opType: "update_document",
          elementId: receipt.sourceId,
          payload: { skimUndo: receipt.token },
        });
        return true;
      }),
    );
  }
}
