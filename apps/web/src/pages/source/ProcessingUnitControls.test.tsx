import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ open: vi.fn(), set: vi.fn(), undo: vi.fn() }));
vi.mock("../../lib/appApi", () => ({
  appApi: { openProcessingUnits: h.open, setProcessingUnit: h.set, undoProcessingUnit: h.undo },
}));
vi.mock("../../components/inspector/Inspector", () => ({ requestInspectorRefresh: vi.fn() }));
vi.mock("./SourcePendingRail", () => ({ SourcePendingRail: () => null }));
vi.mock("./SourceReturnBriefing", () => ({ SourceReturnBriefing: () => null }));

import { ProcessingUnitControls } from "./ProcessingUnitControls";

it("uses trusted summary and expected state for the active page, and offers receipt undo", async () => {
  h.open.mockResolvedValue({
    blocks: [
      {
        stableBlockId: "pdf:page:2",
        geometry: { kind: "pdf_page", page: 2 },
        state: "unread",
        blockContentHash: "abc",
        outputElementIds: ["extract"],
        locatable: true,
      },
    ],
    summary: { terminalBlocks: 0 },
  });
  h.set.mockResolvedValue({
    receipt: { sourceId: "source", blockId: "pdf:page:2", token: "receipt" },
  });
  h.undo.mockResolvedValue({ undone: true });
  const { getByRole, getByText } = render(
    <ProcessingUnitControls
      sourceId="source"
      activeId="pdf:page:2"
      ready
      scheduledReturn={false}
      onJump={() => true}
    />,
  );
  await waitFor(() => expect(getByText("1 linked outputs")).toBeTruthy());
  fireEvent.click(getByRole("button", { name: "Defer remaining content" }));
  await waitFor(() =>
    expect(h.set).toHaveBeenCalledWith({
      sourceId: "source",
      blockId: "pdf:page:2",
      contentHash: "abc",
      expectedState: "unread",
      state: "needs_later",
    }),
  );
  fireEvent.click(getByRole("button", { name: "Undo passage state change" }));
  await waitFor(() =>
    expect(h.undo).toHaveBeenCalledWith({
      sourceId: "source",
      blockId: "pdf:page:2",
      token: "receipt",
    }),
  );
});
