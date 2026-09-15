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
}: {
  sourceId: string;
  activeId: string;
  ready: boolean;
  scheduledReturn: boolean;
  onJump: (blockId: string) => boolean;
}) {
  useLocale();
  const [blocks, setBlocks] = useState<readonly SourceBlockProcessingView[]>([]);
  const [receipt, setReceipt] = useState<ResumeSourceBlockReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [openSignal, setOpenSignal] = useState(0);
  const [resolved, setResolved] = useState(0);
  const mounted = useRef(false);
  const version = useRef(0);
  const locked = useRef(false);
  const reload = useCallback(async () => {
    const request = ++version.current;
    try {
      const result = await appApi.openProcessingUnits(sourceId);
      if (mounted.current && request === version.current) {
        setBlocks(result.blocks);
        setResolved(result.summary.terminalBlocks);
        setError(false);
      }
    } catch {
      if (mounted.current && request === version.current) setError(true);
    }
  }, [sourceId]);
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
  const active = blocks.find((block) => block.stableBlockId === activeId);
  const mutate = async (state?: SetProcessingUnitRequest["state"]) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (state && active?.blockContentHash) {
        const result = await appApi.setProcessingUnit({
          sourceId,
          blockId: activeId,
          contentHash: active.blockContentHash,
          expectedState: active.state,
          state,
        });
        if (mounted.current) setReceipt(result.receipt);
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
      <SourceReturnBriefing
        sourceId={sourceId}
        scheduledReturn={scheduledReturn}
        canJump={ready}
        onJump={(id) => {
          if (!onJump(id)) setError(true);
        }}
        onOpenPending={() => setOpenSignal((n) => n + 1)}
      />
      <SourcePendingRail
        sourceId={sourceId}
        canJump={ready}
        onJump={onJump}
        openSignal={openSignal}
      />
      <section className="processing-units" aria-label={t("sourceReturn.unitState")}>
        <span>
          {active?.geometry?.kind === "pdf_page"
            ? t("sourceReturn.page", { number: active.geometry.page })
            : t("sourceReturn.unitState")}
        </span>
        <span>{active ? stateLabels[active.state] : t("sourceReturn.noPreview")}</span>
        {active && active.outputElementIds.length > 0 && (
          <span>{t("sourceReturn.unitOutputs", { count: active.outputElementIds.length })}</span>
        )}
        <span className="processing-units__progress">
          {t("sourceReturn.resolvedUnits", {
            count: resolved,
            total: format.number(blocks.length),
          })}
        </span>
        {actions.map(([state, icon, label]) => (
          <button
            key={state}
            type="button"
            className="btn btn--ghost btn--icon"
            title={label}
            aria-label={label}
            disabled={!ready || !active?.locatable || busy}
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
    </>
  );
}
