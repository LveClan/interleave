import { forwardRef } from "react";
import { Icon } from "../components/Icon";
import { t } from "../i18n";
import type { PriorityIntegrityGetResult } from "../lib/appApi";

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatDays(value: number): string {
  return value === 0 ? "0d" : `${Number.isInteger(value) ? value : value.toFixed(1)}d`;
}

function formatRate(value: number | null): string {
  if (value === null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatDate(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

function originLabel(origin: PriorityIntegrityGetResult["sacrificed"][number]["postponeOrigin"]) {
  switch (origin) {
    case "standingAutoPostpone":
      return "standing auto";
    case "manualAutoPostpone":
      return "manual auto";
    case "catchUp":
      return "catch-up";
    case "vacation":
      return "vacation";
    case "recovery":
      return "recovery";
    case "manualQueueAction":
      return "manual";
    default:
      return "unknown";
  }
}

function activeFlagLabels(data: PriorityIntegrityGetResult): readonly string[] {
  const labels: string[] = [];
  if (data.thresholdFlags.aBandInflation) labels.push("A-band share is high");
  if (data.thresholdFlags.aBandDeferredRecently) labels.push("A-band work was deferred");
  if (data.thresholdFlags.postponeDebtHigh) labels.push("Postpone debt is high");
  return labels;
}

export interface PriorityIntegrityPanelProps {
  readonly data: PriorityIntegrityGetResult | null;
  readonly error: string | null;
}

export const PriorityIntegrityPanel = forwardRef<HTMLElement, PriorityIntegrityPanelProps>(
  function PriorityIntegrityPanel({ data, error }, ref) {
    const flags = data ? activeFlagLabels(data) : [];
    const resting = data?.resting ?? [];

    return (
      <section
        className="an-panel an-priority"
        data-testid="priority-integrity"
        id="priority-integrity"
        ref={ref}
        tabIndex={-1}
      >
        <div className="an-panel__head">
          <span className="an-panel__title">{t("collection.m6e18e420458f")}</span>
          <span className="an-panel__meta">
            {data?.windowDays ?? 30}
            {t("collection.mb1c503166f16")}
          </span>
        </div>

        {error ? (
          <p className="an-priority__error" data-testid="priority-integrity-error">
            {error}
          </p>
        ) : null}

        {data ? (
          <div className="an-priority__body">
            <div className="an-priority__flags" data-testid="priority-integrity-flags">
              {flags.length > 0 ? (
                flags.map((flag) => (
                  <span key={flag} className="an-priority__flag">
                    <Icon name="warning" size={13} />
                    {flag}
                  </span>
                ))
              ) : (
                <span className="an-priority__flag an-priority__flag--ok">
                  <Icon name="checkCircle" size={13} />
                  {t("collection.mb314fda52286")}
                </span>
              )}
            </div>

            <div className="an-priority__bands" data-testid="priority-integrity-bands">
              {data.bands.map((band) => (
                <div key={band.band} className="an-priority__band">
                  <span className={`an-priority__prio an-priority__prio--${band.band}`}>
                    {band.band}
                  </span>
                  <div>
                    <span className="an-priority__value">
                      {formatCount(band.attentionServiced)}
                    </span>
                    <span className="an-priority__label">{t("collection.me0787d272a43")}</span>
                  </div>
                  <div>
                    <span className="an-priority__value">{formatCount(band.fsrsServiced)}</span>
                    <span className="an-priority__label">{t("collection.me939a1a7c904")}</span>
                  </div>
                  <div>
                    <span className="an-priority__value">{formatCount(band.deferred)}</span>
                    <span className="an-priority__label">{t("collection.ma706016085b2")}</span>
                  </div>
                  <div>
                    <span className="an-priority__value">{formatDays(band.postponeDebtDays)}</span>
                    <span className="an-priority__label">{t("collection.m652d75f9bafb")}</span>
                  </div>
                  <div>
                    <span className="an-priority__value">{formatRate(band.liveShare)}</span>
                    <span className="an-priority__label">{t("collection.m8799d272ec11")}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="an-priority__columns">
              <div>
                <div className="an-priority__subhead">{t("collection.me2257158d10f")}</div>
                {data.topics.length > 0 ? (
                  <div className="an-priority__list" data-testid="priority-integrity-topics">
                    {data.topics.map((topic) => (
                      <div key={topic.anchorId} className="an-priority__row">
                        <div className="an-priority__row-title">
                          <span className={`an-priority__prio an-priority__prio--${topic.band}`}>
                            {topic.band}
                          </span>
                          <span>{topic.title}</span>
                        </div>
                        <span>
                          {formatCount(topic.deferred)}
                          {t("collection.m28f4c44228e1")} {formatDays(topic.postponeDebtDays)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="an-priority__empty">{t("collection.m4e29988086b0")}</p>
                )}
              </div>

              <div>
                <div className="an-priority__subhead">{t("collection.mc15564e54ebf")}</div>
                {data.sacrificed.length > 0 ? (
                  <div className="an-priority__list" data-testid="priority-integrity-sacrificed">
                    {data.sacrificed.map((row) => (
                      <div key={row.id} className="an-priority__row">
                        <div className="an-priority__row-title">
                          <span className={`an-priority__prio an-priority__prio--${row.band}`}>
                            {row.band}
                          </span>
                          <span>{row.title}</span>
                        </div>
                        <span>
                          {row.postponeCount}x · {formatDays(row.postponeDebtDays)} ·{" "}
                          {row.scheduler} · {originLabel(row.postponeOrigin)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="an-priority__empty">{t("collection.m2ebdae8b57f4")}</p>
                )}
              </div>

              <div>
                <div className="an-priority__subhead">{t("collection.m9b2f47152d9d")}</div>
                {resting.length > 0 ? (
                  <div className="an-priority__list" data-testid="priority-integrity-resting">
                    {resting.map((topic) => (
                      <div key={topic.topicId} className="an-priority__row">
                        <div className="an-priority__row-title">
                          <span className={`an-priority__prio an-priority__prio--${topic.band}`}>
                            {topic.band}
                          </span>
                          <span>{topic.title}</span>
                        </div>
                        <span>
                          {t("collection.m5c260b945d5d")}
                          {formatDate(topic.fallowUntil)} ·{" "}
                          {topic.fallowReason || t("collection.m41e2687b3a09")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="an-priority__empty">{t("collection.mf154ad61770e")}</p>
                )}
              </div>
            </div>
          </div>
        ) : error ? null : (
          <p className="an-loading">{t("collection.m370d950e0a59")}</p>
        )}
      </section>
    );
  },
);
