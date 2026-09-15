import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ start: vi.fn(), record: vi.fn() }));
vi.mock("../../lib/appApi", () => ({
  appApi: { startMediaPlayback: h.start, recordMediaPlayback: h.record },
}));

import { useMediaCoverage } from "./useMediaCoverage";

it("retries the same failed batch without losing later events and flushes at unmount", async () => {
  vi.useFakeTimers();
  h.start.mockResolvedValue({ sessionId: "session" });
  h.record.mockRejectedValueOnce(new Error("failed")).mockResolvedValue({ saved: true });
  const error = vi.fn();
  const player = { currentTime: 0, playbackRate: 1, duration: 10 } as HTMLMediaElement;
  const { result, unmount } = renderHook(() => useMediaCoverage("source", true, error));
  await act(async () => {
    result.current("playing", player);
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(error).toHaveBeenCalledTimes(1);
  player.currentTime = 1;
  await act(async () => {
    result.current("sample", player);
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(h.record.mock.calls[1]?.[0]).toEqual(h.record.mock.calls[0]?.[0]);
  await act(async () => {
    unmount();
  });
  expect(h.record.mock.calls[2]?.[0]).toMatchObject({
    sequence: 2,
    events: [{ kind: "sample", positionMs: 1000 }],
  });
  vi.useRealTimers();
});
