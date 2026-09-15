import type { PlaybackEvent } from "@interleave/core";
import { useCallback, useEffect, useRef } from "react";
import { appApi } from "../../lib/appApi";
import { sourceReadingChanged } from "../../lib/sourceReadingEvents";

/** Capture events only; trusted domain code decides which spans were actually played. */
export function useMediaCoverage(sourceId: string, enabled: boolean, onError: () => void) {
  const push = useRef<(event: PlaybackEvent, duration?: number) => void>(() => {});
  const error = useRef(onError);
  error.current = onError;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let busy = false;
    let sequence = 0;
    const events: PlaybackEvent[] = [];
    let duration: number | undefined;
    let pending: { events: PlaybackEvent[]; durationMs?: number; sequence: number } | null = null;
    const session = appApi.startMediaPlayback(sourceId);
    const flush = async () => {
      if (busy || (!pending && events.length === 0 && duration === undefined)) return;
      busy = true;
      try {
        const { sessionId } = await session;
        if (!pending) {
          pending = {
            events: events.splice(0, 256),
            ...(duration === undefined ? {} : { durationMs: duration }),
            sequence: ++sequence,
          };
          duration = undefined;
        }
        const result = await appApi.recordMediaPlayback({ sourceId, sessionId, ...pending });
        pending = null;
        if (result.saved) sourceReadingChanged(sourceId);
      } catch {
        if (!disposed) error.current();
      } finally {
        busy = false;
      }
      if (pending == null && ((disposed && events.length > 0) || events.length >= 256))
        void flush();
    };
    void session.catch(() => {
      if (!disposed) error.current();
    });
    push.current = (event, observedDuration) => {
      events.push(event);
      if (observedDuration !== undefined) duration = observedDuration;
      if (events.length >= 256 || event.kind === "pause" || event.kind === "ended") void flush();
    };
    const timer = setInterval(() => void flush(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      push.current = () => {};
      void flush();
    };
  }, [sourceId, enabled]);
  return useCallback((kind: PlaybackEvent["kind"], element: HTMLMediaElement) => {
    const duration =
      Number.isFinite(element.duration) && element.duration > 0
        ? Math.round(element.duration * 1000)
        : undefined;
    push.current(
      {
        kind,
        positionMs: Math.round(element.currentTime * 1000),
        clockMs: performance.now(),
        rate: element.playbackRate,
      },
      duration,
    );
  }, []);
}
