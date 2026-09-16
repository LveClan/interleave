/**
 * BudgetMeter (T029) — the daily-budget gauge for the Daily Queue.
 *
 * Ported from the design kit's `components.jsx` `BudgetMeter` for React 19, driven
 * entirely by the `.budget` tokens in `queue.css`. It shows estimated minutes vs the
 * configured daily budget (from `SettingsRepository`), splitting the bar
 * into a within-budget segment (accent) and, when over, an over-budget segment
 * (danger) + an "N min over budget" badge. The over-budget AUTO-POSTPONE action is M16
 * (T077/T078) — this only VISUALIZES the over-budget minutes; it never postpones.
 *
 * UI only — no domain logic, no data fetching. The values come from the typed
 * `window.appApi.queue.list` budget payload. All user-visible copy goes through the
 * shared `t`/`format` helpers, and `useLocale` re-renders the gauge when the display
 * language changes.
 */

import { format, t, useLocale } from "../../i18n";
import type { QueueQuotaComposition } from "../../lib/appApi";

/** The three budget-composition categories, in the order the kit shows them. */
type CompositionChipKind = "cards" | "distillation" | "other";

interface CompositionChip {
  readonly kind: CompositionChipKind;
  readonly minutes: number;
}

export function BudgetMeter({
  used,
  target,
  confidence = "learned",
  composition,
}: {
  used: number;
  target: number;
  confidence?: "learned" | "default";
  composition?: QueueQuotaComposition | undefined;
}) {
  useLocale();
  const over = Math.max(0, used - target);
  const within = Math.min(used, target);
  const denom = Math.max(target, used, 1);
  const approximate = confidence === "default";
  const usedLabel = format.number(Math.round(used));
  const targetLabel = format.number(Math.round(target));
  const overLabel = Math.max(0, Math.round(used) - Math.round(target));
  const compositionLabel = compositionText(composition);
  const splitLabel = compositionSplitLabel(composition);
  const ariaLabel = [
    approximate
      ? t("home.budgetMeterAriaUsageApproximate", { used: usedLabel, target: targetLabel })
      : t("home.budgetMeterAriaUsageExact", { used: usedLabel, target: targetLabel }),
    overLabel > 0 ? t("home.budgetMeterAriaOverBudget", { count: overLabel }) : null,
    compositionLabel,
    splitLabel,
  ]
    .filter(Boolean)
    .join(t("home.budgetMeterAriaSentenceSeparator"));
  return (
    <section className="budget" data-testid="budget-meter" aria-label={ariaLabel}>
      <div className="budget__head">
        <span className="budget__num">
          {approximate ? t("home.budgetMeterApproximatePrefix") : ""}
          {usedLabel} <span>{t("home.budgetMeterMinutesToday", { target: targetLabel })}</span>
        </span>
        {over > 0 && (
          <span className="badge badge--overdue" data-testid="budget-over">
            {t("home.budgetMeterOverBudget", { count: overLabel })}
          </span>
        )}
      </div>
      <div className="budget__bar">
        <span className="budget__used" style={{ width: `${(within / denom) * 100}%` }} />
        {over > 0 && (
          <span className="budget__over" style={{ width: `${(over / denom) * 100}%` }} />
        )}
      </div>
      <div className="budget__legend">
        <span>
          <i style={{ background: "var(--accent)" }} />
          {t("home.budgetMeterWithinBudget")}
        </span>
        {over > 0 && (
          <span>
            <i style={{ background: "var(--danger)" }} />
            {t("home.budgetMeterOverBudgetLegend")}
          </span>
        )}
      </div>
      {composition && composition.status !== "unavailable_no_time_estimate" ? (
        <div className="budget__composition" data-testid="budget-composition">
          <span>{compositionLabel}</span>
          <span className="budget__chips">
            {compositionChips(composition).map((chip) => (
              <span className="badge" key={chip.kind}>
                {chipText(chip)}
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function compositionText(composition: QueueQuotaComposition | undefined): string | null {
  if (!composition) return null;
  if (composition.status === "active") {
    return t("home.budgetMeterCompositionActive", { minutes: composition.quotaFloorMinutes });
  }
  if (composition.status === "returned_empty_backlog") {
    return t("home.budgetMeterCompositionReturned");
  }
  if (composition.status === "inactive_filtered_out") {
    return t("home.budgetMeterCompositionFiltered");
  }
  if (composition.status === "inactive_zero_target") return t("home.budgetMeterCompositionOff");
  return null;
}

function compositionChips(composition: QueueQuotaComposition): readonly CompositionChip[] {
  const chips: readonly CompositionChip[] = [
    { kind: "cards", minutes: Math.round(composition.cardMinutes) },
    { kind: "distillation", minutes: Math.round(composition.distillationMinutes) },
    { kind: "other", minutes: Math.round(composition.otherMinutes) },
  ];
  const visible = chips.filter((chip) => chip.minutes > 0);
  return visible.length > 0 ? visible : chips;
}

function chipText(chip: CompositionChip): string {
  switch (chip.kind) {
    case "cards":
      return t("home.budgetMeterChipCards", { minutes: chip.minutes });
    case "distillation":
      return t("home.budgetMeterChipDistillation", { minutes: chip.minutes });
    case "other":
      return t("home.budgetMeterChipOther", { minutes: chip.minutes });
  }
}

function chipAriaText(chip: CompositionChip): string {
  switch (chip.kind) {
    case "cards":
      return t("home.budgetMeterAriaChipCards", { count: chip.minutes });
    case "distillation":
      return t("home.budgetMeterAriaChipDistillation", { count: chip.minutes });
    case "other":
      return t("home.budgetMeterAriaChipOther", { count: chip.minutes });
  }
}

function compositionSplitLabel(composition: QueueQuotaComposition | undefined): string | null {
  if (!composition || composition.status === "unavailable_no_time_estimate") return null;
  return compositionChips(composition).map(chipAriaText).join(t("home.budgetMeterChipSeparator"));
}
