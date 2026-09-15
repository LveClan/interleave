import {
  type BlockId,
  type ElementId,
  type IsoTimestamp,
  shouldShowSourceReturnBriefing,
} from "@interleave/core";
import {
  cards,
  type DbHandle,
  elements,
  readPoints,
  reviewLogs,
  sourceBlockProcessing,
  sources,
} from "@interleave/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockProcessingService } from "./block-processing-service";
import { DocumentRepository } from "./document-repository";
import { ElementRepository } from "./element-repository";
import { ExtractionService } from "./extraction-service";
import { newReviewLogId } from "./ids";
import { SourceRepository } from "./source-repository";
import { SourceReturnBriefingQuery } from "./source-return-briefing-query";
import { createInMemoryDb } from "./test-db";

const NOW = "2026-09-15T02:00:00.000Z" as IsoTimestamp;
let handle: DbHandle;
let sourceId: ElementId;
let ids: BlockId[];
const get = (scheduledReturn = true) =>
  new SourceReturnBriefingQuery(handle.db).get({ sourceId, asOf: NOW, scheduledReturn });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  handle = createInMemoryDb();
  sourceId = new SourceRepository(handle.db).createWithDocument({
    title: "Return fixture",
    priority: 0.5,
    status: "active",
    stage: "raw_source",
    body: "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.",
  }).element.id;
  ids = new DocumentRepository(handle.db)
    .listBlocks(sourceId)
    .map((b) => b.stableBlockId as BlockId);
});
afterEach(() => {
  handle.sqlite.close();
  vi.useRealTimers();
});

function snapshot() {
  const tables = handle.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return tables.map(({ name }) => [
    name,
    handle.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
  ]);
}

