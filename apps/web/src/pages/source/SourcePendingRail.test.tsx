import type { SourcePendingBlocks } from "@interleave/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { sourceReadingChanged } from "../../lib/sourceReadingEvents";

const h = vi.hoisted(() => ({ get: vi.fn(), resume: vi.fn(), undo: vi.fn(), navigate: vi.fn() }));
vi.mock("../../lib/appApi", () => ({
  isDesktop: () => true,
  appApi: { getSourcePending: h.get, resumeSourceBlock: h.resume, undoSourceBlockResume: h.undo },
}));
vi.mock("../../components/inspector/Inspector", () => ({ requestInspectorRefresh: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));

import { SourcePendingRail } from "./SourcePendingRail";

const pending = (sourceId = "a"): SourcePendingBlocks => ({
  sourceId,
  entries: [
    {
      blockId: "p2",
      order: 1,
      state: "needs_later",
      preview: "Second",
      contentHash: "a".repeat(64),
      locatable: true,
      canResume: true,
    },
    {
      blockId: "p4",
      order: 3,
      state: "stale_after_edit",
      preview: "Fourth",
      contentHash: "b".repeat(64),
      locatable: true,
      canResume: false,
    },
    {
      blockId: "gone",
      order: null,
      state: "stale_after_edit",
      preview: "",
      contentHash: null,
      locatable: false,
      canResume: false,
    },
  ],
  summary: { sourceElementId: sourceId, needsReverifyOutputs: 2 } as SourcePendingBlocks["summary"],
});
beforeEach(() => {
  h.get.mockReset().mockResolvedValue({ pending: pending() });
  h.resume.mockReset();
  h.undo.mockReset();
  h.navigate.mockClear();
});
it("refuses state changes while editor content has not been persisted", async () => {
  render(
    <SourcePendingRail
      sourceId="a"
      canJump
      canMutate={() => false}
      onJump={() => true}
      openSignal={1}
    />,
  );
  await screen.findByText("Second");
  fireEvent.click(screen.getAllByRole("button", { name: "Resume as unread" })[0] as HTMLElement);
  expect(screen.getByRole("status")).toHaveTextContent("Wait for source edits to finish saving");
  expect(h.resume).not.toHaveBeenCalled();
});
it("collapses, opens from the briefing, skips missing locations, and shares keyboard/click navigation", async () => {
  const onJump = vi.fn(() => true);
  const view = render(<SourcePendingRail sourceId="a" canJump onJump={onJump} />);
  await screen.findByTestId("source-pending-rail");
  expect(screen.queryByText("Second")).toBeNull();
  view.rerender(<SourcePendingRail sourceId="a" canJump onJump={onJump} openSignal={1} />);
  expect(screen.getByText("Second")).toBeVisible();
  expect(screen.getByText("Preview unavailable").closest("button")).toBeDisabled();
  fireEvent.keyDown(window, { key: "]", altKey: true });
  fireEvent.keyDown(window, { key: "]", altKey: true });
  fireEvent.keyDown(window, { key: "]", altKey: true });
  fireEvent.keyDown(window, { key: "[", altKey: true });
  expect(onJump.mock.calls).toEqual([["p2"], ["p4"], ["p2"], ["p4"]]);
  fireEvent.click(screen.getByText("Second"));
  expect(onJump).toHaveBeenLastCalledWith("p2");
  fireEvent.click(screen.getByText("2 outputs need verification"));
  expect(h.navigate).toHaveBeenCalledWith({ to: "/maintenance/reverify", search: { source: "a" } });
});
it("resumes using trusted preconditions, refreshes the list and supports guarded undo", async () => {
  const receipt = { sourceId: "a", blockId: "p2", token: "token" };
  h.resume.mockResolvedValue({ receipt });
  h.undo.mockResolvedValue({ undone: true });
  render(<SourcePendingRail sourceId="a" canJump onJump={() => true} openSignal={1} />);
  await screen.findByText("Second");
  h.get.mockResolvedValue({ pending: { ...pending(), entries: pending().entries.slice(1) } });
  fireEvent.click(screen.getAllByRole("button", { name: "Resume as unread" })[0] as HTMLElement);
  await waitFor(() => expect(screen.queryByText("Second")).toBeNull());
  expect(h.resume).toHaveBeenCalledWith({
    sourceId: "a",
    blockId: "p2",
    expectedState: "needs_later",
    contentHash: "a".repeat(64),
    state: "unread",
  });
  h.get.mockResolvedValue({ pending: pending() });
  fireEvent.click(screen.getByRole("button", { name: "Undo passage state change" }));
  await screen.findByText("Second");
  expect(h.undo).toHaveBeenCalledWith(receipt);
});
it("rejects missing live editor targets without changing selection and refreshes", async () => {
  const jump = vi.fn(() => false);
  render(<SourcePendingRail sourceId="a" canJump onJump={jump} openSignal={1} />);
  await screen.findByText("Second");
  fireEvent.click(screen.getByText("Second"));
  expect(await screen.findByRole("status")).toHaveTextContent("Source location moved");
  expect(jump).toHaveBeenCalledWith("p2");
});
it("discards old loads and source mutations after a keyed source switch", async () => {
  let finish: (value: unknown) => void = () => {};
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <SourcePendingRail key="a" sourceId="a" canJump onJump={() => true} openSignal={1} />,
  );
  h.get.mockResolvedValue({ pending: { ...pending("b"), entries: [] } });
  view.rerender(
    <SourcePendingRail key="b" sourceId="b" canJump onJump={() => true} openSignal={1} />,
  );
  await screen.findByText("No deferred or stale passages");
  await act(async () => finish({ pending: pending("a") }));
  expect(screen.queryByText("Second")).toBeNull();
  h.get.mockClear();
  act(() => sourceReadingChanged("a"));
  expect(h.get).not.toHaveBeenCalled();
});
it("does not let a late mutation update or navigate the next source", async () => {
  let finish: (value: unknown) => void = () => {};
  h.resume.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const jump = vi.fn(() => true);
  const view = render(<SourcePendingRail sourceId="a" canJump onJump={jump} openSignal={1} />);
  await screen.findByText("Second");
  fireEvent.click(screen.getAllByRole("button", { name: "Resume as unread" })[0] as HTMLElement);
  h.get.mockResolvedValue({ pending: { ...pending("b"), entries: [] } });
  view.rerender(<SourcePendingRail sourceId="b" canJump onJump={jump} openSignal={1} />);
  await screen.findByText("No deferred or stale passages");
  await act(async () => finish({ receipt: { sourceId: "a", blockId: "p2", token: "old" } }));
  expect(screen.queryByRole("button", { name: "Undo passage state change" })).toBeNull();
  expect(jump).not.toHaveBeenCalled();
});
