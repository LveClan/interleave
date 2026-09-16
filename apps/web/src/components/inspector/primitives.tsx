import { t, useLocale } from "../../i18n";
/**
 * Inspector design primitives (T010).
 *
 * Rebuilt from the kit's `components.jsx` (`TypeIcon`, `Prio`, `Status`, `Stage`,
 * `SchedulerChip`, `FsrsStats`, `MetaRow`, `Tag`) for React 19 + Tailwind v4,
 * driven entirely by the design tokens via the kit class names (defined in
 * `inspector.css`). They translate the canonical `@interleave/core` enum values
 * (`raw_extract`, `mature_card`, …) into the kit's human display labels and the
 * priority A/B/C/D bands, so the inspector renders type-appropriate metadata and
 * the load-bearing FSRS-vs-attention scheduler split exactly like the prototype.
 *
 * UI only — no domain logic, no data fetching. The values come from the typed
 * `window.appApi` inspector payload.
 */

import type { SchedulerSignals } from "../../lib/appApi";
import { formatDifficulty, formatStability } from "../../lib/formatFsrs";
import { Icon, type IconName } from "../Icon";

/** Canonical element-type → kit type-icon name + tone class suffix. */
const TYPE_ICON: Record<string, { icon: IconName; tone: string; label: string }> = {
  source: {
    icon: "source",
    tone: "source",
    get label() {
      return t("options.m0e570ca6fabe");
    },
  },
  topic: {
    icon: "topic",
    tone: "topic",
    get label() {
      return t("options.m7e61847d61d6");
    },
  },
  extract: {
    icon: "extract",
    tone: "extract",
    get label() {
      return t("options.mc15301c0e647");
    },
  },
  card: {
    icon: "card",
    tone: "card",
    get label() {
      return t("options.mbe3702e3f1af");
    },
  },
  task: {
    icon: "task",
    tone: "task",
    get label() {
      return t("options.m4bc74b21357c");
    },
  },
  concept: {
    icon: "concept",
    tone: "concept",
    get label() {
      return t("options.m54287be80625");
    },
  },
  media_fragment: {
    icon: "media",
    tone: "media",
    get label() {
      return t("options.m8fd210793181");
    },
  },
  synthesis_note: {
    icon: "synthesis",
    tone: "synthesis",
    get label() {
      return t("options.m320884ef56cd");
    },
  },
};

/** Human label for a canonical element type. */
export function typeLabel(type: string): string {
  return TYPE_ICON[type]?.label ?? type;
}

/** Element-type chip (8 types), colored by `--el-*` token. */
export function TypeIcon({ type, lg }: { type: string; lg?: boolean }) {
  useLocale();
  const entry = TYPE_ICON[type] ?? TYPE_ICON.source;
  return (
    <span className={`tico tico--${entry?.tone}${lg ? " tico--lg" : ""}`}>
      <Icon name={entry?.icon ?? "source"} size={lg ? 17 : 14} />
    </span>
  );
}

/** Numeric priority `0.0`–`1.0` → coarse A/B/C/D label (mirrors core/priority). */
export function priorityLabel(priority: number): "A" | "B" | "C" | "D" {
  const v = Math.min(1, Math.max(0, priority));
  if (v >= 0.75) return "A";
  if (v >= 0.5) return "B";
  if (v >= 0.25) return "C";
  return "D";
}

/** Priority A/B/C/D badge. */
export function Prio({ priority }: { priority: number }) {
  useLocale();
  const label = priorityLabel(priority);
  return <span className={`badge prio prio--${label.toLowerCase()}`}>{label}</span>;
}

/** Lifecycle status → kit badge variant + display label. */
const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  inbox: {
    cls: "badge--new",
    get label() {
      return t("options.m94835ea2fcf7");
    },
  },
  pending: {
    cls: "badge--soft",
    get label() {
      return t("options.m331551b0de41");
    },
  },
  active: {
    cls: "badge--due",
    get label() {
      return t("options.m92340695899b");
    },
  },
  scheduled: {
    cls: "badge--soft",
    get label() {
      return t("options.m4724f344c1c0");
    },
  },
  done: {
    cls: "badge--done",
    get label() {
      return t("options.m11a6767d5674");
    },
  },
  parked: {
    cls: "badge--parked",
    get label() {
      return t("options.mf32a2c334c3b");
    },
  },
  dismissed: {
    cls: "badge--dismissed",
    get label() {
      return t("options.m9d74727714db");
    },
  },
  suspended: {
    cls: "badge--suspended",
    get label() {
      return t("options.me392a3891c07");
    },
  },
  deleted: {
    cls: "badge--trashed",
    get label() {
      return t("options.m4ec0b99444af");
    },
  },
};