describe("SourceReturnBriefingQuery", () => {
  it("keeps first opens quiet and never substitutes activity or totals for visit history", () => {
    expect(get()).toMatchObject({ show: false, lastVisitAt: null, readPctDelta: null, readPct: 0 });
    handle.db.update(elements).set({ updatedAt: NOW }).where(eq(elements.id, sourceId)).run();
    expect(get()?.lastVisitAt).toBeNull();
  });
  it("reuses block predicates, read point and lineage, and changes no table bytes", () => {
    const docs = new DocumentRepository(handle.db);
    docs.setReadPoint({ elementId: sourceId, documentId: sourceId, blockId: ids[1]!, offset: 0 });
    const blocks = new BlockProcessingService(handle.db);
    blocks.markBlockProcessed({ sourceElementId: sourceId, stableBlockId: ids[0]! });
    blocks.markBlockNeedsLater({ sourceElementId: sourceId, stableBlockId: ids[2]! });
    new ExtractionService(handle.db).createExtraction({
      sourceElementId: sourceId,
      blockIds: [ids[3]!],
      selectedText: "Four.",
      startOffset: 0,
      endOffset: 5,
      priority: 0.5,
    });
    const before = snapshot();
    const result = get()!;
    expect(result).toMatchObject({
      show: true,
      lastVisitAt: NOW,
      readPct: 0.4,
      readPctDelta: null,
      stateCounts: {
        unread: 1,
        read: 1,
        needs_later: 1,
        extracted: 1,
        processed_without_output: 1,
      },
      unresolvedBlocks: 3,
      nextUnresolvedBlockId: ids[1],
      firstDeferredBlockId: ids[2],
      lastExtraction: { blockId: ids[3] },
      cards: { count: 0, retention: null, reviewCount: 0 },
    });
    expect(snapshot()).toEqual(before);
    expect(get(false)?.show).toBe(false);
  });
  it("shows old recorded reading on casual open; an arbitrary metadata update is no visit", () => {
    vi.setSystemTime(new Date("2026-09-01T02:00:00.000Z"));
    new DocumentRepository(handle.db).setReadPoint({
      elementId: sourceId,
      documentId: sourceId,
      blockId: ids[0]!,
      offset: 0,
    });
    const old = "2026-09-01T02:00:00.000Z";
    handle.db
      .update(readPoints)
      .set({ updatedAt: old })
      .where(eq(readPoints.elementId, sourceId))
      .run();
    expect(get(false)).toMatchObject({ show: true, lastVisitAt: old });
  });
  it("does not turn automatic reconciliation into a visit or lose the prior reading evidence", () => {
    const old = "2026-09-01T02:00:00.000Z";
    vi.setSystemTime(new Date(old));
    const service = new BlockProcessingService(handle.db);
    service.markBlockProcessed({ sourceElementId: sourceId, stableBlockId: ids[0] as BlockId });
    vi.setSystemTime(new Date(NOW));
    handle.db.transaction((tx) =>
      service.reconcileSourceDocumentWithin(tx, sourceId, { type: "doc", content: [] }),
    );
    expect(get(false)).toMatchObject({
      lastVisitAt: old,
      show: true,
      stateCounts: { stale_after_edit: 1 },
    });
  });
  it("keeps removed stale blocks in counts but excludes them from jump targets", () => {
    const blocks = new BlockProcessingService(handle.db);
    blocks.markBlockNeedsLater({ sourceElementId: sourceId, stableBlockId: ids[0]! });
    handle.db
      .update(sourceBlockProcessing)
      .set({ stableBlockId: "removed", state: "stale_after_edit" })
      .where(eq(sourceBlockProcessing.sourceElementId, sourceId))
      .run();
    expect(get()).toMatchObject({
      stateCounts: { stale_after_edit: 1, unread: 5 },
      unresolvedBlocks: 6,
      firstDeferredBlockId: null,
      nextUnresolvedBlockId: ids[0],
    });
  });
  it("scopes descendant retention to live cards, excludes markers and out-of-window reviews, and reuses clusters", () => {
    const extraction = new ExtractionService(handle.db).createExtraction({
      sourceElementId: sourceId,
      blockIds: [ids[0]!],
      selectedText: "One.",
      startOffset: 0,
      endOffset: 4,
      priority: 0.5,
    });
    const repo = new ElementRepository(handle.db);
    const createCard = (root = sourceId) => {
      const card = repo.create({
        type: "card",
        status: "active",
        stage: "active_card",
        title: "Question",
        priority: 0.5,
        parentId: extraction.element.id,
        sourceId: root,
      });
      handle.db
        .insert(cards)
        .values({ elementId: card.id, kind: "qa", prompt: "Q?", isLeech: true })
        .run();
      return card.id;
    };
    const a = createCard();
    const b = createCard();
    const deleted = createCard();
    repo.softDelete(deleted);
    const other = repo.create({
      type: "source",
      status: "active",
      stage: "raw_source",
      title: "Other",
      priority: 0.5,
    });
    const foreign = createCard(other.id);
    const review = (
      id: ElementId,
      rating: "again" | "good",
      at: IsoTimestamp = NOW,
      marker = false,
    ) => {
      handle.db
        .insert(reviewLogs)
        .values({
          id: newReviewLogId(),
          elementId: id,
          rating,
          reviewedAt: at,
          responseMs: 1000,
          prevState: "review",
          nextState: "review",
          nextStability: 5,
          nextDifficulty: 5,
          nextDueAt: NOW,
          prevLapses: 0,
          nextLapses: rating === "again" ? 1 : 0,
          ...(marker
            ? { editMarkerAt: NOW, editClass: "substantive", editChoice: "re_stabilize" }
            : {}),
        })
        .run();
    };
    for (let i = 0; i < 3; i++) {
      review(a, "again");
      review(b, "again");
    }
    review(a, "good");
    review(b, "good");
    review(a, "good", NOW, true);
    review(deleted, "good");
    review(foreign, "good");
    review(a, "good", "2026-07-01T00:00:00.000Z" as IsoTimestamp);
    review(a, "good", "2026-09-16T00:00:00.000Z" as IsoTimestamp);
    expect(get()).toMatchObject({
      cards: { count: 2, leeches: 2, retention: 0.25, reviewCount: 8 },
      strugglingGroups: { count: 1 },
    });
    expect(
      new SourceReturnBriefingQuery(handle.db).get({
        sourceId,
        asOf: NOW,
        scheduledReturn: true,
        clusters: { enabled: false },
      })?.strugglingGroups.count,
    ).toBe(0);
  });
  it("returns null for missing, deleted, non-source, PDF and media elements", () => {
    const query = new SourceReturnBriefingQuery(handle.db);
    expect(
      query.get({ sourceId: "missing" as ElementId, asOf: NOW, scheduledReturn: true }),
    ).toBeNull();
    handle.db
      .update(sources)
      .set({ snapshotKey: "vault/file.pdf" })
      .where(eq(sources.elementId, sourceId))
      .run();
    expect(get()).toBeNull();
    handle.db
      .update(sources)
      .set({ snapshotKey: null, mediaKind: "youtube" })
      .where(eq(sources.elementId, sourceId))
      .run();
    expect(get()).toBeNull();
    handle.db.update(sources).set({ mediaKind: null }).where(eq(sources.elementId, sourceId)).run();
    new ElementRepository(handle.db).softDelete(sourceId);
    expect(get()).toBeNull();
  });
});

it("gates at strictly more than seven days, rejects unknown/future history, and permits scheduled re-entry", () => {
  expect(shouldShowSourceReturnBriefing(null, NOW, true)).toBe(false);
  expect(shouldShowSourceReturnBriefing(NOW, NOW, true)).toBe(true);
  expect(shouldShowSourceReturnBriefing(NOW, NOW, false)).toBe(false);
  expect(shouldShowSourceReturnBriefing("2026-09-08T02:00:00.000Z", NOW, false)).toBe(false);
  expect(shouldShowSourceReturnBriefing("2026-09-08T01:59:59.999Z", NOW, false)).toBe(true);
  expect(shouldShowSourceReturnBriefing("2026-09-16T02:00:00.000Z", NOW, true)).toBe(false);
  expect(shouldShowSourceReturnBriefing("invalid", NOW, true)).toBe(false);
});
