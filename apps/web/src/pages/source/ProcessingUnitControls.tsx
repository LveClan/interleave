import type {
  ResumeSourceBlockReceipt,
  SetProcessingUnitRequest,
  SourceBlockProcessingView,
} from "@interleave/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { requestInspectorRefresh } from "../../components/inspector/Inspector";
import { format, t, useLocale } from "../../i18n";
import { appApi } from "../../lib/appApi";
import { listenSourceReading, sourceReadingChanged } from "../../lib/sourceReadingEvents";
import { SourcePendingRail } from "./SourcePendingRail";
import { SourceReturnBriefing } from "./SourceReturnBriefing";
import "./processing-units.css";

export function ProcessingUnitControls({
  sourceId,
  activeId,
  ready,
  scheduledReturn,
  onJump,
  currentMs,
  canJump = ready,
  sectionId,
}: {
  sourceId: string;
  activeId: string;
  ready: boolean;
  scheduledReturn: boolean;
  onJump: (blockId: string) => boolean;
  currentMs?: number;
  canJump?: boolean;
  sectionId?: string | undefined;
}) {
  useLocale();
  const [blocks, setBlocks] = useState<readonly SourceBlockProcessingView[]>([]);
  const [receipt, setReceipt] = useState<ResumeSourceBlockReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [openSignal, setOpenSignal] = useState(0);
  const [resolved, setResolved] = useState(0);
  const [playbackReadPct, setPlaybackReadPct] = useState<number | null | undefined>();
  const mounted = useRef(false);
  const version = useRef(0);
  const locked = useRef(false);
  const reload = useCallback(async () => {
    const request = ++version.current;
    try {
      const result = sectionId
        ? await appApi.getSectionReader(sectionId)
        : await appApi.openProcessingUnits(sourceId);
      if (!result) return;
      if (mounted.current && request === version.current) {
        setBlocks(result.blocks);
        setResolved(result.summary.terminalBlocks);
        setPlaybackReadPct(result.summary.playbackReadPct);
        setError(false);
      }
    } catch {
      if (mounted.current && request === version.current) setError(true);
    }
  }, [sourceId, sectionId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const unlisten = listenSourceReading(sourceId, () => void reload());
    return () => {
      mounted.current = false;
      version.current++;
      unlisten();
    };
  }, [sourceId, reload]);
  const active =
    currentMs == null
      ? blocks.find((block) => block.stableBlockId === activeId)
      : (blocks.find(
          (block) =>
            block.locatable &&
            block.geometry?.kind === "media_segment" &&
            currentMs >= block.geometry.startMs &&
            (block.geometry.endMs == null || currentMs < block.geometry.endMs),
        ) ?? blocks.filter((b) => b.locatable).at(-1));
  const selectedId = active?.stableBlockId ?? activeId;
  const mutate = async (state?: SetProcessingUnitRequest["state"]) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (state && active?.blockContentHash) {
        if (sectionId) {
          await appApi.setSectionUnit({
            topicId: sectionId,
            blockId: selectedId,
            contentHash: active.blockContentHash,
            state,
          });
        } else {
          const result = await appApi.setProcessingUnit({
            sourceId,
            blockId: selectedId,
            contentHash: active.blockContentHash,
            expectedState: active.state,
            state,
          });
          if (mounted.current) setReceipt(result.receipt);
        }
      } else if (!state && receipt) {
        const result = await appApi.undoProcessingUnit(receipt);
        if (!result.undone) throw new Error("Unit changed");
        if (mounted.current) setReceipt(null);
      }
      sourceReadingChanged(sourceId);
      requestInspectorRefresh();
      if (mounted.current) await reload();
    } catch {
      if (mounted.current) {
        await reload();
        setError(true);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const actions = [
    ["read", "check", t("sourceReturn.resumeRead")],
    ["unread", "undo", t("sourceReturn.resumeUnread")],
    ["ignored", "x", t("sourceReturn.ignoreUnit")],
    ["needs_later", "postpone", t("sourceReturn.deferUnit")],
    ["processed_without_output", "checkCircle", t("sourceReturn.resolveUnit")],
  ] as const;
  const stateLabels = {
    unread: t("sourceReturn.state_unread"),
    read: t("sourceReturn.state_read"),
    ignored: t("sourceReturn.state_ignored"),
    extracted: t("sourceReturn.state_extracted"),
    needs_later: t("sourceReturn.state_needs_later"),
    processed_without_output: t("sourceReturn.state_processed_without_output"),
    stale_after_edit: t("sourceReturn.state_stale_after_edit"),
  };
  return (
    <>
      {!sectionId && (
        <SourceReturnBriefing
          sourceId={sourceId}
          scheduledReturn={scheduledReturn}
          canJump={canJump}
          onJump={(id) => {
            if (!onJump(id)) setError(true);
          }}
          onOpenPending={() => setOpenSignal((n) => n + 1)}
        />
      )}
      {!sectionId && (
        <SourcePendingRail
          sourceId={sourceId}
          canJump={canJump}
          onJump={onJump}
          openSignal={openSignal}
        />
      )}
      <section className="processing-units" aria-label={t("sourceReturn.unitState")}>
        <span>
          {active?.geometry?.kind === "pdf_page"
            ? t("sourceReturn.page", { number: active.geometry.page })
            : active?.geometry?.kind === "media_segment"
              ? t("sourceReturn.segment", {
                  start: format.number(active.geometry.startMs / 1000),
                  end:
                    active.geometry.endMs == null
                      ? t("sourceReturn.unknownEnd")
                      : format.number(active.geometry.endMs / 1000),
                })
              : t("sourceReturn.unitState")}
        </span>
        <span>{active ? stateLabels[active.state] : t("sourceReturn.noPreview")}</span>
        {active && active.outputElementIds.length > 0 && (
          <span>{t("sourceReturn.unitOutputs", { count: active.outputElementIds.length })}</span>
        )}
        <span className="processing-units__progress">
          {playbackReadPct !== undefined && (
            <span>
              {playbackReadPct == null
                ? t("sourceReturn.unknownRead")
                : t("sourceReturn.read", {
                    percent: format.number(playbackReadPct, {
                      style: "percent",
                      maximumFractionDigits: 0,
                    }),
                  })}{" "}
              ·{" "}
            </span>
          )}
          {t("sourceReturn.resolvedUnits", {
            count: resolved,
            total: format.number(blocks.length),
          })}
        </span>
        {actions
          .filter(([state]) => active?.geometry?.kind !== "media_segment" || state !== "read")
          .map(([state, icon, label]) => (
            <button
              key={state}
              type="button"
              className="btn btn--ghost btn--icon"
              title={label}
              aria-label={label}
              disabled={
                !ready ||
                !active?.locatable ||
                busy ||
                (active.geometry?.kind === "media_segment" &&
                  active.geometry.endMs == null &&
                  state !== "unread" &&
                  state !== "needs_later")
              }
              onClick={() => void mutate(state)}
            >
              <Icon name={icon} size={14} />
            </button>
          ))}
        {receipt && (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            disabled={busy}
            title={t("sourceReturn.undoResume")}
            aria-label={t("sourceReturn.undoResume")}
            onClick={() => void mutate()}
          >
            <Icon name="undo" size={14} />
          </button>
        )}
        {error && <span role="alert">{t("sourceReturn.pendingChanged")}</span>}
      </section>
      {currentMs != null && (
        <section className="processing-segments" aria-label={t("sourceReturn.segments")}>
          {blocks
            .filter((block) => block.locatable && block.geometry?.kind === "media_segment")
            .map((block) => (
              <button
                key={block.stableBlockId}
                type="button"
                className="processing-segments__unit"
                data-state={block.state}
                aria-current={block.stableBlockId === selectedId ? "true" : undefined}
                disabled={!canJump}
                title={`${block.order + 1}: ${stateLabels[block.state]}`}
                aria-label={`${block.order + 1}: ${stateLabels[block.state]}`}
                onClick={() => {
                  if (!onJump(block.stableBlockId)) setError(true);
                }}
              >
                {block.order + 1}
              </button>
            ))}
        </section>
      )}
    </>
  );
}
