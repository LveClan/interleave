import { expect, it } from "vitest";
import {
  coveredTime,
  mediaSegments,
  mergeTimeRanges,
  PlaybackCoverage,
  type PlaybackEvent,
} from "./media-processing";

const event = (
  kind: PlaybackEvent["kind"],
  positionMs: number,
  clockMs: number,
  rate = 1,
): PlaybackEvent => ({ kind, positionMs, clockMs, rate });
it("unions overlap and repeats exactly, preserving gaps and clipped tails", () => {
  const union = mergeTimeRanges([
    { startMs: 100, endMs: 200 },
    { startMs: 0, endMs: 100 },
    { startMs: 50, endMs: 150 },
    { startMs: 201, endMs: 250 },
  ]);
  expect(union).toEqual([
    { startMs: 0, endMs: 200 },
    { startMs: 201, endMs: 250 },
  ]);
  expect(coveredTime(union, { startMs: 100, endMs: 220 })).toBe(119);
});
it("counts continuous playback only and never bridges seeks, pauses, stalls or repeated viewing", () => {
  const recorder = new PlaybackCoverage();
  const ranges = recorder.consume([
    event("sample", 5000, 0),
    event("sample", 6000, 1000),
    event("playing", 0, 2000),
    event("sample", 1000, 3000),
    event("pause", 1500, 3500),
    event("sample", 9000, 9000),
    event("playing", 1500, 10_000),
    event("seeking", 20_000, 10_500),
    event("seeked", 20_000, 10_600),
    event("playing", 20_000, 10_600),
    event("sample", 21_000, 11_600),
    event("waiting", 21_000, 12_600),
    event("sample", 25_000, 16_600),
    event("playing", 0, 17_000),
    event("sample", 1000, 18_000),
    event("pause", 1500, 18_500),
  ]);
  expect(ranges).toEqual([
    { startMs: 0, endMs: 1500 },
    { startMs: 20_000, endMs: 21_000 },
  ]);
  expect(recorder.consume([event("playing", 0, 20_000), event("sample", 60_000, 21_000)])).toEqual(
    [],
  );
});
it("uses cue-start groups, fixed windows, unknown tails and exact end boundaries", () => {
  expect(mediaSegments(400_000, [0, 195_000, 380_000])).toEqual([
    { startMs: 0, endMs: 195_000 },
    { startMs: 195_000, endMs: 380_000 },
    { startMs: 380_000, endMs: 400_000 },
  ]);
  expect(mediaSegments(360_000, [])).toEqual([
    { startMs: 0, endMs: 180_000 },
    { startMs: 180_000, endMs: 360_000 },
  ]);
  expect(mediaSegments(null, [], 190_000)).toEqual([
    { startMs: 0, endMs: 180_000 },
    { startMs: 180_000, endMs: null },
  ]);
});
