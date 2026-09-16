import type { CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { i18n, t, useLocale } from "../i18n";
import type { AnalyticsReviewActivityDay, AnalyticsReviewActivityResult } from "../lib/appApi";

export type ReviewActivityResult = AnalyticsReviewActivityResult;

interface ReviewActivityHeatmapProps {
  readonly activity: ReviewActivityResult | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onYearSelect: (year: number) => void;
}

type HeatmapCell = AnalyticsReviewActivityDay | null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = [
  { key: "sun", label: "" },
  {
    key: "mon",
    get label() {
      return t("options.mf40d7f51f69e");
    },
  },
  { key: "tue", label: "" },
  {
    key: "wed",
    get label() {
      return t("options.m58339f45df96");
    },
  },
  { key: "thu", label: "" },
  {
    key: "fri",
    get label() {
      return t("options.m66dab40cea1d");
    },
  },
  { key: "sat", label: "" },
];

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function parseLocalDate(date: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const [yearPart, monthPart, dayPart] = date.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart) - 1;
  const day = Number(dayPart);
  return {
    year,
    month,
    day,
    weekday: new Date(year, month, day).getDay(),
  };
}

function buildWeeks(days: readonly AnalyticsReviewActivityDay[]): HeatmapCell[][] {
  if (days.length === 0) return [];

  const weeks: HeatmapCell[][] = [];
  let week: HeatmapCell[] = Array.from({ length: 7 }, () => null);

  days.forEach((day, index) => {
    const weekday = parseLocalDate(day.date).weekday;
    if (index > 0 && weekday === 0) {
      weeks.push(week);
      week = Array.from({ length: 7 }, () => null);
    }
    week[weekday] = day;
  });

  weeks.push(week);
  return weeks;
}

function buildMonthLabels(weeks: readonly HeatmapCell[][]): Array<{ key: string; label: string }> {
  const seen = new Set<number>();

  return weeks.map((week) => {
    const firstDayInWeek = week.find((day) => day !== null);
    const firstDayOfMonth = week.find((day) => {
      if (!day) return false;
      const parts = parseLocalDate(day.date);
      return parts.day <= 7 && !seen.has(parts.month);
    });

    if (!firstDayOfMonth) {
      return { key: firstDayInWeek?.date ?? "empty-week", label: "" };
    }
    const month = parseLocalDate(firstDayOfMonth.date).month;
    seen.add(month);
    return { key: firstDayInWeek?.date ?? firstDayOfMonth.date, label: MONTHS[month] ?? "" };
  });
}

function formatCellLabel(day: AnalyticsReviewActivityDay): string {
  const parts = parseLocalDate(day.date);
  const monthName = MONTHS_LONG[parts.month] ?? "";
  const dateLabel = `${monthName} ${parts.day}, ${parts.year}`;
  if (day.count === 0) return `${dateLabel}: no reviews`;
  return `${dateLabel}: ${formatCount(day.count)} review${i18n.language.startsWith("zh") ? "" : day.count === 1 ? "" : "s"}`;
}

function intensityClass(count: number): string {
  if (count <= 0) return "an-heatmap__cell--i0";
  if (count === 1) return "an-heatmap__cell--i1";
  if (count <= 3) return "an-heatmap__cell--i2";
  if (count <= 7) return "an-heatmap__cell--i3";
  return "an-heatmap__cell--i4";
}

function buildRenderedCells(weeks: readonly HeatmapCell[][]): Array<{
  key: string;
  day: AnalyticsReviewActivityDay | null;
}> {
  return weeks.flatMap((week) => {
    const firstDayInWeek = week.find((day) => day !== null);
    const weekKey = firstDayInWeek?.date ?? "empty-week";
    return WEEKDAYS.map((weekday, weekdayIndex) => ({
      key: week[weekdayIndex]?.date ?? `${weekKey}-${weekday.key}`,
      day: week[weekdayIndex] ?? null,
    }));
  });
}

