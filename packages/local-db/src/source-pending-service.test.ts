import type { BlockId, ElementId, IsoTimestamp } from "@interleave/core";
import {
  type DbHandle,
  documentBlocks,
  documents,
  elementReverifyProvenance,
  elements,
  operationLog,
  sourceBlockProcessing,
  sourceLocations,
} from "@interleave/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockProcessingService } from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { ExtractionService } from "./extraction-service";
import { SchedulerService } from "./scheduler-service";
import { SourcePendingService } from "./source-pending-service";
import { SourceRepository } from "./source-repository";
import { createInMemoryDb } from "./test-db";

let handle: DbHandle;
let id: ElementId;
let blocks: BlockId[];
let service: SourcePendingService;
beforeEach(() => {
  handle = createInMemoryDb();
  id = new SourceRepository(handle.db).createWithDocument({
    title: "Pending",
    body: "First passage.\n\nSecond passage.\n\nThird passage.",
    priority: 0.875,
    status: "active",
    stage: "raw_source",
  }).element.id;
  blocks = new DocumentRepository(handle.db).listBlocks(id).map((b) => b.stableBlockId as BlockId);
  service = new SourcePendingService(handle.db);
});
afterEach(() => handle.sqlite.close());
function defer(index: number) {
  new BlockProcessingService(handle.db).markBlockNeedsLater({
    sourceElementId: id,
    stableBlockId: blocks[index] as BlockId,
  });
}
function resume(index: number, state: "read" | "unread" = "unread") {
  const entry = service.list(id)?.entries.find((e) => e.blockId === blocks[index]);
  if (!entry?.contentHash) throw new Error("fixture entry missing");
  return service.resume({
    sourceId: id,
    blockId: entry.blockId,
    contentHash: entry.contentHash,
    expectedState: entry.state,
    state,
  });
}
function logs() {
  return handle.db.select().from(operationLog).all();
}
describe("SourcePendingService", () => {
  it("filters and orders by document position, previews current text, preserves removed stale entries, and reads without writes", () => {
    defer(2);
    defer(0);
    handle.db
      .update(sourceBlockProcessing)
      .set({ state: "stale_after_edit" })
      .where(eq(sourceBlockProcessing.stableBlockId, blocks[0] as BlockId))
      .run();
    const before = logs();
    expect(service.list(id)?.entries.map((e) => [e.blockId, e.state, e.preview])).toEqual([
      [blocks[0], "stale_after_edit", "First passage."],
      [blocks[2], "needs_later", "Third passage."],
    ]);
    expect(logs()).toEqual(before);
    handle.db
      .delete(documentBlocks)
      .where(eq(documentBlocks.stableBlockId, blocks[0] as BlockId))
      .run();
    expect(service.list(id)?.entries.map((e) => [e.blockId, e.locatable])).toEqual([
      [blocks[2], true],
      [blocks[0], false],
    ]);
  });
  it.each([
    "unread",
    "read",
  ] as const)("resumes as %s, keeps unresolved counts and source relations, and safely undoes", (state) => {
    defer(1);
    const before = logs().length;
    const receipt = resume(1, state);
    expect(service.list(id)).toMatchObject({
      entries: [],
      summary: {
        unresolvedBlocks: 3,
        stateCounts: { needs_later: 0, [state]: state === "read" ? 1 : 3 },
      },
    });
    expect(logs()).toHaveLength(before + 1);
    expect(logs().at(-1)).toMatchObject({ elementId: id, opType: "update_document" });
    const row = handle.db.select().from(sourceBlockProcessing).get();
    expect(row).toMatchObject({ sourceElementId: id, stableBlockId: blocks[1], state });
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(service.undo(receipt)).toBe(true);
    expect(service.list(id)?.entries[0]?.state).toBe("needs_later");
    expect(service.undo(receipt)).toBe(false);
    expect(logs()).toHaveLength(before + 2);
  });
  it("rejects changed previews and refuses undo after text or processing changes", () => {
    defer(0);
    const receipt = resume(0);
    new BlockProcessingService(handle.db).markBlockProcessed({
      sourceElementId: id,
      stableBlockId: blocks[0] as BlockId,
    });
    expect(service.undo(receipt)).toBe(false);
    defer(1);
    const old = service.list(id)?.entries[0];
    const doc = new DocumentRepository(handle.db).findById(id);
    handle.db
      .update(documents)
      .set({ prosemirrorJson: JSON.stringify({ type: "doc", content: [] }) })
      .where(eq(documents.elementId, id))
      .run();
    expect(() =>
      service.resume({
        sourceId: id,
        blockId: old?.blockId ?? "",
        contentHash: old?.contentHash ?? "",
        expectedState: "needs_later",
        state: "read",
      }),
    ).toThrow();
    expect(service.undo(receipt)).toBe(false);
    expect(doc).not.toBeNull();
  });
  it("rolls back a state update if the operation-log append fails", () => {
    defer(0);
    const before = handle.db.select().from(sourceBlockProcessing).all();
    const count = logs().length;
    handle.sqlite.exec(
      "CREATE TRIGGER fail_pending_log BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, 'test log failure'); END",
    );
    expect(() => resume(0)).toThrow("test log failure");
    expect(handle.db.select().from(sourceBlockProcessing).all()).toEqual(before);
    expect(logs()).toHaveLength(count);
  });
  it("keeps derived verification and source lineage untouched and protects live extracted outputs", () => {
    const output = new ExtractionService(handle.db).createExtraction({
      sourceElementId: id,
      blockIds: [blocks[0] as BlockId],
      selectedText: "First passage.",
      startOffset: 0,
      endOffset: 14,
      priority: 0.5,
    }).element;
    handle.db.update(elements).set({ needsReverify: true }).where(eq(elements.id, output.id)).run();
    handle.db
      .insert(elementReverifyProvenance)
      .values({
        id: "prov",
        sourceElementId: id,
        stableBlockId: blocks[0] as BlockId,
        elementId: output.id,
        batchId: "b",
        createdAt: "2026-09-15T00:00:00Z",
      })
      .run();
    handle.db
      .update(sourceBlockProcessing)
      .set({ state: "stale_after_edit" })
      .where(eq(sourceBlockProcessing.stableBlockId, blocks[0] as BlockId))
      .run();
    const lineage = handle.db.select().from(sourceLocations).all();
    expect(service.list(id)?.entries[0]?.canResume).toBe(false);
    expect(() => resume(0)).toThrow();
    defer(1);
    const receipt = resume(1, "read");
    expect(service.undo(receipt)).toBe(true);
    expect(handle.db.select().from(sourceLocations).all()).toEqual(lineage);
    expect(handle.db.select().from(elementReverifyProvenance).all()).toHaveLength(1);
    expect(
      handle.db.select().from(elements).where(eq(elements.id, output.id)).get()?.needsReverify,
    ).toBe(true);
  });
  it("keeps needs_later in the scheduler's existing unresolvedRatio", () => {
    const processing = new BlockProcessingService(handle.db);
    processing.markBlockProcessed({ sourceElementId: id, stableBlockId: blocks[0] as BlockId });
    processing.markBlockProcessed({ sourceElementId: id, stableBlockId: blocks[2] as BlockId });
    defer(1);
    new SchedulerService(handle.db).rescheduleForAction(
      id,
      "processed",
      "2026-09-16T00:00:00Z" as IsoTimestamp,
    );
    const op = logs()
      .filter((row) => row.opType === "reschedule_element")
      .at(-1);
    expect(JSON.parse(op?.payload ?? "{}").scheduleReason).toMatchObject({
      kind: "source_unresolved_shortened",
      unresolvedRatio: 1 / 3,
    });
    resume(1, "read");
    expect(service.list(id)?.summary.unresolvedBlocks).toBe(1);
  });
  it("protects transitive verification when the directly anchored extract is deleted", () => {
    const direct = new ExtractionService(handle.db).createExtraction({
      sourceElementId: id,
      blockIds: [blocks[0] as BlockId],
      selectedText: "First passage.",
      startOffset: 0,
      endOffset: 14,
      priority: 0.5,
    }).element;
    const child = new SourceRepository(handle.db).createWithDocument({
      title: "Output fixture",
      body: "Derived",
      priority: 0.5,
      status: "active",
      stage: "raw_source",
    }).element;
    handle.db
      .update(elements)
      .set({ type: "extract", sourceId: id, parentId: direct.id, needsReverify: true })
      .where(eq(elements.id, child.id))
      .run();
    handle.db
      .update(elements)
      .set({ deletedAt: "2026-09-15T00:00:00Z", status: "deleted" })
      .where(eq(elements.id, direct.id))
      .run();
    handle.db
      .insert(elementReverifyProvenance)
      .values({
        id: "transitive",
        sourceElementId: id,
        stableBlockId: blocks[0] as BlockId,
        elementId: child.id,
        batchId: "b",
        createdAt: "2026-09-15T00:00:00Z",
      })
      .run();
    handle.db
      .update(sourceBlockProcessing)
      .set({ state: "stale_after_edit" })
      .where(eq(sourceBlockProcessing.stableBlockId, blocks[0] as BlockId))
      .run();
    expect(service.list(id)).toMatchObject({
      entries: [{ canResume: false }],
      summary: { needsReverifyOutputs: 1 },
    });
    expect(() => resume(0, "read")).toThrow();
    expect(service.list(id)?.summary.needsReverifyOutputs).toBe(1);
  });
});
