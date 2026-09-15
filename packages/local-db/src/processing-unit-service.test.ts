import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockId, ElementId, IsoTimestamp, SetProcessingUnitRequest } from "@interleave/core";
import {
  type DbHandle,
  documents,
  elements,
  openDatabase,
  operationLog,
  sourceBlockProcessing,
  sourceLocations,
} from "@interleave/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BlockProcessingService } from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { ExtractionService } from "./extraction-service";
import { createRepositories } from "./index";
import { ProcessingUnitService } from "./processing-unit-service";
import { ReverifyResolutionService } from "./reverify-resolution-service";
import { SchedulerService } from "./scheduler-service";
import { SourcePendingService } from "./source-pending-service";
import { SourceRepository } from "./source-repository";
import { SourceReturnBriefingQuery } from "./source-return-briefing-query";
import { SourceYieldQuery } from "./source-yield-query";
import { createInMemoryDb } from "./test-db";

let handle: DbHandle;
let id: ElementId;
let service: ProcessingUnitService;
const ids = ["page-one", "page-two"] as BlockId[];
function save(first = "First page", second: string | null = "Second page") {
  const content = [first, second].flatMap((text, i) =>
    text == null
      ? []
      : [{ type: "paragraph", attrs: { blockId: ids[i] }, content: [{ type: "text", text }] }],
  );
  return new DocumentRepository(handle.db).upsert({
    elementId: id,
    prosemirrorJson: { type: "doc", content },
    plainText: first,
    blocks: content.map((_, i) => ({
      stableBlockId: ids[i] as BlockId,
      blockType: "paragraph",
      order: i,
      page: i + 1,
    })),
  });
}
beforeEach(() => {
  handle = createInMemoryDb();
  id = new SourceRepository(handle.db).createWithDocument({
    title: "PDF",
    body: "PDF",
    priority: 0.8,
    status: "active",
    stage: "raw_source",
    snapshotKey: "sources/fixture/original.pdf",
  }).element.id;
  save();
  service = new ProcessingUnitService(handle.db);
});
afterEach(() => handle.sqlite.close());
it("retains page state, lineage and logs after reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "interleave-units-"));
  try {
    set(1, "needs_later");
    extract();
    const before = service.open(id);
    await handle.sqlite.backup(join(directory, "state.sqlite"));
    handle.sqlite.close();
    handle = openDatabase(join(directory, "state.sqlite"));
    service = new ProcessingUnitService(handle.db);
    expect(service.open(id)).toEqual(before);
    expect(handle.db.select().from(sourceLocations).all()).toHaveLength(1);
    expect(handle.db.select().from(operationLog).all().length).toBeGreaterThan(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
function set(page: number, state: SetProcessingUnitRequest["state"]) {
  const view = service.open(id).blocks.find((b) => b.stableBlockId === `pdf:page:${page}`);
  if (!view?.blockContentHash) throw new Error("missing fixture");
  return service.set({
    sourceId: id,
    blockId: view.stableBlockId,
    contentHash: view.blockContentHash,
    expectedState: view.state,
    state,
  });
}
function extract() {
  return new ExtractionService(handle.db).createExtraction({
    sourceElementId: id,
    blockIds: [ids[0] as BlockId],
    selectedText: "First",
    page: 1,
    priority: 0.5,
  }).element;
}
it("lazily persists page rows, keeps partial outputs unresolved, and shares progress, Done, yield, pending and scheduler facts", () => {
  expect(handle.db.select().from(sourceBlockProcessing).all()).toHaveLength(0);
  service.open(id);
  expect(handle.db.select().from(sourceBlockProcessing).all()).toHaveLength(2);
  extract();
  let result = service.open(id);
  expect(result.summary).toMatchObject({
    totalBlocks: 2,
    unresolvedBlocks: 2,
    extractedBlockCount: 1,
    extractedOutputCount: 1,
    canMarkDoneWithoutConfirmation: false,
  });
  expect(result.blocks[0]?.state).toBe("unread");
  set(1, "read");
  set(2, "needs_later");
  expect(
    new SourceYieldQuery(handle.db).getSourceYield(id, "2030-01-01T00:00:00Z" as IsoTimestamp)
      ?.readPct,
  ).toBe(0.5);
  expect(new SourcePendingService(handle.db).list(id)?.entries[0]?.blockId).toBe("pdf:page:2");
  const briefing = new SourceReturnBriefingQuery(handle.db).get({
    sourceId: id,
    asOf: "2030-01-01T00:00:00Z" as IsoTimestamp,
    scheduledReturn: true,
  });
  expect(briefing).toMatchObject({
    readPct: 0.5,
    readPctDelta: null,
    firstDeferredBlockId: "pdf:page:2",
    lastExtraction: { blockId: "pdf:page:1" },
  });
  set(1, "processed_without_output");
  result = service.open(id);
  expect(result.blocks[0]?.state).toBe("extracted");
  expect(
    new BlockProcessingService(handle.db).getSourceProcessingSummaryForMany([id]).get(id),
  ).toEqual(result.summary);
  new SchedulerService(handle.db).rescheduleForAction(
    id,
    "rewrite",
    "2030-01-01T00:00:00Z" as IsoTimestamp,
  );
  const op = handle.db
    .select()
    .from(operationLog)
    .all()
    .filter((r) => r.opType === "reschedule_element")
    .at(-1);
  expect(JSON.parse(op?.payload ?? "{}").scheduleReason).toMatchObject({
    kind: "source_unresolved_shortened",
    unresolvedRatio: 0.5,
  });
  set(2, "ignored");
  expect(service.open(id).summary.canMarkDoneWithoutConfirmation).toBe(true);
});
it("coordinates OCR/content edits and restoration without changing lineage or clearing output verification through page actions", () => {
  service.open(id);
  const output = extract();
  set(1, "read");
  const lineage = handle.db.select().from(sourceLocations).all();
  save("OCR revised page");
  expect(service.open(id).blocks[0]?.state).toBe("stale_after_edit");
  expect(service.open(id).summary.needsReverifyOutputs).toBe(1);
  const receipt = set(1, "read");
  expect(service.open(id).summary).toMatchObject({
    staleAfterEditBlocks: 0,
    needsReverifyOutputs: 1,
  });
  expect(service.undo(receipt)).toBe(true);
  save();
  expect(service.open(id).blocks[0]?.state).toBe("read");
  expect(
    handle.db.select().from(elements).where(eq(elements.id, output.id)).get()?.needsReverify,
  ).toBe(false);
  expect(handle.db.select().from(sourceLocations).all()).toEqual(lineage);
  new DocumentRepository(handle.db).upsert({
    elementId: id,
    prosemirrorJson: { type: "doc", content: [] },
    plainText: "",
    blocks: [],
  });
  expect(service.open(id).summary.extractedOutputCount).toBe(1);
  expect(service.open(id).blocks[0]?.locatable).toBe(false);
  save();
  save("First page", null);
  expect(new SourcePendingService(handle.db).list(id)?.entries).toContainEqual(
    expect.objectContaining({ blockId: "pdf:page:2", locatable: false, canResume: false }),
  );
});

it("shows page evidence to reverify, rejects changed evidence and leaves the page unresolved after rebase", () => {
  service.open(id);
  extract();
  set(1, "needs_later");
  save("OCR revision");
  const reverify = new ReverifyResolutionService(handle.db, createRepositories(handle.db));
  const preview = reverify.sessionPreview({ sourceElementId: id });
  const entry = preview.items.find((item) => item.stableBlockId === "pdf:page:1");
  expect(entry?.currentBlockText).toBe("OCR revision");
  if (!entry) throw new Error("missing evidence");
  save("Second OCR revision");
  expect(
    reverify.resolve({ sourceElementId: id, decisions: [{ ...entry, verb: "confirm" }] }).skipped[0]
      ?.reason,
  ).toBe("block-re-edited");
  const fresh = reverify.sessionPreview({ sourceElementId: id }).items[0];
  if (!fresh) throw new Error("missing evidence");
  expect(
    reverify.resolve({ sourceElementId: id, decisions: [{ ...fresh, verb: "rebase" }] }).applied,
  ).toBe(1);
  expect(service.open(id).blocks[0]?.state).toBe("unread");
  expect(service.open(id).summary.needsReverifyOutputs).toBe(0);
});
it("reflags confirmed outputs if an already-stale page disappears, without repeated writes on open", () => {
  service.open(id);
  extract();
  save("Changed");
  const reverify = new ReverifyResolutionService(handle.db, createRepositories(handle.db));
  const item = reverify.sessionPreview({ sourceElementId: id }).items[0];
  if (!item) throw new Error("missing evidence");
  reverify.resolve({ sourceElementId: id, decisions: [{ ...item, verb: "confirm" }] });
  expect(service.open(id).summary.needsReverifyOutputs).toBe(0);
  new DocumentRepository(handle.db).upsert({
    elementId: id,
    prosemirrorJson: { type: "doc", content: [] },
    plainText: "",
    blocks: [],
  });
  expect(service.open(id).summary.needsReverifyOutputs).toBe(1);
  const logs = handle.db.select().from(operationLog).all().length;
  service.open(id);
  expect(handle.db.select().from(operationLog).all()).toHaveLength(logs);
});
it("derives region outputs from live page/rectangle lineage and removes only trashed output contributions", () => {
  const output = new SourceRepository(handle.db).createExtract({
    sourceElementId: id,
    title: "Figure",
    selectedText: "",
    priority: 0.5,
    blockIds: [ids[0] as BlockId],
    elementType: "media_fragment",
    page: 1,
    region: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 },
  });
  expect(service.open(id).summary).toMatchObject({ extractedOutputCount: 1, unresolvedBlocks: 2 });
  save("OCR revision");
  expect(service.open(id).summary.needsReverifyOutputs).toBe(1);
  handle.db
    .update(elements)
    .set({ deletedAt: "2030-01-01T00:00:00Z", status: "deleted" })
    .where(eq(elements.id, output.element.id))
    .run();
  expect(service.open(id).summary.extractedOutputCount).toBe(0);
  expect(handle.db.select().from(sourceLocations).get()?.region).toBeTruthy();
});
it("logs state/undo commands, guards late commands and rolls back document, page states and lineage flags atomically", () => {
  service.open(id);
  const receipt = set(2, "needs_later");
  expect(new ProcessingUnitService(handle.db).undo(receipt)).toBe(true);
  expect(service.undo(receipt)).toBe(false);
  extract();
  const rows = handle.db.select().from(sourceBlockProcessing).all();
  const body = handle.db.select().from(documents).all();
  const logs = handle.db.select().from(operationLog).all();
  handle.sqlite.exec(
    "CREATE TRIGGER fail_unit_log BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, 'unit log failure'); END",
  );
  expect(() => set(2, "read")).toThrow("unit log failure");
  expect(() => save("Changed")).toThrow("unit log failure");
  expect(handle.db.select().from(sourceBlockProcessing).all()).toEqual(rows);
  expect(handle.db.select().from(documents).all()).toEqual(body);
  expect(handle.db.select().from(operationLog).all()).toEqual(logs);
  expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
});
