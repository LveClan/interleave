import type { SectionReaderData } from "@interleave/core";
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jump: vi.fn(), getReadPoint: vi.fn(), search: { block: "b2" } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => h.search,
}));
vi.mock("../../lib/appApi", () => ({ appApi: { getReadPoint: h.getReadPoint } }));
vi.mock("../../reader/useTextSelection", () => ({ useTextSelection: () => ({ location: null }) }));
vi.mock("../../components/queue/DoneIntentMenu", () => ({ DoneIntentMenu: () => null }));
vi.mock("./PdfReader", () => ({ PdfReader: () => null }));
vi.mock("@interleave/editor", async () => {
  const React = await import("react");
  const editor = {
    state: {
      doc: {
        descendants: (fn: (node: { attrs: { blockId: string } }) => void) => {
          fn({ attrs: { blockId: "b1" } });
          fn({ attrs: { blockId: "b2" } });
        },
      },
    },
  };
  return {
    jumpToSource: h.jump,
    SourceEditor: ({ onEditorReady }: { onEditorReady: (e: unknown) => void }) => {
      React.useEffect(() => {
        onEditorReady(editor);
      }, [onEditorReady]);
      return null;
    },
  };
});

import { SectionReader } from "./SectionReader";

it("honors the explicit chapter block before reading a saved position", async () => {
  const data = {
    topicId: "topic",
    sourceId: "source",
    sourceTitle: "Book",
    title: "Chapter",
    contentDocumentId: "source",
    format: "document",
    valid: true,
    document: { type: "doc", content: [] },
    blockPages: {},
    blocks: [
      { stableBlockId: "b1", state: "read" },
      { stableBlockId: "b2", state: "needs_later" },
    ],
    summary: { terminalBlocks: 0, totalBlocks: 2, needsReverifyOutputs: 0 },
  } as unknown as SectionReaderData;
  render(<SectionReader initial={data} />);
  await waitFor(() => expect(h.jump).toHaveBeenCalledWith(expect.anything(), "b2"));
  expect(h.getReadPoint).not.toHaveBeenCalled();
});
