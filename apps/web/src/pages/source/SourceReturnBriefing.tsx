import type { SourceReturnBriefing as Briefing } from "@interleave/core";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { format, t, useLocale } from "../../i18n";
import { appApi, isDesktop } from "../../lib/appApi";
import { listenSourceReading } from "../../lib/sourceReadingEvents";
import { UNDO_EVENT } from "../../shell/nav";
import "./source-return-briefing.css";

/** Mounted with a visit key by each host, so dismissals end when that visit ends. */
export function SourceReturnBriefing({
  sourceId,
  scheduledReturn,
  onJump,
  canJump,
  onOpenPending,
}: {
  sourceId: string;
  scheduledReturn: boolean;
  onJump: (blockId: string) => void;
  canJump: boolean;
  onOpenPending?: () => void;
}) {
  useLocale();
  const [result, setResult] = useState<{ sourceId: string; value: Briefing | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Entry/search changes within this source do not start another visit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only for a different source
  useEffect(() => setDismissed(false), [sourceId]);
  useEffect(() => {
    setResult(null);
    if (!isDesktop()) return;
    let cancelled = false;
    let version = 0;
    const reload = () => {
      const request = ++version;
      void appApi
        .getSourceReturnBriefing({ sourceId, scheduledReturn })
        .then(({ briefing }) => {
          if (!cancelled && request === version)
            setResult((previous) => ({
              sourceId,
              value:
                previous?.sourceId === sourceId && previous.value && briefing
                  ? {
                      ...briefing,
                      show: previous.value.show,
                      lastVisitAt: previous.value.lastVisitAt,
                      visitEvidence: previous.value.visitEvidence,
                    }
                  : briefing,
            }));
        })
        .catch(() => {
          /* Advisory read failures leave the reading surface available. */
        });
    };
    reload();
    const unlisten = listenSourceReading(sourceId, reload);
    window.addEventListener(UNDO_EVENT, reload);
    return () => {
      cancelled = true;
      unlisten();
      window.removeEventListener(UNDO_EVENT, reload);
    };
  }, [sourceId, scheduledReturn]);
  const data = result?.sourceId === sourceId ? result.value : null;
  if (!data?.show || dismissed) return null;
  const percent = (value: number) =>
    format.number(value, { style: "percent", maximumFractionDigits: 0 });
  return (
    <section
      className="source-return"
      data-testid="source-return-briefing"
      aria-label={t("sourceReturn.title")}
    >
      <div className="source-return__heading">
        <strong>{t("sourceReturn.title")}</strong>
        <span>
          {data.lastVisitAt
            ? t("sourceReturn.lastVisit", {
                date: format.date(data.lastVisitAt, { dateStyle: "medium", timeStyle: "short" }),
              })
            : t("sourceReturn.unknownVisit")}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          title={t("sourceReturn.dismiss")}
          aria-label={t("sourceReturn.dismiss")}
          onClick={() => setDismissed(true)}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="source-return__facts">
        <span>
          {data.readPctKnown === false
            ? t("sourceReturn.unknownRead")
            : t("sourceReturn.read", { percent: percent(data.readPct) })}
        </span>
        <span>
          {data.readPctDelta === null
            ? t("sourceReturn.unknownDelta")
            : t("sourceReturn.delta", { percent: percent(data.readPctDelta) })}
        </span>
        <span>{t("sourceReturn.unread", { count: data.stateCounts.unread })}</span>
        {data.stateCounts.read > 0 && (
          <span>{t("sourceReturn.readUnresolved", { count: data.stateCounts.read })}</span>
        )}
        <span>{t("sourceReturn.deferred", { count: data.stateCounts.needs_later })}</span>
        <span>{t("sourceReturn.stale", { count: data.stateCounts.stale_after_edit })}</span>
        {data.needsReverifyOutputs > 0 && (
          <span>{t("sourceReturn.reverify", { count: data.needsReverifyOutputs })}</span>
        )}
      </div>
      <div className="source-return__facts">
        <span>{t("sourceReturn.cards", { count: data.cards.count })}</span>
        <span>{t("sourceReturn.mature", { count: data.cards.mature })}</span>
        <span>{t("sourceReturn.leeches", { count: data.cards.leeches })}</span>
        <span>
          {data.cards.retention === null
            ? t("sourceReturn.unknownRetention", { days: data.cards.windowDays })
            : t("sourceReturn.retention", {
                percent: percent(data.cards.retention),
                count: data.cards.reviewCount,
                days: data.cards.windowDays,
              })}
        </span>
        {data.strugglingGroups.count > 0 && (
          <span>
            {t("sourceReturn.groups", {
              count: data.strugglingGroups.count,
              days: data.strugglingGroups.windowDays,
            })}
          </span>
        )}
      </div>
      <div className="source-return__actions">
        <span
          className="source-return__extract"
          title={
            data.lastExtraction?.at
              ? format.date(data.lastExtraction.at, { dateStyle: "medium", timeStyle: "short" })
              : undefined
          }
        >
          {data.lastExtraction
            ? t("sourceReturn.lastExtract", {
                label: data.lastExtraction.label ?? t("sourceReturn.extractPosition"),
              })
            : t("sourceReturn.noExtract")}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!canJump || !data.nextUnresolvedBlockId}
          onClick={() => data.nextUnresolvedBlockId && onJump(data.nextUnresolvedBlockId)}
        >
          <Icon name="arrowDown" size={13} />
          {t("sourceReturn.next")}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!canJump || !data.firstDeferredBlockId}
          onClick={() => data.firstDeferredBlockId && onJump(data.firstDeferredBlockId)}
        >
          <Icon name="postpone" size={13} />
          {t("sourceReturn.firstDeferred")}
        </button>
        {onOpenPending && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenPending}>
            <Icon name="queue" size={13} />
            {t("sourceReturn.pendingTitle")}
          </button>
        )}
      </div>
    </section>
  );
}
