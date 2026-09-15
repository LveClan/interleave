import type { SourceReturnBriefing as Briefing } from "@interleave/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ get: vi.fn(), desktop: true }));
vi.mock("../../lib/appApi", () => ({
  appApi: { getSourceReturnBriefing: h.get },
  isDesktop: () => h.desktop,
}));

import { SourceReturnBriefing } from "./SourceReturnBriefing";

const briefing = (sourceId = "a"): Briefing => ({
  sourceId,
  asOf: "2026-09-15T00:00:00Z",
  show: true,
  lastVisitAt: "2026-09-01T00:00:00Z",
  visitEvidence: "reading_activity",
  readPct: 0.4,
  readPctDelta: null,
  stateCounts: {
    unread: 3,
    read: 1,
    needs_later: 2,
    stale_after_edit: 1,
    extracted: 1,
    ignored: 0,
    processed_without_output: 0,
  },
  unresolvedBlocks: 7,
  needsReverifyOutputs: 2,
  cards: { count: 4, mature: 1, leeches: 2, retention: 0.75, reviewCount: 8, windowDays: 30 },
  strugglingGroups: { count: 1, windowDays: 30 },
  lastExtraction: {
    elementId: "extract",
    at: "2026-09-01T00:00:00Z",
    label: "Paragraph 4",
    blockId: "p4",
  },
  nextUnresolvedBlockId: "p2",
  firstDeferredBlockId: "p3",
});
beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ briefing: briefing() });
  h.desktop = true;
});
describe("SourceReturnBriefing", () => {
  it("shows trusted current counts, unknown delta, health and last extract; jumps only on command", async () => {
    const onJump = vi.fn();
    render(<SourceReturnBriefing sourceId="a" scheduledReturn canJump onJump={onJump} />);
    await screen.findByTestId("source-return-briefing");
    expect(screen.getByText("40% read")).toBeVisible();
    expect(screen.getByText("Change since last visit unknown")).toBeVisible();
    expect(screen.getByText("3 unread")).toBeVisible();
    expect(screen.getByText("2 deferred")).toBeVisible();
    expect(screen.getByText("2 outputs need verification")).toBeVisible();
    expect(screen.getByText("75% recall / 8 reviews (30d)")).toBeVisible();
    expect(screen.getByText("Last extract: Paragraph 4")).toBeVisible();
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next unresolved" }));
    fireEvent.click(screen.getByRole("button", { name: "First deferred" }));
    expect(onJump.mock.calls).toEqual([["p2"], ["p3"]]);
  });
  it("honors the trusted display gate and empty/error responses", async () => {
    h.get.mockResolvedValue({ briefing: { ...briefing(), show: false } });
    const view = render(
      <SourceReturnBriefing sourceId="a" scheduledReturn={false} canJump onJump={vi.fn()} />,
    );
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith({ sourceId: "a", scheduledReturn: false }),
    );
    expect(screen.queryByTestId("source-return-briefing")).toBeNull();
    h.get.mockRejectedValue(new Error("read failed"));
    view.rerender(<SourceReturnBriefing sourceId="b" scheduledReturn canJump onJump={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByTestId("source-return-briefing")).toBeNull();
  });
  it("keeps dismissal for the visit, resets for a new visit, disables missing targets", async () => {
    const props = { sourceId: "a", scheduledReturn: true, canJump: true, onJump: vi.fn() };
    const view = render(<SourceReturnBriefing {...props} />);
    await screen.findByTestId("source-return-briefing");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss briefing" }));
    view.rerender(<SourceReturnBriefing {...props} canJump={false} />);
    expect(screen.queryByTestId("source-return-briefing")).toBeNull();
    view.rerender(<SourceReturnBriefing {...props} scheduledReturn={false} />);
    await act(async () => {});
    expect(screen.queryByTestId("source-return-briefing")).toBeNull();
    h.get.mockResolvedValue({ briefing: { ...briefing("b"), firstDeferredBlockId: null } });
    view.rerender(<SourceReturnBriefing {...props} sourceId="b" />);
    await screen.findByTestId("source-return-briefing");
    expect(screen.getByRole("button", { name: "First deferred" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next unresolved" })).toBeEnabled();
  });
  it("discards delayed responses across A -> B -> A, including after unmount", async () => {
    const resolves: ((value: { briefing: Briefing }) => void)[] = [];
    h.get.mockImplementation(() => new Promise((resolve) => resolves.push(resolve)));
    const props = { scheduledReturn: true, canJump: true, onJump: vi.fn() };
    const view = render(<SourceReturnBriefing {...props} sourceId="a" />);
    view.rerender(<SourceReturnBriefing {...props} sourceId="b" />);
    view.rerender(<SourceReturnBriefing {...props} sourceId="a" />);
    await act(async () => {
      resolves[1]!({ briefing: briefing("b") });
      resolves[0]!({ briefing: briefing("a") });
    });
    expect(screen.queryByTestId("source-return-briefing")).toBeNull();
    await act(async () => resolves[2]!({ briefing: { ...briefing("a"), readPct: 0.6 } }));
    expect(screen.getByText("60% read")).toBeVisible();
    view.unmount();
  });
});
