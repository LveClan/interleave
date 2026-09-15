export interface TimeRange {
  readonly startMs: number;
  readonly endMs: number;
}
export interface MediaSegment {
  readonly startMs: number;
  readonly endMs: number | null;
}

/** Three-minute windows, snapped forward to a cue within five minutes when available. */
export function mediaSegments(
  durationMs: number | null,
  cueStarts: readonly number[],
  observedMs = 0,
): MediaSegment[] {
  const starts = [...new Set(cueStarts.filter((n) => Number.isFinite(n) && n >= 0))].sort(
    (a, b) => a - b,
  );
  const limit = durationMs ?? Math.max(observedMs, starts.at(-1) ?? 0);
  const out: MediaSegment[] = [];
  let startMs = 0;
  while (startMs < limit && out.length < 20_000) {
    const cue = starts.find((n) => n >= startMs + 180_000 && n <= startMs + 300_000);
    const next = cue ?? startMs + 180_000;
    if (durationMs == null && next > limit) break;
    const endMs = Math.min(next, limit);
    out.push({ startMs, endMs });
    startMs = endMs;
  }
  if (durationMs == null) out.push({ startMs, endMs: null });
  return out;
}

/** Exact union: gaps, however small, never become watched time. */
export function mergeTimeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter(
      (r) =>
        Number.isFinite(r.startMs) &&
        Number.isFinite(r.endMs) &&
        r.startMs >= 0 &&
        r.endMs > r.startMs,
    )
    .map((r) => ({ ...r }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
    else merged.push(range);
  }
  return merged;
}

export function coveredTime(ranges: readonly TimeRange[], segment: TimeRange): number {
  return mergeTimeRanges(ranges).reduce(
    (sum, range) =>
      sum +
      Math.max(0, Math.min(range.endMs, segment.endMs) - Math.max(range.startMs, segment.startMs)),
    0,
  );
}

export interface PlaybackEvent {
  readonly kind:
    | "playing"
    | "sample"
    | "pause"
    | "seeking"
    | "seeked"
    | "waiting"
    | "ended"
    | "ratechange";
  readonly positionMs: number;
  readonly clockMs: number;
  readonly rate: number;
}

/** Consumes player observations, on the trusted side. A seek never bridges a gap. */
export class PlaybackCoverage {
  private anchor: PlaybackEvent | null = null;
  clone(): PlaybackCoverage {
    const copy = new PlaybackCoverage();
    copy.anchor = this.anchor;
    return copy;
  }
  consume(events: readonly PlaybackEvent[]): TimeRange[] {
    const ranges: TimeRange[] = [];
    for (const event of events) {
      const previous = this.anchor;
      if (event.kind === "seeking" || event.kind === "seeked" || event.kind === "ratechange") {
        this.anchor = null;
        continue;
      }
      if (previous && event.kind !== "playing") {
        const elapsed = event.clockMs - previous.clockMs;
        const traveled = event.positionMs - previous.positionMs;
        if (
          elapsed > 0 &&
          elapsed <= 5000 &&
          traveled > 0 &&
          traveled <= elapsed * previous.rate + 100 &&
          event.rate === previous.rate
        ) {
          ranges.push({ startMs: previous.positionMs, endMs: event.positionMs });
        }
      }
      this.anchor =
        event.kind === "playing" || (event.kind === "sample" && previous) ? event : null;
    }
    return mergeTimeRanges(ranges);
  }
}

export interface RecordPlaybackRequest {
  readonly sourceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly events: readonly PlaybackEvent[];
  readonly durationMs?: number;
}
