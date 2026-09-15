import { createHash } from "node:crypto";
import type { ElementId, TimeRange } from "@interleave/core";
import { assets, sourceMediaPlayback, sources } from "@interleave/db";
import { and, eq } from "drizzle-orm";
import type { DbClient } from "./types";

export function mediaProcessingData(db: DbClient, sourceId: ElementId) {
  const source = db.select().from(sources).where(eq(sources.elementId, sourceId)).get();
  if (!source?.mediaKind) return null;
  const asset = source.snapshotKey
    ? db
        .select()
        .from(assets)
        .where(
          and(eq(assets.owningElementId, sourceId), eq(assets.relativePath, source.snapshotKey)),
        )
        .get()
    : null;
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        source.mediaKind,
        asset?.contentHash ?? source.canonicalUrl ?? source.url ?? source.snapshotKey,
      ]),
    )
    .digest("hex");
  const stored = db
    .select()
    .from(sourceMediaPlayback)
    .where(eq(sourceMediaPlayback.sourceElementId, sourceId))
    .get();
  const current = stored?.contentHash === identity ? stored : null;
  const durationMs = current?.durationMs ?? asset?.durationMs ?? null;
  const coverage: TimeRange[] = current ? JSON.parse(current.coverage) : [];
  return {
    identity,
    durationMs,
    coverage,
    kind: source.mediaKind,
    observedMs: coverage.at(-1)?.endMs ?? 0,
  };
}

export function parseClip(raw: string | null): TimeRange | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      value &&
      Number.isFinite(value.startMs) &&
      Number.isFinite(value.endMs) &&
      value.startMs >= 0 &&
      value.endMs > value.startMs
    )
      return value;
  } catch {
    /* Legacy malformed anchors are not playback evidence. */
  }
  return null;
}