export function ReviewActivityHeatmap({
  activity,
  loading,
  error,
  onYearSelect,
}: ReviewActivityHeatmapProps) {
  useLocale();
  const weeks = activity ? buildWeeks(activity.days) : [];
  const monthLabels = buildMonthLabels(weeks);
  const renderedCells = buildRenderedCells(weeks);
  const total = activity?.totalReviews ?? 0;
  const previousYear = activity?.previousYear ?? null;
  const nextYear = activity?.nextYear ?? null;
  const hasActivity = activity !== null;
  const gridStyle = {
    gridTemplateColumns: `repeat(${Math.max(weeks.length, 1)}, var(--an-heat-cell))`,
  } satisfies CSSProperties;

  return (
    <div className="an-panel an-heatmap" data-testid="review-activity-panel">
      <div className="an-panel__head an-heatmap__head">
        <span className="an-panel__title">{t("collection.mb9eba7e63524")}</span>
        <div className="an-heatmap__head-actions">
          <span className="an-panel__meta" data-testid="review-activity-meta">
            {hasActivity
              ? t("collection.m163a14b5032f", {
                  value1: String(activity.year),
                  value2: String(formatCount(total)),
                  value3: String(i18n.language.startsWith("zh") ? "" : total === 1 ? "" : "s"),
                })
              : loading
                ? t("collection.mdc380888c4e2")
                : t("collection.m0cf9505f9f97")}
          </span>
          <nav className="an-heatmap__nav" aria-label={t("collection.mbe50b30ff62e")}>
            <button
              type="button"
              className="an-heatmap__nav-button"
              disabled={previousYear === null}
              aria-label={
                previousYear === null
                  ? t("collection.m6f7a20d28348")
                  : t("collection.m00b083fbef21", { value1: String(previousYear) })
              }
              title={
                previousYear === null
                  ? t("collection.m6f7a20d28348")
                  : t("collection.m00b083fbef21", { value1: String(previousYear) })
              }
              onClick={() => {
                if (previousYear !== null) onYearSelect(previousYear);
              }}
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              type="button"
              className="an-heatmap__nav-button"
              disabled={nextYear === null}
              aria-label={
                nextYear === null
                  ? t("collection.m02dbf0febae8")
                  : t("collection.m00b083fbef21", { value1: String(nextYear) })
              }
              title={
                nextYear === null
                  ? t("collection.m02dbf0febae8")
                  : t("collection.m00b083fbef21", { value1: String(nextYear) })
              }
              onClick={() => {
                if (nextYear !== null) onYearSelect(nextYear);
              }}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </nav>
        </div>
      </div>

      {error ? (
        <p className="an-heatmap__error" data-testid="review-activity-error">
          {error}
        </p>
      ) : null}

      {loading && !activity ? (
        <p className="an-heatmap__status" data-testid="review-activity-loading">
          {t("collection.m5bbbfa88d5b9")}
        </p>
      ) : null}

      {activity ? (
        <>
          <div className="an-heatmap__scroller">
            <div className="an-heatmap__months" style={gridStyle} aria-hidden="true">
              {monthLabels.map(({ key, label }) => (
                <span key={`month-${key}`} className="an-heatmap__month">
                  {label}
                </span>
              ))}
            </div>
            <div className="an-heatmap__grid-wrap">
              <div className="an-heatmap__weekdays" aria-hidden="true">
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday.key} className="an-heatmap__weekday">
                    {weekday.label}
                  </span>
                ))}
              </div>
              <ol
                className="an-heatmap__grid"
                style={gridStyle}
                aria-label={t("collection.mb21c0d9ed8bd", { value1: String(activity.year) })}
                data-testid="review-activity-grid"
              >
                {renderedCells.map(({ key, day }) =>
                  day ? (
                    <li
                      key={key}
                      className={`an-heatmap__cell ${intensityClass(day.count)}`}
                      title={formatCellLabel(day)}
                      aria-label={formatCellLabel(day)}
                      data-date={day.date}
                      data-count={day.count}
                      data-testid="review-activity-cell"
                    />
                  ) : (
                    <li
                      key={key}
                      className="an-heatmap__cell an-heatmap__cell--blank"
                      aria-hidden="true"
                    />
                  ),
                )}
              </ol>
            </div>
          </div>

          {total === 0 ? (
            <p className="an-heatmap__status" data-testid="review-activity-empty">
              {t("collection.m7d01c514fafe")}
              {activity.year}.
            </p>
          ) : null}
          <div className="an-heatmap__footer" aria-hidden="true">
            <span>{t("collection.mae5239ec63f2")}</span>
            <span className="an-heatmap__cell an-heatmap__cell--i0" />
            <span className="an-heatmap__cell an-heatmap__cell--i1" />
            <span className="an-heatmap__cell an-heatmap__cell--i2" />
            <span className="an-heatmap__cell an-heatmap__cell--i3" />
            <span className="an-heatmap__cell an-heatmap__cell--i4" />
            <span>{t("collection.md47d7cb0e4f8")}</span>
          </div>
          {loading ? (
            <p className="an-heatmap__status" data-testid="review-activity-updating">
              {t("collection.m8d6704bde332")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
