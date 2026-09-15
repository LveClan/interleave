import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockId, ElementId, IsoTimestamp, StructureRange } from "@interleave/core";
import {
  type DbHandle,
  elements,
  openDatabase,
  operationLog,
  sourceLocations,
  sourceSections,
  sources,
} from "@interleave/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BlockProcessingService } from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { ElementRepository } from "./element-repository";
import { ExtractionService } from "./extraction-service";
import { createRepositories } from "./index";
import { QueueActionService } from "./queue-action-service";
import { QueueQuery } from "./queue-query";
import { QueueRepository } from "./queue-repository";
import { SourcePendingService } from "./source-pending-service";
import { SourceRepository } from "./source-repository";
import { SourceReturnBriefingQuery } from "./source-return-briefing-query";
import { SourceStructureService } from "./source-structure-service";
import { SourceYieldQuery } from "./source-yield-query";
import { createInMemoryDb } from "./test-db";

let handle: DbHandle, id: ElementId, service: SourceStructureService;
beforeEach(() => {
  handle = createInMemoryDb();
  id = new SourceRepository(handle.db).createWithDocument({
    title: "Book",
    priority: 0.5,
    status: "scheduled",
    body: "",
  }).element.id;
  const content = ["Intro", "First", "Text A", "Nested", "Text B", "Second", "Text C"].map(
    (text, i) => ({
      type: [1, 3, 5].includes(i) ? "heading" : "paragraph",
      attrs: { blockId: `b${i}`, level: i === 3 ? 2 : 1 },
      content: [{ type: "text", text }],
    }),
  );
  new DocumentRepository(handle.db).upsert({
    elementId: id,
    prosemirrorJson: { type: "doc", content },
    plainText: "Book",
    blocks: content.map((node, i) => ({
      stableBlockId: `b${i}` as BlockId,
      blockType: node.type,
      order: i,
    })),
  });
  handle.db
    .update(elements)
    .set({ dueAt: "2026-01-01T00:00:00Z" })
    .where(eq(elements.id, id))
    .run();
  service = new SourceStructureService(handle.db);
});
afterEach(() => handle.sqlite.close());
it("keeps manual ranges editable after reload and supplies section identity to the real queue projection", () => {
  const range = service.manual(id, id, "b2", "b3", "Manual");
  apply(range);
  const topicId = handle.db.select().from(sourceSections).get()?.topicId as string;
  const current = service.list(id).ranges.find((r) => r.topicId === topicId) as StructureRange;
  apply(current, "later");
  const row = new QueueQuery(createRepositories(handle.db)).summaryFor(
    topicId as ElementId,
    "2030-01-01T00:00:00Z" as IsoTimestamp,
  );
  expect(row?.sectionSourceTitle).toBe("Book");
  expect(service.reader(topicId)?.blocks.every((b) => b.state === "needs_later")).toBe(true);
});
it("routes section queue completion and abandonment through one undoable batch", () => {
  apply(service.list(id).ranges[1] as StructureRange);
  const topicId = handle.db.select().from(sourceSections).get()?.topicId as ElementId;
  const queue = new QueueActionService(handle.db);
  expect(() => queue.act(topicId, "markDone")).toThrow("unresolved");
  const result = queue.act(topicId, "markDone", undefined, { confirmUnresolvedBlocks: true });
  expect(service.reader(topicId)?.summary.unresolvedBlocks).toBe(0);
  expect(result.undo?.skimReceipt).toBeTruthy();
  if (!result.undo) throw new Error("No receipt");
  queue.undo(topicId, result.undo);
  expect(service.reader(topicId)?.summary.unresolvedBlocks).toBe(4);
  const abandoned = queue.act(topicId, "dismiss");
  expect(service.reader(topicId)?.summary.ignoredBlocks).toBe(4);
  if (!abandoned.undo) throw new Error("No receipt");
  queue.undo(topicId, abandoned.undo);
  expect(service.reader(topicId)?.summary.unresolvedBlocks).toBe(4);
});
it("protects later tags from batch undo and returns stale finished content to the parent", () => {
  const ranges = service.list(id).ranges.filter((r) => r.depth === 0);
  const receipt = service.apply({
    sourceId: id,
    decisions: ranges.map((range) => ({ range, verdict: "ignore", priority: 0.5 })),
  });
  const topicId = handle.db.select().from(sourceSections).get()?.topicId as ElementId;
  new ElementRepository(handle.db).addTag(topicId, "Later tag");
  expect(service.undo(receipt)).toBe(false);
  const docs = new DocumentRepository(handle.db);
  const doc = docs.findById(id);
  const changed = JSON.parse(JSON.stringify(doc?.prosemirrorJson));
  changed.content[0].content[0].text = "Edited introduction";
  handle.db.transaction((tx) => {
    docs.upsertWithin(tx, { elementId: id, prosemirrorJson: changed, plainText: "Changed" });
    new BlockProcessingService(handle.db).reconcileSourceDocumentWithin(tx, id, changed);
  });
  expect(new QueueRepository(handle.db).ownsReadingRange(id)).toBe(true);
  const data = service.reader(topicId);
  const view = data?.blocks[0];
  if (!view?.blockContentHash) throw new Error("no current hash");
  service.setUnit({
    topicId,
    blockId: view.stableBlockId,
    contentHash: view.blockContentHash,
    state: "read",
  });
  expect(service.reader(topicId)?.blocks[0]?.state).toBe("read");
  expect(
    new SourceYieldQuery(handle.db).getSourceYield(id, "2030-01-01T00:00:00Z" as IsoTimestamp)
      ?.readPct,
  ).toBe(1 / 7);
});
it("keeps sections, lineage and batch undo after reopening SQLite", async () => {
  const receipt = apply(service.list(id).ranges[1] as StructureRange, "later");
  const dir = mkdtempSync(join(tmpdir(), "interleave-skim-"));
  try {
    await handle.sqlite.backup(join(dir, "db.sqlite"));
    handle.sqlite.close();
    handle = openDatabase(join(dir, "db.sqlite"));
    service = new SourceStructureService(handle.db);
    expect(handle.db.select().from(sourceSections).all()).toHaveLength(1);
    expect(service.undo(receipt)).toBe(true);
    expect(handle.db.select().from(sourceLocations).all()).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("priority-only skim changes preserve processing state and return date", () => {
  const first = service.list(id).ranges[1] as StructureRange;
  apply(first);
  const topicId = handle.db.select().from(sourceSections).get()?.topicId as string;
  const block = service.reader(topicId)?.blocks[0];
  if (!block?.blockContentHash) throw new Error("missing");
  service.setUnit({
    topicId,
    blockId: block.stableBlockId,
    contentHash: block.blockContentHash,
    state: "read",
  });
  const due = handle.db.select().from(elements).where(eq(elements.id, topicId)).get()?.dueAt;
  const current = service.list(id).ranges.find((r) => r.key === first.key) as StructureRange;
  service.apply({
    sourceId: id,
    decisions: [{ range: current, verdict: "extract_worthy", priority: 0.125 }],
  });
  expect(service.reader(topicId)?.blocks[0]?.state).toBe("read");
  expect(handle.db.select().from(elements).where(eq(elements.id, topicId)).get()?.dueAt).toBe(due);
});
it("reopens a finished parent for a real chapter return and restores it with batch undo", () => {
  new ElementRepository(handle.db).reschedule(id, null);
  new ElementRepository(handle.db).update(id, { status: "done" });
  const receipt = apply(service.list(id).ranges[1] as StructureRange, "later");
  const topicId = handle.db.select().from(sourceSections).get()?.topicId as ElementId;
  expect(new QueueRepository(handle.db).ownsReadingRange(topicId)).toBe(true);
  expect(
    new QueueRepository(handle.db)
      .dueAttentionItems("2030-01-01T00:00:00Z" as IsoTimestamp)
      .map((e) => e.id),
  ).toContain(topicId);
  expect(service.undo(receipt)).toBe(true);
  expect(handle.db.select().from(elements).where(eq(elements.id, id)).get()?.status).toBe("done");
});
it("reuses EPUB chapter topics and their original source locations", () => {
  handle.db
    .update(sources)
    .set({ snapshotKey: "book.epub" })
    .where(eq(sources.elementId, id))
    .run();
  const repo = new SourceRepository(handle.db);
  const chapter = handle.db.transaction((tx) => {
    const topic = repo.createTopicWithDocumentWithin(tx, {
      title: "Chapter",
      body: "One\n\nTwo",
      sourceId: id,
      parentId: id,
      priority: 0.5,
      status: "inbox",
    });
    repo.createElementLocationWithin(tx, {
      elementId: topic.element.id,
      sourceElementId: id,
      page: 1,
      label: "Chapter",
    });
    return topic.element;
  });
  const location = handle.db.select().from(sourceLocations).all();
  const range = service.list(id).ranges[0] as StructureRange;
  const receipt = apply(range, "later");
  expect(handle.db.select().from(sourceSections).get()?.topicId).toBe(chapter.id);
  expect(handle.db.select().from(sourceLocations).all()).toEqual(location);
  expect(service.reader(chapter.id)?.blocks).toHaveLength(2);
  expect(new BlockProcessingService(handle.db).getSourceProcessingSummary(id).totalBlocks).toBe(2);
  const docs = new DocumentRepository(handle.db);
  const prior = docs.findById(chapter.id);
  const changed = JSON.parse(JSON.stringify(prior?.prosemirrorJson));
  changed.content.push({
    type: "paragraph",
    attrs: { blockId: "new-tail" },
    content: [{ type: "text", text: "New tail" }],
  });
  docs.upsert({
    elementId: chapter.id,
    prosemirrorJson: changed,
    plainText: "One Two New tail",
    blocks: [
      ...docs.listBlocks(chapter.id).map((b) => ({
        stableBlockId: b.stableBlockId as BlockId,
        blockType: b.blockType,
        order: b.order,
      })),
      { stableBlockId: "new-tail" as BlockId, blockType: "paragraph", order: 2 },
    ],
  });
  apply(
    service
      .list(id)
      .ranges.find(
        (r) => r.documentId === chapter.id && r.unitIds.includes("new-tail"),
      ) as StructureRange,
    "later",
  );
  expect(handle.db.select().from(sourceSections).get()?.topicId).toBe(chapter.id);
  expect(service.reader(chapter.id)?.valid).toBe(true);
  expect(service.reader(chapter.id)?.blocks.at(-1)?.state).toBe("needs_later");
  expect(service.undo(receipt)).toBe(false);
  const blockId = new DocumentRepository(handle.db).listBlocks(chapter.id)[0]
    ?.stableBlockId as BlockId;
  const output = new ExtractionService(handle.db).createExtraction({
    sourceElementId: id,
    parentId: chapter.id,
    blockIds: [blockId],
    selectedText: "One",
    priority: 0.5,
  });
  expect(output.element.sourceId).toBe(id);
  expect(output.location.sourceElementId).toBe(chapter.id);
  const removedId = "new-tail" as BlockId;
  const withoutTail = JSON.parse(JSON.stringify(changed));
  withoutTail.content.pop();
  handle.db.transaction((tx) => {
    docs.upsertWithin(tx, {
      elementId: chapter.id,
      prosemirrorJson: withoutTail,
      plainText: "One Two",
      blocks: docs
        .listBlocks(chapter.id)
        .filter((b) => b.stableBlockId !== removedId)
        .map((b) => ({
          stableBlockId: b.stableBlockId as BlockId,
          blockType: b.blockType,
          order: b.order,
        })),
    });
    new BlockProcessingService(handle.db).reconcileSourceDocumentWithin(
      tx,
      chapter.id,
      withoutTail,
    );
  });
  expect(
    new SourcePendingService(handle.db).list(id)?.entries.find((e) => e.blockId === removedId),
  ).toMatchObject({ locatable: false, order: null });
  expect(
    new SourceReturnBriefingQuery(handle.db).get({
      sourceId: id,
      asOf: "2030-01-01T00:00:00Z" as IsoTimestamp,
      scheduledReturn: true,
      clusters: { enabled: false },
    }),
  ).toMatchObject({
    show: true,
    readPctDelta: null,
    stateCounts: { stale_after_edit: 1 },
    lastExtraction: { elementId: output.element.id },
  });
});
it("maps PDF bookmarks to inclusive pages and releases ownership when a range becomes invalid", () => {
  handle.db.update(sources).set({ snapshotKey: "book.pdf" }).where(eq(sources.elementId, id)).run();
  const docs = new DocumentRepository(handle.db);
  const save = (pages: number[]) =>
    docs.upsert({
      elementId: id,
      plainText: "PDF",
      prosemirrorJson: {
        type: "doc",
        content: pages.map((page) => ({
          type: "paragraph",
          attrs: { blockId: `p${page}` },
          content: [{ type: "text", text: `Page ${page}` }],
        })),
      },
      blocks: pages.map((page, order) => ({
        stableBlockId: `p${page}` as BlockId,
        order,
        blockType: "paragraph",
        page,
      })),
    });
  save([1, 2, 3, 4]);
  const ranges = service.list(id, [
    { title: "Main", page: 2, depth: 0 },
    { title: "Sub", page: 3, depth: 1 },
    { title: "End", page: 4, depth: 0 },
  ]).ranges;
  expect(
    service
      .list(id, [
        { title: "Part", page: 2, depth: 0 },
        { title: "Same", page: 2, depth: 1 },
      ])
      .ranges.filter((r) => r.unitIds[0] === "pdf:page:2"),
  ).toHaveLength(1);
  expect(ranges.map((r) => r.unitIds)).toEqual([
    ["pdf:page:1"],
    ["pdf:page:2", "pdf:page:3"],
    ["pdf:page:3"],
    ["pdf:page:4"],
  ]);
  apply(ranges[1] as StructureRange);
  const topic = handle.db.select().from(sourceSections).get()?.topicId as string;
  save([1, 2, 4]);
  expect(service.reader(topic)?.valid).toBe(false);
  expect(new QueueRepository(handle.db).ownsReadingRange(topic)).toBe(false);
  expect(new QueueRepository(handle.db).ownsReadingRange(id)).toBe(true);
  apply(service.manual(id, id, "pdf:page:2", "pdf:page:2", "Replacement"));
  const replacement = handle.db
    .select()
    .from(sourceSections)
    .all()
    .find((s) => s.topicId !== topic)?.topicId as string;
  save([1, 2, 3, 4]);
  expect(service.reader(topic)?.valid).toBe(false);
  expect(service.reader(replacement)?.valid).toBe(true);
  expect(new QueueRepository(handle.db).ownsReadingRange(topic)).toBe(false);
  expect(new QueueRepository(handle.db).ownsReadingRange(replacement)).toBe(true);
});
const apply = (
  range: StructureRange,
  verdict: "extract_worthy" | "later" | "ignore" = "extract_worthy",
) => service.apply({ sourceId: id, decisions: [{ range, verdict, priority: 0.8 }] });
it("derives nested ranges, rejects overlap, reuses chapters and leaves parent remainder reachable", () => {
  const structure = service.list(id);
  expect(structure.ranges.map((r) => r.unitIds)).toEqual([
    ["b0"],
    ["b1", "b2", "b3", "b4"],
    ["b3", "b4"],
    ["b5", "b6"],
  ]);
  const first = structure.ranges[1] as StructureRange;
  expect(() =>
    service.apply({
      sourceId: id,
      decisions: [first, structure.ranges[2] as StructureRange].map((range) => ({
        range,
        verdict: "later",
        priority: 0.5,
      })),
    }),
  ).toThrow("Overlapping");
  expect(handle.db.select().from(sourceSections).all()).toHaveLength(0);
  const receipt = apply(first);
  const rows = handle.db.select().from(sourceSections).all();
  const topicId = rows[0]?.topicId as string;
  expect(service.reader(topicId)?.blocks).toHaveLength(4);
  expect(
    new QueueRepository(handle.db)
      .dueAttentionItems("2030-01-01T00:00:00Z" as IsoTimestamp)
      .map((e) => e.id),
  ).toEqual(expect.arrayContaining([id, topicId]));
  apply(service.list(id).ranges.find((r) => r.key === first.key) as StructureRange);
  expect(handle.db.select().from(sourceSections).all()).toHaveLength(1);
  expect(service.undo(receipt)).toBe(true);
  expect(handle.db.select().from(sourceSections).all()).toHaveLength(0);
  apply(first);
  const deletedTopic = handle.db.select().from(sourceSections).get()?.topicId as ElementId;
  const locations = handle.db.select().from(sourceLocations).all();
  new ElementRepository(handle.db).softDelete(deletedTopic);
  const restoration = apply(
    service.list(id).ranges.find((r) => r.key === first.key) as StructureRange,
  );
  expect(handle.db.select().from(sourceSections).all()).toHaveLength(1);
  expect(handle.db.select().from(sourceLocations).all()).toEqual(locations);
  expect(new QueueRepository(handle.db).ownsReadingRange(deletedTopic)).toBe(true);
  expect(service.undo(restoration)).toBe(true);
  expect(
    handle.db.select().from(elements).where(eq(elements.id, deletedTopic)).get()?.deletedAt,
  ).toBeTruthy();
});
it("assigns all units once, suppresses parent scheduling, and undoes the whole batch", () => {
  const ranges = service.list(id).ranges.filter((r) => r.depth === 0);
  const before = handle.db.select().from(operationLog).all().length;
  const receipt = service.apply({
    sourceId: id,
    decisions: ranges.map((range, i) => ({
      range,
      verdict: i === 0 ? "ignore" : i === 1 ? "later" : "extract_worthy",
      priority: 0.5,
    })),
  });
  expect(
    new QueueRepository(handle.db)
      .dueAttentionItems("2030-01-01T00:00:00Z" as IsoTimestamp)
      .some((e) => e.id === id),
  ).toBe(false);
  expect(new BlockProcessingService(handle.db).getSourceProcessingSummary(id)).toMatchObject({
    totalBlocks: 7,
    ignoredBlocks: 1,
  });
  expect(handle.db.select().from(sourceLocations).all()).toHaveLength(3);
  expect(
    handle.db
      .select()
      .from(operationLog)
      .all()
      .slice(before)
      .every((op) => JSON.parse(op.payload).skimBatch === receipt.token),
  ).toBe(true);
  expect(service.undo(receipt)).toBe(true);
  expect(
    new QueueRepository(handle.db)
      .dueAttentionItems("2030-01-01T00:00:00Z" as IsoTimestamp)
      .some((e) => e.id === id),
  ).toBe(true);
});
it("rolls back chapter creation if logs fail, and refuses undo over later user changes", () => {
  const range = service.list(id).ranges[1] as StructureRange;
  handle.sqlite.exec(
    "CREATE TRIGGER fail_skim BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT,'skim log failed'); END",
  );
  expect(() => apply(range)).toThrow("skim log failed");
  expect(handle.db.select().from(sourceSections).all()).toHaveLength(0);
  handle.sqlite.exec("DROP TRIGGER fail_skim");
  const receipt = apply(range);
  const topic = handle.db.select().from(sourceSections).get();
  handle.db
    .update(elements)
    .set({ priority: 0.1 })
    .where(eq(elements.id, topic?.topicId ?? ""))
    .run();
  expect(service.undo(receipt)).toBe(false);
  expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
});
