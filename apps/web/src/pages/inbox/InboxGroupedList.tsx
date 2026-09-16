import { t, useLocale } from "../../i18n";
/**
 * Inbox grouped left list (T126 — U5).
 *
 * The morning-triage view groups the inbox by WHERE material came from. This
 * component renders the group-by selector (a segmented chip control: Origin /
 * Domain / Type), then the list bucketed into group sections — each with a divider
 * header (label + count badge + "Select group"), and rows that carry both the
 * roving-cursor focus ring and the multi-select accent fill.
 *
 * Pure presentation + a pure renderer transform: grouping is computed from the
 * backend-derived `origin` / `domain` / `srcType` fields on each row (never
 * re-derived predicates), with a stable "Other" bucket for a `null` origin/domain
 * so a row is NEVER dropped. Switching the axis is an instant local transform — no
 * fetch — and the parent keeps the selected id set across the switch.
 *
 * Design (from the U5 pinned decisions; tokens only, no hard-coded color/spacing):
 *  - Selected rows get the existing active-row accent fill (`--accent-soft` /
 *    `--accent-soft-bd`); the roving cursor row gets a DISTINCT outline ring
 *    (`--border-strong`) so "in the set" and "cursor here" are separable.
 *  - Group header: label (`text-text-3 text-xs uppercase`), a `badge badge--soft`
 *    count, and a `btn--ghost btn--sm`-equivalent "Select group" control.
 */

import { capturedViaLabel } from "@interleave/core";
import { Prio, TypeIcon } from "../../components/inspector/primitives";
import type { InboxItemSummary, TriageSuggestionDto } from "../../lib/appApi";
import { formatTriageJustification, SuggestionChip, SuggestionPending } from "./SuggestionChip";

/**
 * The per-row suggestion state (T127 — U6):
 *  - a `TriageSuggestionDto` verdict (a banded `suggestion` → chip + justification;
 *    an `insufficient_signal` → render nothing),
 *  - `"pending"` while the batch fetch is in flight (render the neutral placeholder
 *    so "computing" ≠ the permanent `insufficient_signal` blank),
 *  - `null` when no suggestion fetch is wired at all (render nothing — the prior
 *    list behavior, e.g. in tests that do not mock the suggest channel).
 */
export type InboxRowSuggestion = TriageSuggestionDto | "pending" | null;

/**
 * Resolve a row's suggestion state from the per-id map. No map ⇒ `null` (no fetch
 * wired). A map missing this id ⇒ `"pending"` (still computing). Otherwise the
 * stored verdict.
 */
function rowSuggestion(
  suggestions: ReadonlyMap<string, InboxRowSuggestion> | undefined,
  id: string,
): InboxRowSuggestion {
  if (!suggestions) return null;
  if (!suggestions.has(id)) return "pending";
  return suggestions.get(id) ?? "pending";
}

/** The three group-by axes (R2). */
export type InboxGroupBy = "origin" | "domain" | "type";

export const INBOX_GROUP_BY_OPTIONS: readonly { id: InboxGroupBy; label: string }[] = [
  {
    id: "origin",
    get label() {
      return t("options.md3e1c5f8a6e2");
    },
  },
  {
    id: "domain",
    get label() {
      return t("options.m79fa33618d8e");
    },
  },
  {
    id: "type",
    get label() {
      return t("options.mbaaddf70fb5d");
    },
  },
];

/** The stable bucket key that absorbs a null origin/domain (never drops a row). */
const OTHER_KEY = " other";

/** One rendered group: a stable key, its header label, and the rows under it. */
export interface InboxGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly InboxItemSummary[];
}

