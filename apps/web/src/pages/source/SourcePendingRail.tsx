import type {
  ResumeSourceBlockReceipt,
  SourcePendingBlock,
  SourcePendingBlocks,
} from "@interleave/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { requestInspectorRefresh } from "../../components/inspector/Inspector";
import { format, t, useLocale } from "../../i18n";
import { appApi, isDesktop } from "../../lib/appApi";
import { listenSourceReading, sourceReadingChanged } from "../../lib/sourceReadingEvents";
import { UNDO_EVENT } from "../../shell/nav";
import "./source-pending.css";

export function SourcePendingRail({
  sourceId,
  canJump,
  onJump,
  openSignal = 0,
  canMutate = () => true,
}: {
  sourceId: string;
  canJump: boolean;
  onJump: (blockId: string) => boolean;
  openSignal?: number;
  canMutate?: () => boolean;
}) {
  return (
    <SourcePendingRailVisit
      key={sourceId}
      sourceId={sourceId}
      canJump={canJump}
      onJump={onJump}
      openSignal={openSignal}
      canMutate={canMutate}
    />
  );
}

function SourcePendingRailVisit({
  sourceId,
  canJump,
  onJump,
  openSignal,
  canMutate,
}: {
  sourceId: string;
  canJump: boolean;
  onJump: (blockId: string) => boolean;
  openSignal: number;
  canMutate: () => boolean;
}) {
  useLocale();
  const navigate = useNavigate();
  const listId = useId();
  const [data, setData] = useState<SourcePendingBlocks | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ResumeSourceBlockReceipt | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await appApi.getSourcePending(sourceId);
      if (!mounted.current || requestVersion.current !== version) return;
      setData(result.pending);
      setError(null);
    } catch {
      if (mounted.current && requestVersion.current === version) {
        setData(null);
        setError(t("sourceReturn.pendingLoadFailed"));
      }
    }
  }, [sourceId]);
  useEffect(() => {
    mounted.current = true;
    if (!isDesktop()) return;
    void reload();
    const refresh = () => {
      void reload();
    };
    const unlisten = listenSourceReading(sourceId, refresh);
    window.addEventListener(UNDO_EVENT, refresh);
    return () => {
      mounted.current = false;
      requestVersion.current++;
      unlisten();
      window.removeEventListener(UNDO_EVENT, refresh);
    };
  }, [sourceId, reload]);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const entries = data?.sourceId === sourceId ? data.entries : [];
  const jump = useCallback(
    (entry: SourcePendingBlock) => {
      if (!canJump || !entry.locatable) return;
      if (entry.topicId) {
        void navigate({
          to: "/source/$id",
          params: { id: entry.topicId },
          search:
            entry.geometry?.kind === "pdf_page"
              ? { page: entry.geometry.page }
              : { block: entry.blockId },
        });
        return;
      }
      setOpen(true);
      if (!onJump(entry.blockId)) {
        setError(t("sourceReturn.moved"));
        void reload();
        return;
      }
      setActive(entry.blockId);
      setError(null);
    },
    [canJump, onJump, reload, navigate],
  );
  const step = useCallback(
    (direction: -1 | 1) => {
      const targets = entries.filter((entry) => entry.locatable);
      if (!targets.length) return;
      const index = targets.findIndex((entry) => entry.blockId === active);
      const next =
        index < 0
          ? direction === 1
            ? 0
            : targets.length - 1
          : (index + direction + targets.length) % targets.length;
      const target = targets[next];
      if (target) jump(target);
    },
    [entries, active, jump],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !canJump
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [role=dialog], [role=menu]")) return;
      if (event.key !== "[" && event.key !== "]") return;
      if (!entries.some((entry) => entry.locatable)) return;
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "]" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [canJump, entries, step]);
  const mutate = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    if (!canMutate()) {
      setError(t("sourceReturn.waitForSave"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    requestVersion.current++;
    try {
      await run();
      sourceReadingChanged(sourceId);
      if (!mounted.current) return;
      requestInspectorRefresh();
      await reload();
    } catch {
      if (mounted.current) {
        await reload();
        setError(t("sourceReturn.pendingChanged"));
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const resume = (entry: SourcePendingBlock, state: "unread" | "read") => {
    if (!entry.canResume || !entry.contentHash) return;
    const contentHash = entry.contentHash;
    void mutate(async () => {
      const result = await appApi.resumeSourceBlock({
        sourceId,
        blockId: entry.blockId,
        expectedState: entry.state,
        contentHash,
        state,
      });
      if (mounted.current) setReceipt(result.receipt);
    });
  };
  if (!isDesktop() || (!data && !error)) return null;
  return (
    <section
      className="source-pending"
      aria-label={t("sourceReturn.pendingTitle")}
      data-testid="source-pending-rail"
    >
      <div className="source-pending__head">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
          {t("sourceReturn.pendingCount", { count: entries.length })}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={t("sourceReturn.previousPending")}
          aria-label={t("sourceReturn.previousPending")}
          disabled={!canJump || !entries.some((e) => e.locatable)}
          onClick={() => step(-1)}
        >
          <Icon name="arrowUp" size={14} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={t("sourceReturn.nextPending")}
          aria-label={t("sourceReturn.nextPending")}
          disabled={!canJump || !entries.some((e) => e.locatable)}
          onClick={() => step(1)}
        >
          <Icon name="arrowDown" size={14} />
        </button>
        {receipt && (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            title={t("sourceReturn.undoResume")}
            aria-label={t("sourceReturn.undoResume")}
            disabled={busy}
            onClick={() =>
              void mutate(async () => {
                const result = await appApi.undoSourceBlockResume(receipt);
                if (mounted.current) setReceipt(null);
                if (!result.undone) throw new Error("Stale receipt");
              })
            }
          >
            <Icon name="undo" size={14} />
          </button>
        )}
        {(data?.summary.needsReverifyOutputs ?? 0) > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              void navigate({ to: "/maintenance/reverify", search: { source: sourceId } })
            }
          >
            <Icon name="warning" size={13} />
            {t("sourceReturn.reverify", { count: data?.summary.needsReverifyOutputs ?? 0 })}
          </button>
        )}
      </div>
      {error && (
        <div role="status" className="source-pending__error">
          {error}
          <button type="button" onClick={() => void reload()}>
            {t("sourceReturn.retryPending")}
          </button>
        </div>
      )}
      {open && (
        <ul id={listId} className="source-pending__list">
          {entries.length === 0 && (
            <li className="source-pending__empty">{t("sourceReturn.noPending")}</li>
          )}
          {entries.map((entry) => (
            <li key={entry.blockId} data-active={active === entry.blockId}>
              <button
                type="button"
                className="source-pending__target"
                disabled={!canJump || !entry.locatable}
                onClick={() => jump(entry)}
              >
                <span className="source-pending__meta">
                  {entry.order === null
                    ? t("sourceReturn.moved")
                    : entry.geometry?.kind === "pdf_page"
                      ? t("sourceReturn.page", { number: entry.geometry.page })
                      : entry.geometry?.kind === "media_segment"
                        ? t("sourceReturn.segment", {
                            start: format.number(entry.geometry.startMs / 1000),
                            end:
                              entry.geometry.endMs == null
                                ? t("sourceReturn.unknownEnd")
                                : format.number(entry.geometry.endMs / 1000),
                          })
                        : t("sourceReturn.paragraph", {
                            number: format.number(entry.order + 1),
                          })}{" "}
                  ·{" "}
                  {entry.state === "needs_later"
                    ? t("sourceReturn.pendingDeferred")
                    : t("sourceReturn.pendingStale")}
                </span>
                <span className="source-pending__preview">
                  {entry.preview || t("sourceReturn.noPreview")}
                </span>
              </button>
              <div className="source-pending__row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.resumeUnread")}
                  aria-label={t("sourceReturn.resumeUnread")}
                  disabled={busy || !entry.canResume || !canJump}
                  onClick={() => resume(entry, "unread")}
                >
                  <Icon name="restore" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t("sourceReturn.resumeRead")}
                  aria-label={t("sourceReturn.resumeRead")}
                  disabled={busy || !entry.canResume || !canJump || entry.canResumeRead === false}
                  onClick={() => resume(entry, "read")}
                >
                  <Icon name="eye" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
