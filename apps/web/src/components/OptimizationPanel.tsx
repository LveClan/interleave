import { format, t, useLocale } from "../i18n";
/**
 * OptimizationPanel (T080) — the on-device FSRS parameter-optimization affordance.
 *
 * "Estimate FSRS parameters from your review history": a Run button fits a better
 * GLOBAL parameter set from `review_logs` (read-only), then shows the calibration
 * improvement + a workload-impact preview (before/after daily due sparkline +
 * "≈ +M cards/day for 30 days") with explicit Apply / Dismiss buttons. The copy says
 * "estimated from your history", NEVER "optimal" — ts-fsrs has no trainer; this is an
 * honest history-calibration estimate.
 *
 * The renderer NEVER computes params or runs the fit — it calls the typed
 * `optimization.suggest` / `optimization.apply` IPC and renders the result. Card-only
 * (FSRS); applying writes the queryable preset and changes only FUTURE scheduling.
 */

import { useCallback, useState } from "react";
import {
  appApi,
  type OptimizationSuggestResult,
  type OptimizationWorkloadDay,
} from "../lib/appApi";
import { Icon } from "./Icon";

/** A tiny inline before/after due sparkline (no chart lib — pure SVG bars). */
function WorkloadSpark({
  before,
  after,
}: {
  before: readonly OptimizationWorkloadDay[];
  after: readonly OptimizationWorkloadDay[];
}) {
  const days = Math.min(before.length, after.length);
  const peak = Math.max(
    1,
    ...before.slice(0, days).map((d) => d.count),
    ...after.slice(0, days).map((d) => d.count),
  );
  const width = 220;
  const height = 44;
  const barW = days > 0 ? width / days : width;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={t("optimization.projectedDailyDueLoadBeforeAndAfter")}
      data-testid="optimization-workload-spark"
      className="overflow-visible"
    >
      <title>{t("optimization.projectedDailyDueLoadBeforeAndAfter")}</title>
      {Array.from({ length: days }).map((_, i) => {
        const b = before[i]?.count ?? 0;
        const a = after[i]?.count ?? 0;
        const bh = (b / peak) * (height - 2);
        const ah = (a / peak) * (height - 2);
        const x = i * barW;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length ordered day series
          <g key={i}>
            <rect
              x={x + 0.5}
              y={height - bh}
              width={Math.max(0.5, barW / 2 - 0.5)}
              height={bh}
              fill="var(--text-3)"
              opacity={0.5}
            />
            <rect
              x={x + barW / 2 + 0.5}
              y={height - ah}
              width={Math.max(0.5, barW / 2 - 0.5)}
              height={ah}
              fill="var(--accent)"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** A formatted signed delta ("+12" / "−4" / "0"). */
function signed(n: number): string {
  return format.number(n, { signDisplay: "exceptZero" });
}

export function OptimizationPanel() {
  useLocale();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationSuggestResult | null>(null);
  const [applied, setApplied] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setApplied(false);
    setResult(null);
    try {
      const suggestion = await appApi.suggestOptimization({ scope: { scope: "global" } });
      setResult(suggestion);
    } catch (err) {
      console.error("[optimization] estimation failed", err);
      setError(t("optimization.estimationFailed"));
    } finally {
      setRunning(false);
    }
  }, []);

  const apply = useCallback(async () => {
    if (!result) return;
    setRunning(true);
    setError(null);
    try {
      await appApi.applyOptimization({
        scope: { scope: "global" },
        params: [...result.params],
      });
      setApplied(true);
      setResult(null);
    } catch (err) {
      console.error("[optimization] apply failed", err);
      setError(t("optimization.applyFailed"));
    } finally {
      setRunning(false);
    }
  }, [result]);

  const dismiss = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return (
    <section
      className="mb-6"
      data-testid="optimization-panel"
      aria-labelledby="optimization-panel-title"
    >
      <div
        id="optimization-panel-title"
        className="mb-1.5 font-medium text-text-2 text-xs uppercase tracking-wide"
      >
        {t("optimization.fsrsOptimization")}
      </div>
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-base text-text">
              {t("optimization.estimateFSRSParametersFromYourReviewHistory")}
            </div>
            <div className="mt-0.5 text-sm text-text-3">
              {t("optimization.fitsYourSchedulerToHowYouActually")}
            </div>
          </div>
          <button
            type="button"
            data-testid="optimization-run"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex flex-none items-center gap-1.5 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm hover:brightness-105 disabled:opacity-50"
          >
            <Icon name={running ? "review" : "sparkle"} size={14} />
            {running ? t("optimization.estimating") : t("optimization.run")}
          </button>
        </div>

        {applied ? (
          <div
            data-testid="optimization-applied"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2.5 py-1 text-ok text-xs"
          >
            <Icon name="check" size={13} />
            {t("optimization.appliedFutureReviewsUseTheNewParameters")}
          </div>
        ) : null}

        {error ? (
          <div
            data-testid="optimization-error"
            className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-danger text-sm"
          >
            {error}
          </div>
        ) : null}

        {result && !result.sufficientData ? (
          <div
            data-testid="optimization-insufficient"
            className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-2"
          >
            {t("optimization.notEnoughReviewHistoryYetToEstimate")}
          </div>
        ) : null}

        {result?.sufficientData ? (
          <div
            data-testid="optimization-result"
            className="mt-3 rounded-md border border-border bg-surface px-3.5 py-3"
          >
            <div className="text-sm text-text-2">
              {t("optimization.calibration", {
                before: format.number(result.baseline.logLoss, {
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
                }),
                after: format.number(result.suggested.logLoss, {
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
                }),
                count: result.reviewsScored,
              })}
            </div>

            <div className="mt-3 flex items-end gap-4">
              <WorkloadSpark before={result.workload.before} after={result.workload.after} />
              <div className="text-sm text-text-2">
                <div data-testid="optimization-delta-7">
                  {t("optimization.delta", {
                    days: 7,
                    delta: signed(result.workload.deltaDueNext7),
                  })}
                </div>
                <div data-testid="optimization-delta-30">
                  {t("optimization.delta", {
                    days: 30,
                    delta: signed(result.workload.deltaDueNext30),
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="optimization-apply"
                onClick={() => void apply()}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm hover:brightness-105 disabled:opacity-50"
              >
                <Icon name="check" size={14} />
                {t("optimization.apply")}
              </button>
              <button
                type="button"
                data-testid="optimization-dismiss"
                onClick={dismiss}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-2 hover:text-text disabled:opacity-50"
              >
                {t("optimization.dismiss")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
