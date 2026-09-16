/**
 * Shared, pure queue-row presentation helpers (T029 / Home command center).
 *
 * The per-row TITLE prefix ("Extract · …", "Q&A · …"), the open-action affordance
 * (icon + label per type), and the due-state `DueBadge` are needed by BOTH the
 * actionable Daily Queue list (`QueueScreen`) and the read-only top-due preview on
 * the Home command center (`HomeScreen`). They are extracted here so the two
 * surfaces can never drift — the slim preview reuses the SAME title/badge logic as
 * the full list WITHOUT pulling in the actionable `QueueItem` (its row actions,
 * schedule menu, selection wiring) which is queue-only.
 *
 * UI only — pure functions over the typed `window.appApi` `QueueItemSummary`; no
 * SQL, no scheduling math, no data fetching.
 */

import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Stage } from "../../components/inspector/primitives";
import type { ExtractAgeBand, QueueItemSummary } from "../../lib/appApi";

function elementTypeNoun(type: string | null): string {
  if (type === "source") return t("supplement.m41cf6794ba42");
  if (type === "topic") return t("supplement.m23d611a6f6f8");
  if (type === "extract") return t("supplement.mf1cf2fd5c868");
  if (type === "card") return t("supplement.m8367cd66fdd1");
  if (type === "synthesis_note") return t("supplement.md2d1c4e9920b");
  return t("supplement.m4a33eacd5fa6");
}

/**
 * The per-row title with the kit's type prefix ("Extract · …", "Q&A · …").
 *
 * Only the types whose bare title would be ambiguous get a prefix: card
 * ("Q&A · …" / "Cloze · …"), extract ("Extract · …"), and topic ("Topic · …").
 * source / task / synthesis_note return their title bare — their content already
 * reads as a title, and the per-row meta line (`metaFor`) carries the type label,
 * so prefixing them too would be redundant.
 */
export function titleFor(item: QueueItemSummary): string {
  if (item.type === "card") {
    const prefix = item.cardType === "cloze" ? t("supplement.mab399be45d5c") : "Q&A · ";
    return prefix + item.title.replace(/\{\{(.+?)\}\}/, "[…]");
  }
  if (item.type === "extract") return t("supplement.mca2b8bdaaa08", { value1: String(item.title) });
  if (item.type === "topic") return t("supplement.m631abbe0069c", { value1: String(item.title) });
  return item.title;
}

/**
 * The per-type meta sub-line for a queue row (the kit's `QueueItem` meta), or
 * `null` when the type carries no sub-line content. One branch per element type so
 * EVERY type — source (author), card (from sourceTitle), extract (Stage), topic
 * ("N sources · M cards" is later; the stage stands in for now), synthesis_note
 * ("N words" is later; the type label stands in), task ("<kind> task") — reads
 * with real content before the SchedulerChip, matching the kit. Returning `null`
 * lets the caller suppress the otherwise-orphan leading dot separator.
 *
 * Pure presentation, shared by the Daily Queue list + the Home top-due preview so
 * the two surfaces can never drift.
 */
export function metaFor(item: QueueItemSummary): ReactElement | null {
  if (item.type === "source") {
    return item.author ? (
      <span className="qitem__sub">
        <Icon name="globe" size={13} /> {item.author}
      </span>
    ) : null;
  }
  if (item.type === "card") {
    return item.sourceTitle ? (
      <span className="qitem__sub">
        {t("learning.m49a6ddf9a439")}
        <i>{item.sourceTitle}</i>
      </span>
    ) : null;
  }
  if (item.type === "extract") return <Stage stage={item.stage} />;
  if (item.type === "topic") {
    return (
      <span className="qitem__sub">
        <Icon name="layers" size={13} />{" "}
        {item.sectionSourceTitle
          ? t("sourceReturn.sectionOf", { title: item.sectionSourceTitle })
          : t("learning.m7e61847d61d6")}
      </span>
    );
  }
  if (item.type === "synthesis_note") {
    return (
      <span className="qitem__sub">
        <Icon name="synthesis" size={13} />
        {t("learning.mc8ecb4b0b378")}
      </span>
    );
  }
  if (item.type === "task") {
    // A T129 re-read is attention-scheduled help, NOT a verification task — give it the
    // calm `eye` (re-reading) glyph and a "Re-read a source section" sub-line, never the
    // `task` shield (it protects nothing) and never the FSRS `brain`/review glyph.
    if (item.taskType === "reread_region") {
      return (
        <span className="qitem__sub">
          <Icon name="eye" size={13} />
          {t("learning.mf8ce7300e642")}
        </span>
      );
    }
    const detail = item.linkedElementId
      ? `Protects ${elementTypeNoun(item.linkedElementType)}`
      : "Task";
    return (
      <span className="qitem__sub">
        <Icon name="task" size={13} /> {detail}
      </span>
    );
  }
  return null;
}

