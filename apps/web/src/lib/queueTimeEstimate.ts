import { t } from "../i18n";
import type { QueueTimeEstimate } from "./appApi";

export interface QueueTimeEstimateLabel {
  readonly text: string;
  readonly ariaLabel: string;
}

/**
 * Format a minute count for session/forecast surfaces, prefixing `~` when the figure
 * leans on documented default estimates rather than learned timings. Rounds to one
 * decimal for non-integers so small estimates stay honest. (Relocated from the deleted
 * `sessionAssemblyState` module — its natural home next to the queue time formatter.)
 * Plain helper code: it uses the shared instance's `t` directly (components subscribe
 * to language changes with `useLocale`).
 */
export function sessionMinuteLabel(minutes: number, approximate: boolean): string {
  const rounded = Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10;
  return approximate
    ? t("home.sessionMinuteApproximate", { count: rounded })
    : t("home.sessionMinuteExact", { count: rounded });
}

export function formatQueueTimeEstimate(
  estimate: QueueTimeEstimate | null | undefined,
): QueueTimeEstimateLabel | null {
  if (!estimate) return null;
  const rounded =
    estimate.pricedItemCount > 0 && estimate.totalMinutes > 0
      ? Math.max(1, Math.round(estimate.totalMinutes))
      : Math.max(0, Math.round(estimate.totalMinutes));
  if (estimate.confidence === "default") {
    return {
      text: t("home.queueTimeEstimateApproximate", { count: rounded }),
      ariaLabel: t("home.queueTimeEstimateAriaApproximate", { count: rounded }),
    };
  }
  return {
    text: t("home.queueTimeEstimateExact", { count: rounded }),
    ariaLabel: t("home.queueTimeEstimateAriaExact", { count: rounded }),
  };
}
