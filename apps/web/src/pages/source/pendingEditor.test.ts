import { buildSchema, type Editor } from "@interleave/editor";
import { expect, it } from "vitest";
import { isPendingEditorSaved } from "./pendingEditor";

it("compares schema-normalized content, accepting default attrs but refusing pending edits", () => {
  const schema = buildSchema();
  const stored = {
    type: "doc",
    content: [{ type: "heading", content: [{ type: "text", text: "Heading" }] }],
  };
  const document = schema.nodeFromJSON(stored);
  const editor = { schema, state: { doc: document } } as Editor;
  expect(JSON.stringify(document.toJSON())).not.toEqual(JSON.stringify(stored));
  expect(isPendingEditorSaved(editor, stored)).toBe(true);
  expect(isPendingEditorSaved(editor, { type: "doc", content: [{ type: "paragraph" }] })).toBe(
    false,
  );
  expect(isPendingEditorSaved(editor, { type: "unknown" })).toBe(false);
  expect(isPendingEditorSaved(null, stored)).toBe(false);
});