/** Status badge. */
export function Status({ status }: { status: string }) {
  useLocale();
  const entry = STATUS_BADGE[status] ?? { cls: "badge--soft", label: status };
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>;
}

/** Human label for a canonical lifecycle status. */
export function statusLabel(status: string): string {
  return STATUS_BADGE[status]?.label ?? status;
}

/** Canonical distillation stage → kit display label + dot color token. */
const STAGE_META: Record<string, { label: string; dot: string }> = {
  raw_source: {
    get label() {
      return t("options.m463816d07097");
    },
    dot: "var(--el-source)",
  },
  rough_topic: {
    get label() {
      return t("options.m7e61847d61d6");
    },
    dot: "var(--el-topic)",
  },
  raw_extract: {
    get label() {
      return t("options.m896feb478608");
    },
    dot: "var(--text-3)",
  },
  clean_extract: {
    get label() {
      return t("options.m23d32889d303");
    },
    dot: "var(--el-extract)",
  },
  atomic_statement: {
    get label() {
      return t("options.m345a3181eedb");
    },
    dot: "var(--accent)",
  },
  card_draft: {
    get label() {
      return t("options.m5fd7831e65f2");
    },
    dot: "var(--el-card)",
  },
  active_card: {
    get label() {
      return t("options.m957ecf461c8b");
    },
    dot: "var(--el-card)",
  },
  mature_card: {
    get label() {
      return t("options.m2fca7a22025e");
    },
    dot: "var(--ok)",
  },
  synthesis: {
    get label() {
      return t("options.m7de5a138fd9b");
    },
    dot: "var(--el-synthesis)",
  },
};

/** Human label for a canonical distillation stage. */
export function stageLabel(stage: string): string {
  return STAGE_META[stage]?.label ?? stage;
}

/** Stage badge with a colored dot. */
export function Stage({ stage }: { stage: string }) {
  useLocale();
  const entry = STAGE_META[stage] ?? { label: stage, dot: "var(--text-3)" };
  return (
    <span className="stage">
      <span className="stage-dot" style={{ background: entry.dot }} />
      {entry.label}
    </span>
  );
}

/** Retrievability → color token (matches the kit's `retrColor`). */
function retrColor(r: number): string {
  return r >= 0.85 ? "var(--ok)" : r >= 0.7 ? "var(--warn)" : "var(--danger)";
}

/**
 * The scheduler chip — the visible FSRS-vs-attention split (load-bearing).
 *
 * Cards (`kind: "fsrs"`): `brain` icon + `--sched-fsrs` accent, retrievability %
 * + stability days. Everything else (`kind: "attention"`): `gauge` icon +
 * `--sched-attn` accent, stage + postponed ×N.
 */
export function SchedulerChip({ scheduler }: { scheduler: SchedulerSignals }) {
  useLocale();
  if (scheduler.kind === "fsrs") {
    const r = scheduler.retrievability;
    return (
      <span
        className="sched sched--fsrs"
        data-scheduler="fsrs"
        data-testid="scheduler-chip"
        title={t("details.m8fe6f61e79d5")}
      >
        <Icon name="brain" size={12} />
        {r !== null ? (
          <span>
            <b>{Math.round(r * 100)}%</b>
            {t("details.ma3eaa465ea5d")}
          </span>
        ) : (
          <span>{t("details.m11507a0e2f5e")}</span>
        )}
        {scheduler.stability !== null && (
          <>
            <span className="sched__sep">·</span>
            <span title={t("details.mc01d10fe58fa", { value1: String(scheduler.stability) })}>
              S {formatStability(scheduler.stability)}d
            </span>
          </>
        )}
      </span>
    );
  }
  return (
    <span
      className="sched sched--attn"
      data-scheduler="attention"
      data-testid="scheduler-chip"
      title={t("details.m14638b81f687")}
    >
      <Icon name="gauge" size={12} />
      <span>{stageLabel(scheduler.stage)}</span>
      {scheduler.postponed > 0 && (
        <>
          <span className="sched__sep">·</span>
          <span>
            {t("details.mcd17c9cad56e")}
            {scheduler.postponed}
          </span>
        </>
      )}
    </span>
  );
}

