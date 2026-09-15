import {
  type ElementId,
  mergeTimeRanges,
  PlaybackCoverage,
  type RecordPlaybackRequest,
} from "@interleave/core";
import { elements, type InterleaveDatabase, sourceMediaPlayback } from "@interleave/db";
import { and, eq, isNull } from "drizzle-orm";
import { newRowId, nowIso } from "./ids";
import { mediaProcessingData } from "./media-processing-repository";
import { OperationLogRepository } from "./operation-log-repository";
import { ProcessingUnitRepository } from "./processing-unit-repository";

interface Session {
  sourceId: ElementId;
  identity: string;
  sequence: number;
  coverage: PlaybackCoverage;
  touched: number;
}
export class MediaPlaybackService {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly db: InterleaveDatabase) {}

  start(sourceId: ElementId): { sessionId: string } {
    const data = this.requireMedia(sourceId);
    const sessionId = newRowId();
    for (const [id, session] of this.sessions)
      if (Date.now() - session.touched > 3_600_000) this.sessions.delete(id);
    if (this.sessions.size >= 100) throw new Error("Too many playback sessions");
    this.sessions.set(sessionId, {
      sourceId,
      identity: data.identity,
      sequence: 0,
      coverage: new PlaybackCoverage(),
      touched: Date.now(),
    });
    return { sessionId };
  }

  record(input: RecordPlaybackRequest): { saved: boolean } {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.sourceId !== input.sourceId)
      throw new Error("Playback session unavailable");
    const data = this.requireMedia(session.sourceId);
    if (data.identity !== session.identity) throw new Error("Media changed during playback");
    if (input.sequence <= session.sequence) return { saved: false };
    if (input.sequence !== session.sequence + 1) throw new Error("Playback batch out of order");
    // A failed database write must not advance the event cursor; the same batch can retry.
    const candidate = session.coverage.clone();
    const ranges = candidate.consume(input.events);
    const saved = this.db.transaction((tx) => {
      const durationMs = input.durationMs ?? data.durationMs;
      const coverage = mergeTimeRanges(
        [...data.coverage, ...ranges].map((range) => ({
          startMs: range.startMs,
          endMs: durationMs == null ? range.endMs : Math.min(range.endMs, durationMs),
        })),
      );
      const previous = tx
        .select()
        .from(sourceMediaPlayback)
        .where(eq(sourceMediaPlayback.sourceElementId, session.sourceId))
        .get();
      const encoded = JSON.stringify(coverage);
      if (
        previous?.contentHash === data.identity &&
        previous.coverage === encoded &&
        previous.durationMs === durationMs
      )
        return false;
      tx.insert(sourceMediaPlayback)
        .values({
          sourceElementId: session.sourceId,
          contentHash: data.identity,
          durationMs,
          coverage: encoded,
          updatedAt: nowIso(),
        })
        .onConflictDoUpdate({
          target: sourceMediaPlayback.sourceElementId,
          set: { contentHash: data.identity, durationMs, coverage: encoded, updatedAt: nowIso() },
        })
        .run();
      new OperationLogRepository(tx).append(tx, {
        opType: "update_document",
        elementId: session.sourceId,
        payload: { mediaPlayback: { action: "record_coverage", ranges, durationMs } },
      });
      new ProcessingUnitRepository(tx).reconcileWithin(session.sourceId, true);
      return true;
    });
    session.coverage = candidate;
    session.sequence = input.sequence;
    session.touched = Date.now();
    return { saved };
  }

  private requireMedia(sourceId: ElementId) {
    const source = this.db
      .select({ id: elements.id })
      .from(elements)
      .where(
        and(eq(elements.id, sourceId), eq(elements.type, "source"), isNull(elements.deletedAt)),
      )
      .get();
    const data = source ? mediaProcessingData(this.db, sourceId) : null;
    if (!data) throw new Error("Media source unavailable");
    return data;
  }
}
