import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlockId, ElementId, IsoTimestamp, PlaybackEvent } from "@interleave/core";
import {
  type DbHandle,
  openDatabase,
  operationLog,
  sourceLocations,
  sourceMediaPlayback,
} from "@interleave/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DocumentRepository } from "./document-repository";
import { MediaPlaybackService } from "./media-playback-service";
import { ProcessingUnitService } from "./processing-unit-service";
import { SchedulerService } from "./scheduler-service";
import { SourcePendingService } from "./source-pending-service";
import { SourceRepository } from "./source-repository";
import { SourceReturnBriefingQuery } from "./source-return-briefing-query";
import { SourceYieldQuery } from "./source-yield-query";
import { createInMemoryDb } from "./test-db";

let handle: DbHandle;
let id: ElementId;
let playback: MediaPlaybackService;
let units: ProcessingUnitService;
let sessionId: string;
let sequence: number;
const event = (
  kind: PlaybackEvent["kind"],
  positionMs: number,
  clockMs: number,
): PlaybackEvent => ({ kind, positionMs, clockMs, rate: 1 });
beforeEach(() => {
  handle = createInMemoryDb();
  id = new SourceRepository(handle.db).createWithDocument({
    title: "Audio",
    body: "Audio",
    mediaKind: "audio",
    snapshotKey: "media/audio.mp3",
    priority: 0.8,
    status: "active",
    stage: "raw_source",
  }).element.id;
  units = new ProcessingUnitService(handle.db);
  playback = new MediaPlaybackService(handle.db);
  sessionId = playback.start(id).sessionId;
  sequence = 0;
});
afterEach(() => handle.sqlite.close());
function record(events: PlaybackEvent[], durationMs?: number) {
  return playback.record({
    sourceId: id,
    sessionId,
    sequence: ++sequence,
    events,
    ...(durationMs == null ? {} : { durationMs }),
  });
}
function set(index: number, state: "read" | "needs_later" | "ignored") {
  const unit = units.open(id).blocks[index];
  if (!unit?.blockContentHash) throw new Error("fixture unit missing");
  return units.set({
    sourceId: id,
    blockId: unit.stableBlockId,
    contentHash: unit.blockContentHash,
    expectedState: unit.state,
    state,
  });
}
it("persists exact coverage, derives whole segment read and shares all consumers without using seek position", () => {
  record([], 360_000);
  expect(() => set(0, "read")).toThrow("played completely");
  const events = [event("playing", 0, 0)];
  for (let n = 1; n <= 180; n++) events.push(event("sample", n * 1000, n * 1000));
  events.push(event("pause", 180_000, 180_000));
  record(events);
  const deferred = set(0, "needs_later");
  expect(units.undo(deferred)).toBe(true);
  expect(units.open(id).blocks[0]?.state).toBe("read");
  set(1, "needs_later");
  expect(units.open(id).summary).toMatchObject({
    totalBlocks: 2,
    unresolvedBlocks: 2,
    stateCounts: { read: 1, needs_later: 1 },
  });
  const asOf = "2030-01-01T00:00:00Z" as IsoTimestamp;
  expect(new SourceYieldQuery(handle.db).getSourceYield(id, asOf)).toMatchObject({
    readPct: 0.5,
    readPctKnown: true,
  });
  expect(new SourcePendingService(handle.db).list(id)?.entries[0]?.blockId).toBe(
    "media:segment:180000",
  );
  expect(
    new SourceReturnBriefingQuery(handle.db).get({ sourceId: id, asOf, scheduledReturn: true }),
  ).toMatchObject({
    readPct: 0.5,
    readPctDelta: null,
    firstDeferredBlockId: "media:segment:180000",
  });
  set(0, "ignored");
  new SchedulerService(handle.db).rescheduleForAction(id, "rewrite", asOf);
  const log = handle.db
    .select()
    .from(operationLog)
    .all()
    .filter((row) => row.opType === "reschedule_element")
    .at(-1);
  expect(JSON.parse(log?.payload ?? "{}").scheduleReason).toMatchObject({ unresolvedRatio: 0.5 });
});
it("preserves unknown tails, derives partial fragments without resolving remaining media, and persists through reopen", async () => {
  expect(units.open(id).blocks[0]?.geometry).toEqual({
    kind: "media_segment",
    startMs: 0,
    endMs: null,
  });
  expect(() => set(0, "ignored")).toThrow("Duration unknown");
  const asOf = "2030-01-01T00:00:00Z" as IsoTimestamp;
  expect(new SourceYieldQuery(handle.db).getSourceYield(id, asOf)?.readPctKnown).toBe(false);
  const receipt = set(0, "needs_later");
  expect(units.undo(receipt)).toBe(true);
  new SourceRepository(handle.db).createExtract({
    sourceElementId: id,
    title: "Clip",
    selectedText: "",
    priority: 0.5,
    blockIds: [] as BlockId[],
    elementType: "media_fragment",
    timestampMs: 1000,
    clip: { startMs: 1000, endMs: 3000 },
  });
  record([event("playing", 0, 0), event("sample", 1000, 1000), event("pause", 2000, 2000)]);
  expect(units.open(id).summary).toMatchObject({ unresolvedBlocks: 1, extractedOutputCount: 1 });
  const directory = mkdtempSync(join(tmpdir(), "interleave-media-"));
  try {
    await handle.sqlite.backup(join(directory, "db.sqlite"));
    handle.sqlite.close();
    handle = openDatabase(join(directory, "db.sqlite"));
    expect(
      JSON.parse(handle.db.select().from(sourceMediaPlayback).get()?.coverage ?? "[]"),
    ).toEqual([{ startMs: 0, endMs: 2000 }]);
    expect(handle.db.select().from(sourceLocations).all()).toHaveLength(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("ignores repeats, rolls back failed logs and retries the same event cursor", () => {
  record([], 10_000);
  const batch = {
    sourceId: id,
    sessionId,
    sequence: 2,
    events: [event("playing", 0, 0), event("sample", 1000, 1000)],
  };
  const before = handle.db.select().from(sourceMediaPlayback).all();
  handle.sqlite.exec(
    "CREATE TRIGGER fail_playback BEFORE INSERT ON operation_log BEGIN SELECT RAISE(ABORT, 'playback failed'); END",
  );
  expect(() => playback.record(batch)).toThrow("playback failed");
  expect(handle.db.select().from(sourceMediaPlayback).all()).toEqual(before);
  handle.sqlite.exec("DROP TRIGGER fail_playback");
  expect(playback.record(batch).saved).toBe(true);
  const logs = handle.db.select().from(operationLog).all().length;
  expect(playback.record(batch).saved).toBe(false);
  expect(handle.db.select().from(operationLog).all()).toHaveLength(logs);
  expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
});
it("closes a discovered tail without staling content, and keeps user deferral across coverage writes", () => {
  units.open(id);
  set(0, "needs_later");
  record([], 2000);
  expect(units.open(id).blocks[0]).toMatchObject({
    state: "needs_later",
    geometry: { startMs: 0, endMs: 2000 },
  });
  record([event("playing", 0, 0), event("sample", 1000, 1000), event("pause", 2000, 2000)]);
  expect(units.open(id).blocks[0]?.state).toBe("needs_later");
  set(0, "read");
  expect(units.open(id).summary).toMatchObject({
    unresolvedBlocks: 1,
    staleAfterEditBlocks: 0,
    stateCounts: { read: 1 },
  });
  record([], 3000);
  expect(units.open(id).blocks[0]?.state).toBe("unread");
  set(0, "ignored");
  record([], 4000);
  expect(units.open(id).blocks[0]?.state).toBe("unread");
});
it("counts one live clip once even when it spans new segment boundaries", () => {
  new SourceRepository(handle.db).createExtract({
    sourceElementId: id,
    title: "Long clip",
    selectedText: "",
    priority: 0.5,
    blockIds: [],
    elementType: "media_fragment",
    timestampMs: 1000,
    clip: { startMs: 1000, endMs: 300_000 },
  });
  expect(units.open(id).summary.extractedOutputCount).toBe(1);
  record([], 360_000);
  expect(units.open(id).summary).toMatchObject({
    extractedOutputCount: 1,
    extractedBlockCount: 2,
    unresolvedBlocks: 2,
  });
});
it("refreshes subtitle geometry metadata and preserves clip reverify independently of later duration discovery", () => {
  const docs = new DocumentRepository(handle.db);
  const save = (text: string) =>
    docs.upsert({
      elementId: id,
      plainText: text,
      prosemirrorJson: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "cue" }, content: [{ type: "text", text }] },
        ],
      },
      blocks: [
        { stableBlockId: "cue" as BlockId, order: 0, blockType: "paragraph", timestampMs: 0 },
      ],
    });
  save("Original transcript");
  record([], 2000);
  new SourceRepository(handle.db).createExtract({
    sourceElementId: id,
    title: "Clip",
    priority: 0.5,
    selectedText: "Original",
    blockIds: ["cue" as BlockId],
    elementType: "media_fragment",
    clip: { startMs: 0, endMs: 1000 },
  });
  save("Edited transcript");
  expect(units.open(id).summary.needsReverifyOutputs).toBe(1);
  const entry = new SourcePendingService(handle.db).list(id)?.entries[0];
  if (!entry?.contentHash) throw new Error("missing stale segment");
  new SourcePendingService(handle.db).resume({
    sourceId: id,
    blockId: entry.blockId,
    contentHash: entry.contentHash,
    expectedState: entry.state,
    state: "unread",
  });
  record([], 3000);
  expect(units.open(id).summary).toMatchObject({
    staleAfterEditBlocks: 0,
    needsReverifyOutputs: 1,
  });
});