function ageBandLabel(band: ExtractAgeBand): string {
  if (band === "fresh") return t("supplement.mf810b6687741");
  if (band === "aging") return t("supplement.m90dd095da6be");
  if (band === "stale") return t("supplement.m40c9e59c5e15");
  return t("supplement.m3561a4b89ed1");
}

export function ExtractAgeChip({ item }: { item: QueueItemSummary }): ReactElement | null {
  useLocale();
  const aging = item.extractAging;
  if (!aging) return null;
  return (
    <span
      className={`extract-age-chip extract-age-chip--${aging.band}`}
      data-testid="extract-age-chip"
      title={t("learning.m91006f066b4a", {
        value1: String(aging.daysSinceProgress),
        value2: String(aging.postponeCount),
      })}
    >
      <Icon name="clock" size={12} />
      {ageBandLabel(aging.band)}
      {aging.thresholdReached ? t("learning.m56b68deefb32") : ""}
    </span>
  );
}

/**
 * T123 → T124 — the content-staleness chip, now ACTIONABLE. A source block this item
 * derives from was edited, so its body may no longer match. The chip links to the T124
 * re-verify drain (`/maintenance/reverify`) where the flag resolves as confirm / rebase /
 * detach. Styled at the same `--warn` advisory severity as a stale extract-age chip, NOT
 * `--danger`.
 */
export function ReverifyChip({ item }: { item: QueueItemSummary }): ReactElement | null {
  useLocale();
  if (!item.schedulerSignals.needsReverify) return null;
  return (
    <Link
      to="/maintenance/reverify"
      className="reverify-chip reverify-chip--action"
      data-testid="reverify-chip"
      title={t("learning.mc12454195e7f")}
    >
      <Icon name="warning" size={12} />
      {t("learning.m32ecc71411c8")}
    </Link>
  );
}

/** The open-action icon + label per type (the `next-action` affordance). */
export function actionFor(item: QueueItemSummary): { icon: IconName; label: string } {
  if (item.type === "card")
    return {
      icon: "brain",
      get label() {
        return t("options.maff0766a5290");
      },
    };
  if (item.type === "source")
    return {
      icon: "eye",
      get label() {
        return t("options.me4f8f4ed0369");
      },
    };
  if (item.type === "extract")
    return {
      icon: "extract",
      get label() {
        return t("options.me083bd83e9d3");
      },
    };
  if (item.type === "task" && item.taskType === "weekly_review") {
    return {
      icon: "calendar",
      get label() {
        return t("options.m42b3a2a6794f");
      },
    };
  }
  // A T129 re-read task opens the source reader at the failing region (KTD-7). The `eye`
  // (re-reading) glyph keeps it on the attention side of the scheduler split — never the
  // FSRS `RefreshCw`/review glyph. Checked BEFORE the generic linked-task branch so it
  // doesn't fall through to the extract-linked "Verify" affordance.
  if (item.type === "task" && item.taskType === "reread_region") {
    return {
      icon: "eye",
      get label() {
        return t("options.mb72908f8bf42");
      },
    };
  }
  // A verification task LINKED to a protected element opens that element's reader (T092),
  // so the affordance reads "Verify" — a free-standing (unlinked) task reads "Open".
  if (item.type === "task" && item.linkedElementId)
    return {
      icon: "eye",
      get label() {
        return t("options.meea2745e2867");
      },
    };
  return {
    icon: "return",
    get label() {
      return t("options.med077f3d8125");
    },
  };
}

/** A due-state badge (overdue / today / soon) — distinct from the lifecycle `Status`. */
export function DueBadge({ item }: { item: QueueItemSummary }) {
  useLocale();
  const cls =
    item.due === "overdue" ? "badge--overdue" : item.due === "today" ? "badge--due" : "badge--soft";
  return (
    <span className={`badge ${cls}`} data-testid="queue-due-badge">
      {item.dueLabel}
    </span>
  );
}

import { t, useLocale } from "../../i18n";