function hasFiniteEvidence(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatAttentionScheduleReason(scheduler: SchedulerSignals): string | null {
  if (scheduler.kind !== "attention") return null;
  const reason = scheduler.scheduleReason ?? null;
  if (!reason || reason.kind === "band_base") return null;

  switch (reason.kind) {
    case "yield_shortened":
      return hasFiniteEvidence(reason.productiveOutputCount) && reason.productiveOutputCount > 0
        ? `Returning sooner: last visit produced ${reason.productiveOutputCount} output(s).`
        : null;
    case "yield_lengthened":
      return t("supplement.md8ce80d825be");
    case "recency_damped":
      return hasFiniteEvidence(reason.daysSinceLastSeen)
        ? `Returning sooner: untouched for ${reason.daysSinceLastSeen}d.`
        : null;
    case "postpone_recession":
      return hasFiniteEvidence(reason.postponeCount)
        ? `Receding after postpone x${reason.postponeCount}.`
        : null;
    case "source_unresolved_shortened":
      return t("supplement.mc51071e3e2e5");
    case "source_exhausted_lengthened":
      return t("supplement.ma6321be6b3b4");
    case "descendant_lapses":
      return hasFiniteEvidence(reason.descendantLapseCount) &&
        hasFiniteEvidence(reason.affectedCardCount) &&
        hasFiniteEvidence(reason.descendantCardCount) &&
        hasFiniteEvidence(reason.descendantLapseRate) &&
        hasFiniteEvidence(reason.intervalAfterDescendantDays)
        ? "Returning sooner: descendant cards are struggling."
        : null;
    default:
      return null;
  }
}

export function ScheduleReasonLine({
  scheduler,
  id,
  className,
}: {
  scheduler: SchedulerSignals;
  id?: string;
  className?: string;
}) {
  useLocale();
  const text = formatAttentionScheduleReason(scheduler);
  if (!text) return null;
  return (
    <span
      id={id}
      className={["schedule-reason-line", className].filter(Boolean).join(" ")}
      data-testid="schedule-reason-line"
    >
      {text}
    </span>
  );
}

/** The FSRS three-stat readout (Stability / Difficulty / Retrievability). */
export function FsrsStats({ scheduler }: { scheduler: SchedulerSignals }) {
  useLocale();
  const stability = scheduler.stability ?? 0;
  const difficulty = scheduler.difficulty ?? 0;
  const r = scheduler.retrievability;
  const rPct = r === null ? 0 : Math.round(r * 100);
  return (
    <div className="fsrs-stats" data-testid="fsrs-stats">
      <div className="fstat">
        <span
          className="fstat__v"
          title={t("details.mf766f83db1f4", { value1: String(stability) })}
        >
          {formatStability(stability)}
          <span style={{ fontSize: "var(--t-xs)", color: "var(--text-3)" }}>d</span>
        </span>
        <span className="fstat__l">{t("details.m1e42d0c86af7")}</span>
        <span className="fstat__bar">
          <i
            style={{
              width: `${Math.min(100, (stability / 60) * 100)}%`,
              background: "var(--accent)",
            }}
          />
        </span>
      </div>
      <div className="fstat">
        <span className="fstat__v" title={`${difficulty} / 10`}>
          {formatDifficulty(difficulty)}
          <span style={{ fontSize: "var(--t-xs)", color: "var(--text-3)" }}>/10</span>
        </span>
        <span className="fstat__l">{t("details.mbe44133ed57f")}</span>
        <span className="fstat__bar">
          <i
            style={{
              width: `${difficulty * 10}%`,
              background: difficulty > 6 ? "var(--warn)" : "var(--text-3)",
            }}
          />
        </span>
      </div>
      <div className="fstat">
        <span className="fstat__v" style={{ color: r === null ? "var(--text-3)" : retrColor(r) }}>
          {r === null ? "—" : `${rPct}%`}
        </span>
        <span className="fstat__l">{t("details.mc3fdbba41560")}</span>
        <span className="fstat__bar">
          <i
            style={{
              width: `${rPct}%`,
              background: r === null ? "var(--border)" : retrColor(r),
            }}
          />
        </span>
      </div>
    </div>
  );
}

/** Inspector key/value row. */
export function MetaRow({ k, children }: { k: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="meta-row">
      <span className="meta-key">{k}</span>
      <span className="meta-val">{children}</span>
    </div>
  );
}

/** Flat tag pill. */
export function Tag({ name }: { name: string }) {
  useLocale();
  return <span className="tag">{name}</span>;
}

/**
 * Concept pill (T041) — the kit's `concept-tag` (a dot + name, `--el-concept`
 * token). Clickable when `onClick` is provided (e.g. to navigate to/filter by the
 * concept). Distinct from {@link Tag} (the flat `#`-prefixed label).
 */
export function ConceptTag({ name, onClick }: { name: string; onClick?: () => void }) {
  useLocale();
  if (onClick) {
    return (
      <button type="button" className="concept-tag concept-tag--btn" onClick={onClick}>
        {name}
      </button>
    );
  }
  return <span className="concept-tag">{name}</span>;
}
