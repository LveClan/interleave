import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ list: vi.fn(), apply: vi.fn(), undo: vi.fn(), navigate: vi.fn() }));
vi.mock("../../lib/appApi", () => ({
  isDesktop: () => true,
  appApi: { getSourceStructure: h.list, applySourceSkim: h.apply, undoSourceSkim: h.undo },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));

import { StructuralSkim } from "./StructuralSkim";

it("submits only selected verdicts and offers batch undo", async () => {
  const range = {
    key: "r",
    title: "Chapter",
    depth: 0,
    documentId: "source",
    unitIds: ["a", "b"],
    fingerprint: "h",
    topicId: null,
    verdict: null,
    priority: 0.375,
    valid: true,
  };
  h.list.mockResolvedValue({ sourceId: "source", format: "document", ranges: [range], units: [] });
  h.apply.mockResolvedValue({ sourceId: "source", token: "token" });
  h.undo.mockResolvedValue({ undone: true });
  const view = render(<StructuralSkim sourceId="source" />);
  fireEvent.click(view.getByRole("button", { name: "Structural skim" }));
  await waitFor(() =>
    expect(view.getByRole("combobox", { name: "Chapter: Verdict" })).toBeTruthy(),
  );
  fireEvent.change(view.getByRole("combobox", { name: "Chapter: Verdict" }), {
    target: { value: "later" },
  });
  fireEvent.click(view.getByRole("button", { name: "Apply skim" }));
  await waitFor(() =>
    expect(h.apply).toHaveBeenCalledWith({
      sourceId: "source",
      decisions: [{ range, verdict: "later", priority: 0.375 }],
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Undo section batch" }));
  await waitFor(() => expect(h.undo).toHaveBeenCalledWith({ sourceId: "source", token: "token" }));
});
