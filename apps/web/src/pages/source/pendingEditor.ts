import type { Editor } from "@interleave/editor";

/** Compare normalized ProseMirror nodes, including defaults filled on import. */
export function isPendingEditorSaved(editor: Editor | null, persistedDoc: unknown): boolean {
  if (!editor || persistedDoc == null) return false;
  try {
    return editor.state.doc.eq(editor.schema.nodeFromJSON(persistedDoc));
  } catch {
    return false;
  }
}