function formatCharCount(charCount: number): string {
  if (charCount < 1000) return `${charCount} ch`;
  const compact = Math.round((charCount / 1000) * 10) / 10;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k ch`;
}

/**
 * Bucket the inbox rows by the chosen axis into ordered groups. Order is
 * first-appearance (stable with the newest-first list), with the "Other" bucket
 * last so the explicit unknown reads calmly at the bottom. Grouping reads only the
 * backend-derived fields — a `null` origin/domain lands in "Other".
 */
export function groupInboxItems(
  items: readonly InboxItemSummary[],
  groupBy: InboxGroupBy,
): readonly InboxGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, { label: string; items: InboxItemSummary[] }>();
  for (const item of items) {
    let key: string;
    let label: string;
    if (groupBy === "origin") {
      key = item.origin ?? OTHER_KEY;
      label = capturedViaLabel(item.origin);
    } else if (groupBy === "domain") {
      key = item.domain ?? OTHER_KEY;
      label = item.domain ?? "Other";
    } else {
      // Type: the existing source-type label (always present).
      key = item.srcType;
      label = item.srcType;
    }
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { label, items: [] };
      byKey.set(key, bucket);
      order.push(key);
    }
    bucket.items.push(item);
  }
  order.sort((a, b) => {
    if (a === OTHER_KEY) return 1;
    if (b === OTHER_KEY) return -1;
    return 0;
  });
  return order.map((key) => {
    const bucket = byKey.get(key);
    if (!bucket) throw new Error(`missing inbox group bucket: ${key}`);
    return { key, label: bucket.label, items: bucket.items };
  });
}

/** A single grouped left-list row — carries cursor focus + multi-select fill. */
function GroupedRow({
  item,
  selected,
  cursor,
  suggestion,
  onSelect,
}: {
  item: InboxItemSummary;
  selected: boolean;
  cursor: boolean;
  /** The row's triage suggestion: a verdict, or `undefined` while still computing. */
  suggestion: InboxRowSuggestion;
  onSelect: (id: string, modifiers: { shift: boolean; toggle: boolean }) => void;
}) {
  useLocale();
  // A single 1px border carries both cues — no stacked ring — so the row's edge
  // matches the queue's active-row treatment (one thin edge, never a doubled
  // border+ring). Selection (in the set) wins the border color + soft fill; the
  // roving keyboard cursor takes a stronger border on rows that aren't already
  // selected. `focus:outline-none` drops the native (OS-accent) focus ring the
  // rest of the app already replaces; keyboard focus reuses the same thin border.
  const base =
    "flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-3.5 py-3 text-left focus:outline-none focus-visible:border-border-strong";
  const fill = selected ? "bg-accent-soft" : "hover:bg-surface-2";
  const border = selected
    ? "border-accent-soft-bd"
    : cursor
      ? "border-border-strong"
      : "border-transparent";
  // A banded suggestion drives the row chip + justification line; an
  // `insufficient_signal` verdict renders nothing; `"pending"` is "still computing";
  // `null` is "no fetch wired" (nothing).
  const banded =
    typeof suggestion === "object" && suggestion?.kind === "suggestion" ? suggestion : null;
  const pending = suggestion === "pending";
  const justification = banded ? formatTriageJustification(banded.justification) : "";
  return (
    <button
      type="button"
      data-testid="inbox-row"
      data-element-id={item.id}
      data-selected={selected ? "true" : undefined}
      data-cursor={cursor ? "true" : undefined}
      aria-current={cursor ? "true" : undefined}
      aria-pressed={selected}
      onClick={(e) => onSelect(item.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      className={`${base} ${fill} ${border}`}
    >
      <TypeIcon type={item.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm text-text">{item.title}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-text-3 text-xs">
          <span className="max-w-[calc(var(--s-12)+var(--s-10))] shrink-0 truncate whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 text-2xs">
            {item.srcType}
          </span>
          {item.author ? (
            <>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <span className="min-w-0 flex-1 truncate whitespace-nowrap">{item.author}</span>
            </>
          ) : null}
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <span className="shrink-0 whitespace-nowrap font-mono">
            {formatCharCount(item.charCount)}
          </span>
        </span>
        {/* Suggestion justification — one muted, truncated line; only when it cites
            something (an empty justification renders no line). */}
        {justification ? (
          <span
            className="mt-1 block truncate text-accent-text text-xs"
            data-testid="inbox-row-justification"
          >
            {justification}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Prio priority={item.priority} />
        {/* Suggested-band chip is DISPLAY-ONLY on the row (a row is a button — accept
            happens via Enter on the cursor row or the preview-pane affordance). */}
        {banded ? (
          <SuggestionChip band={banded.band} compact />
        ) : pending ? (
          <SuggestionPending />
        ) : null}
      </span>
    </button>
  );
}

/**
 * The grouped left list: the group-by selector + the bucketed sections. Selection
 * + cursor are owned by the parent; this component only renders state and forwards
 * intent (click modifiers, select-group, select-all).
 */
export function InboxGroupedList({
  groups,
  groupBy,
  onGroupByChange,
  selectedIds,
  cursorId,
  suggestions,
  totalCount,
  onSelectRow,
  onSelectGroup,
  onSelectAll,
}: {
  groups: readonly InboxGroup[];
  groupBy: InboxGroupBy;
  onGroupByChange: (next: InboxGroupBy) => void;
  selectedIds: ReadonlySet<string>;
  cursorId: string | null;
  /**
   * Per-id triage suggestions (T127 — U6). A present `undefined` entry / a missing
   * key both mean "still computing" (render the pending placeholder); an
   * `insufficient_signal` verdict renders nothing. Optional so callers without the
   * suggestion fetch wired (e.g. tests) keep the prior list behavior.
   */
  suggestions?: ReadonlyMap<string, InboxRowSuggestion>;
  totalCount: number;
  onSelectRow: (id: string, modifiers: { shift: boolean; toggle: boolean }) => void;
  onSelectGroup: (ids: readonly string[]) => void;
  onSelectAll: () => void;
}) {
  useLocale();
  return (
    <div
      className="flex w-[360px] flex-none flex-col overflow-hidden border-border border-r"
      data-testid="inbox-list"
    >
      {/* group-by selector (segmented chips) + select-all */}
      <div className="flex items-center justify-between gap-2 border-border border-b px-2 py-2">
        <fieldset
          className="flex gap-1.5 border-0 p-0"
          aria-label={t("collection.me663c59250d7")}
          data-testid="inbox-group-by"
        >
          {INBOX_GROUP_BY_OPTIONS.map((opt) => {
            const active = groupBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`inbox-group-by-${opt.id}`}
                aria-pressed={active}
                onClick={() => onGroupByChange(opt.id)}
                className={
                  active
                    ? "rounded-md border border-accent-soft-bd bg-accent-soft px-2.5 py-1 font-medium text-accent-text text-xs"
                    : "rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-text-2 text-xs hover:text-text"
                }
              >
                {opt.label}
              </button>
            );
          })}
        </fieldset>
        <button
          type="button"
          data-testid="inbox-select-all"
          onClick={onSelectAll}
          className="rounded-md border border-transparent px-2 py-1 font-medium text-accent-text text-xs hover:bg-surface-2"
        >
          {t("collection.m1fc9a387654d")}
          {totalCount > 0 ? ` (${totalCount})` : ""}
        </button>
      </div>

      {/* grouped sections */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {groups.map((group) => {
          const groupIds = group.items.map((it) => it.id);
          return (
            <section key={group.key} data-testid="inbox-group" data-group-key={group.key}>
              <header className="flex items-center gap-2 px-1.5 pt-2 pb-1">
                <span
                  className="text-text-3 text-xs uppercase tracking-wide"
                  data-testid="inbox-group-label"
                >
                  {group.label}
                </span>
                <span className="badge badge--soft" data-testid="inbox-group-count">
                  {group.items.length}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  data-testid="inbox-select-group"
                  onClick={() => onSelectGroup(groupIds)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent-text text-xs hover:bg-surface-2"
                >
                  {t("collection.mf704d2fee781")}
                </button>
              </header>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <GroupedRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    cursor={cursorId === item.id}
                    suggestion={rowSuggestion(suggestions, item.id)}
                    onSelect={onSelectRow}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
