import type { SectionReaderData, SkimReceipt } from "@interleave/core";
import { type Editor, jumpToSource, SourceEditor } from "@interleave/editor";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { DoneIntentMenu } from "../../components/queue/DoneIntentMenu";
import { t, useLocale } from "../../i18n";
import { appApi } from "../../lib/appApi";
import { listenSourceReading, sourceReadingChanged } from "../../lib/sourceReadingEvents";
import { useTextSelection } from "../../reader/useTextSelection";
import { PdfReader } from "./PdfReader";
import "./structural-skim.css";

export function SectionReader({
  initial,
  scheduledReturn = false,
}: {
  initial: SectionReaderData;
  scheduledReturn?: boolean;
}) {
  useLocale();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { block?: string; page?: number };
  const routeTarget = useRef<string | null>(null);
  const [data, setData] = useState(initial),
    [editor, setEditor] = useState<Editor | null>(null),
    [active, setActive] = useState(initial.blocks[0]?.stableBlockId ?? "");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<SkimReceipt | null>(null);
  const alive = useRef(false),
    version = useRef(0),
    jumped = useRef(false),
    resumed = useRef(false);
  const selection = useTextSelection(editor, editor !== null);
  const reload = useCallback(async () => {
    const n = ++version.current;
    const next = await appApi.getSectionReader(initial.topicId);
    if (alive.current && n === version.current && next) setData(next);
  }, [initial.topicId]);
  useEffect(() => {
    alive.current = true;
    const off = listenSourceReading(initial.contentDocumentId, () => void reload());
    return () => {
      alive.current = false;
      version.current++;
      off();
    };
  }, [initial.contentDocumentId, reload]);
  const jump = useCallback(
    (blockId: string) => {
      if (!editor) return false;
      if (!data.blocks.some((b) => b.stableBlockId === blockId)) {
        setMessage(t("sourceReturn.moved"));
        return false;
      }
      let found = false;
      editor.state.doc.descendants((node) => {
        if (node.attrs.blockId === blockId) found = true;
      });
      if (!found) {
        setMessage(t("sourceReturn.moved"));
        return false;
      }
      jumped.current = true;
      setActive(blockId);
      jumpToSource(editor, blockId);
      return true;
    },
    [editor, data.blocks],
  );
  useEffect(() => {
    if (!editor) return;
    if (search.block && routeTarget.current !== search.block) {
      routeTarget.current = search.block;
      if (jump(search.block)) return;
    }
    if (resumed.current || jumped.current) return;
    resumed.current = true;
    let cancelled = false;
    void appApi
      .getReadPoint({ elementId: data.topicId })
      .then(({ readPoint }) => {
        if (!cancelled && !jumped.current && readPoint) jump(readPoint.blockId);
      })
      .catch(() => {
        if (!cancelled) setMessage(t("sourceReturn.moved"));
      });
    return () => {
      cancelled = true;
    };
  }, [editor, data.topicId, jump, search.block]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      sourceReadingChanged(data.contentDocumentId);
      sourceReadingChanged(data.sourceId);
      await reload();
    } catch {
      if (alive.current) setMessage(t("sourceReturn.skimFailed"));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const mark = (state: "read" | "ignored" | "needs_later") =>
    void run(async () => {
      const block = data.blocks.find(
        (b) => b.stableBlockId === (selection.location?.blockIds[0] ?? active),
      );
      if (!block?.blockContentHash) throw new Error("No block");
      await appApi.setSectionUnit({
        topicId: data.topicId,
        blockId: block.stableBlockId,
        contentHash: block.blockContentHash,
        state,
      });
    });
  const savePoint = () =>
    void run(async () => {
      const blockId = selection.location?.blockIds[0] ?? active;
      if (!blockId) throw new Error("No position");
      await appApi.setReadPoint({
        elementId: data.topicId,
        documentId: data.contentDocumentId,
        blockId,
        offset: selection.location?.startOffset ?? 0,
      });
    });
  const extract = () =>
    void run(async () => {
      const loc = selection.location;
      if (!loc) throw new Error("No selection");
      await appApi.createExtraction({
        sourceElementId: data.sourceId,
        ...(data.contentDocumentId !== data.sourceId ? { parentId: data.contentDocumentId } : {}),
        blockIds: loc.blockIds,
        selectedText: loc.selectedText,
        startOffset: loc.startOffset,
        endOffset: loc.endOffset,
      });
    });
  const pending = data.blocks.filter(
    (b) => b.state === "needs_later" || b.state === "stale_after_edit",
  );
  const stateLabels = {
    unread: t("sourceReturn.state_unread"),
    read: t("sourceReturn.state_read"),
    extracted: t("sourceReturn.state_extracted"),
    ignored: t("sourceReturn.state_ignored"),
    needs_later: t("sourceReturn.state_needs_later"),
    processed_without_output: t("sourceReturn.state_processed_without_output"),
    stale_after_edit: t("sourceReturn.state_stale_after_edit"),
  };
  return (
    <div className="section-reader">
      <header className="section-reader__toolbar">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void navigate({ to: "/source/$id", params: { id: data.sourceId } })}
        >
          <Icon name="arrowLeft" size={14} />
          {t("sourceReturn.sectionOf", { title: data.sourceTitle })}
        </button>
        <strong>{data.title}</strong>
        <DoneIntentMenu
          getSummary={async () => data.summary}
          onResolved={(intent) =>
            void run(async () => {
              const result = await appApi.finishSection({
                topicId: data.topicId,
                intent: intent === "later" ? "return_later" : intent,
              });
              if (alive.current) setReceipt(result);
            })
          }
          busy={busy || !data.valid}
          triggerLabel={t("sourceReturn.sectionDone")}
        />
        {receipt && (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title={t("sourceReturn.undoSkim")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await appApi.undoSourceSkim(receipt);
                if (!r.undone) throw new Error("Changed");
                setReceipt(null);
              })
            }
          >
            <Icon name="undo" size={14} />
          </button>
        )}
      </header>
      {!data.valid ? (
        <p role="alert">{t("sourceReturn.moved")}</p>
      ) : (
        <>
          <div className="section-reader__toolbar">
            <span>
              {t("sourceReturn.resolvedUnits", {
                count: data.summary.terminalBlocks,
                total: data.summary.totalBlocks,
              })}
            </span>
            <span>{t("sourceReturn.pendingCount", { count: pending.length })}</span>
            {data.summary.needsReverifyOutputs > 0 && (
              <span>
                {t("sourceReturn.reverify", { count: data.summary.needsReverifyOutputs })}
              </span>
            )}
            {data.format === "document" && (
              <>
                <select
                  aria-label={t("sourceReturn.sectionPosition")}
                  value={active}
                  onChange={(e) => jump(e.target.value)}
                >
                  {data.blocks.map((b, i) => (
                    <option key={b.stableBlockId} value={b.stableBlockId}>
                      {i + 1}: {stateLabels[b.state]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.resumeRead")}
                  onClick={() => mark("read")}
                  disabled={busy}
                >
                  <Icon name="eye" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.skimLater")}
                  onClick={() => mark("needs_later")}
                  disabled={busy}
                >
                  <Icon name="postpone" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.skimIgnore")}
                  onClick={() => mark("ignored")}
                  disabled={busy}
                >
                  <Icon name="x" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.saveSectionPoint")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={savePoint}
                  disabled={busy}
                >
                  <Icon name="bookmark" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={extract}
                  disabled={busy || !selection.location}
                >
                  <Icon name="extract" size={14} />
                  {t("sourceReturn.sectionExtract")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => pending[0] && jump(pending[0].stableBlockId)}
                  disabled={!pending.length}
                >
                  {t("sourceReturn.firstDeferred")}
                </button>
              </>
            )}
          </div>
          {data.format === "pdf" ? (
            <PdfReader
              key={data.topicId}
              elementId={data.contentDocumentId}
              readPointElementId={data.topicId}
              sectionId={data.topicId}
              jump={search.page == null ? null : { page: search.page }}
              blockPages={data.blockPages}
              scheduledReturn={scheduledReturn}
              toast={setMessage}
            />
          ) : (
            <div className="section-reader__body">
              <SourceEditor
                key={JSON.stringify(data.document)}
                initialDoc={data.document}
                editable={false}
                onEditorReady={setEditor}
                readerDecorations
              />
            </div>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
