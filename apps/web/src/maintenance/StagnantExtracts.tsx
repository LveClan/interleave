import { i18n, t, useLocale } from "../i18n";
/**
 * Stagnant-extracts maintenance view (T084) — the attention-side mirror of the leech
 * cleanup screen.
 *
 * Where leeches surface FSRS *cards* that keep failing, this surfaces attention
 * *extracts* that keep COMING BACK without ever PROGRESSING: their stage never
 * advances (`raw_extract → clean_extract → atomic_statement`), they produced no
 * children, and they have been postponed repeatedly. The domain layer
 * (`ExtractStagnationQuery` in `packages/local-db`) detects them with the PURE
 * `@interleave/scheduler` `isStagnant` heuristic and returns each one with its
 * `reasons` + a recommended remediation; this screen renders those already-computed
 * rows and offers the four T024 remedies, the suggested one highlighted:
 *  - **Rewrite** — open the extract editor (`/extract/$id`) to clean it up.
 *  - **Convert** — open the extract editor to turn it into a card (the existing
 *    extract→card path).
 *  - **Postpone** — `appApi.postponeExtract` (a deliberate deferral; removes the row).
 *  - **Delete** — `appApi.deleteExtract` (soft-delete, undoable from trash).
 *
 * Architecture (non-negotiable): UI ONLY — NO detection logic, NO stage/postpone math.
 * The list comes from `appApi.getExtractStagnation()` (read-only), and every action is
 * a typed `appApi.*` call over the preload bridge; the main process owns the
 * transaction + the `operation_log` op. Stagnation is an ATTENTION concern; an extract
 * is never called a "leech".
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Prio } from "../components/inspector/primitives";
import { LineageDeleteMenu } from "../components/lineage/LineageDeleteMenu";
import { useLineageDelete } from "../components/lineage/useLineageDelete";
import { Snackbar } from "../components/Snackbar";
import "../components/inspector/inspector.css";
import {
  appApi,
  type ExtractAgingPreviewResult,
  isDesktop,
  type StagnantExtractRow,
  type StagnationReason,
  type StagnationSuggestion,
} from "../lib/appApi";
import {
  canReactivateExtractFate,
  canSetExtractFate,
  EXTRACT_FATE_BRIDGE_HINT,
  extractFateLabel,
  extractFateOf,
  reactivateExtractFate,
  setExtractFate,
} from "../lib/extractFateAdapter";
import { UNDO_EVENT } from "../shell/nav";
import "../review/review.css";
import "./leech-cleanup.css";
import "./stagnant-extracts.css";

/** The human label for each fired reason (the calm chips). */
const REASON_LABEL: Record<StagnationReason, string> = {
  "postponed-repeatedly": "Postponed repeatedly",
  "no-progress": "No progress",
  "no-children": "No children",
  stale: "Stale",
};

/** The human label + the verb for each suggested remediation. */
type T104StagnationSuggestion = StagnationSuggestion | "keep_as_reference" | "mark_synthesized";

const SUGGESTION_LABEL: Record<T104StagnationSuggestion, string> = {
  rewrite: "Rewrite",
  convert: "Convert to card",
  postpone: "Postpone",
  delete: "Delete",
  keep_as_reference: "Keep as reference",
  mark_synthesized: "Synthesis reference",
};

/** The readable extract-stage label for the meta row. */
function stageLabel(stage: string): string {
  switch (stage) {
    case "raw_extract":
      return "Raw";
    case "clean_extract":
      return "Clean";
    case "atomic_statement":
      return "Atomic";
    default:
      return stage;
  }
}

export function StagnantExtracts() {
  useLocale();
  const desktop = isDesktop();
  const navigate = useNavigate();
  // The route declares no `validateSearch`, so search is loosely typed. An optional
  // `asOf` date-scopes the scan (used by the E2E to drive a fixed clock so a freshly
  // created, never-aged extract reads as stale); in normal use it defaults to "now".
  const search = useSearch({ strict: false }) as { asOf?: string };
  const asOf = typeof search.asOf === "string" ? search.asOf : undefined;
  const [rows, setRows] = useState<readonly StagnantExtractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [agingPreview, setAgingPreview] = useState<ExtractAgingPreviewResult | null>(null);
  const [agingBusy, setAgingBusy] = useState(false);
  const [agingMessage, setAgingMessage] = useState("");

  const load = useCallback(async () => {
    if (!isDesktop()) {
      setLoading(false);
      return;
    }
    try {
      const [res, aging] = await Promise.all([
        appApi.getExtractStagnation(asOf ? { asOf } : undefined),
        appApi.previewExtractAging(asOf ? { asOf } : undefined),
      ]);
      setRows(res.rows);
      setAgingPreview(aging);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-read after a global undo (⌘Z) so a restored extract reappears.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(UNDO_EVENT, handler);
    return () => window.removeEventListener(UNDO_EVENT, handler);
  }, [load]);

  /** Rewrite / Convert both OPEN the extract editor — the place to act on it. */
  const open = useCallback(
    (id: string) => {
      void navigate({ to: "/extract/$id", params: { id } });
    },
    [navigate],
  );

  /** Postpone / Reference / Reactivate are direct typed commands; remove the row optimistically. */
  const act = useCallback(
    async (id: string, action: "postpone" | "reference" | "reactivate") => {
      setBusyId(id);
      setError(null);
      try {
        if (action === "postpone") await appApi.postponeExtract({ id });
        else if (action === "reference") await setExtractFate(id, "reference");
        else await reactivateExtractFate(id);
        setRows((prev) => prev.filter((r) => r.extract.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const applyExtractAgingSweep = useCallback(async () => {
    setAgingBusy(true);
    setAgingMessage("Returning stale extracts to reference.");
    setError(null);
    try {
      const ids = agingPreview?.candidates.map((candidate) => candidate.id) ?? [];
      const result = await appApi.applyExtractAging({
        ...(asOf ? { asOf } : {}),
        ids,
      });
      setAgingMessage(
        result.demoted > 0
          ? `${result.demoted} extract${i18n.language.startsWith("zh") ? "" : result.demoted === 1 ? "" : "s"} returned to reference.`
          : "No eligible extracts changed.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAgingMessage("Could not apply extract aging sweep.");
    } finally {
      setAgingBusy(false);
    }
  }, [agingPreview, asOf, load]);

  // Descendant-aware delete (T135 / U7): a leaf deletes quietly; a stagnant extract
  // that still anchors live descendants opens the intent menu instead of a silent prune.
  // Any outcome drops the row (the extract is no longer an active stagnant item) and
  // re-reads after an undo.
  const lineageDelete = useLineageDelete({
    quietDelete: async (target) => {
      await appApi.deleteExtract({ id: target.id });
    },
    onAfter: (target) => {
      setRows((prev) => prev.filter((r) => r.extract.id !== target.id));
    },
  });

  if (!desktop) {
    return (
      <div className="rv-shell" data-testid="route-stagnant-extracts">
        <div className="rv-blank">
          <div className="rv-empty">
            <div className="rv-empty__icon">
              <Icon name="hourglass" size={26} />
            </div>
            <h1 className="rv-empty__title">{t("collection.m96ef8f44a686")}</h1>
            <p className="rv-empty__body">{t("collection.mbbb8f6cb384d")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-shell lc-shell" data-testid="route-stagnant-extracts">
      <div className="lc-head">
        <div>
          <h1 className="lc-title">
            <Icon name="hourglass" size={18} />
            {t("collection.m8bc239271d87")}
          </h1>
          <p className="lc-sub">{t("collection.m9809aca6027e")}</p>
        </div>
        <span className="lc-count" data-testid="stagnant-count">
          {rows.length}
          {t("collection.m5f5d67c809ba")}
        </span>
      </div>

      {error ? (
        <p className="pq-error" data-testid="stagnant-error" style={{ padding: "8px 24px" }}>
          {error}
        </p>
      ) : null}

      {agingPreview && agingPreview.policy !== "off" ? (
        <div className="se-aging-sweep" data-testid="extract-aging-sweep">
          <div className="se-aging-sweep__copy">
            <div className="se-aging-sweep__title">
              <Icon name="clock" size={14} />
              {t("collection.mf7d5eba9cbbc")}
            </div>
            <div className="se-aging-sweep__meta">
              {agingPreview.candidateCount}
              {t("collection.maecbfc09e481")}
              {agingPreview.thresholds.returnThreshold} {t("collection.mcdfb9a5f4ffa")}
              {agingPreview.thresholds.ageDays}
              {t("collection.m8fae8e734d61")}
              {agingPreview.remainingCandidateCount > 0
                ? t("collection.mfdb9b6ccace5", {
                    value1: String(agingPreview.remainingCandidateCount),
                  })
                : ""}
            </div>
            <div className="sr-only" role="status" aria-live="polite">
              {agingMessage}
            </div>
          </div>
          <button
            type="button"
            className="rv-repair__btn se-btn--suggested"
            data-testid="extract-aging-apply"
            disabled={agingBusy || agingPreview.candidates.length === 0}
            onClick={() => void applyExtractAgingSweep()}
          >
            <Icon name="bookmark" size={14} />
            {agingBusy ? t("collection.m8a9bd1bef40d") : t("collection.m4d452bd1754f")}
          </button>
        </div>
      ) : null}

      <div className="lc-list">
        {loading ? (
          <p className="lc-loading" data-testid="stagnant-loading">
            {t("collection.m0a5afbeee779")}
          </p>
        ) : rows.length === 0 ? (
          <div className="rv-empty" data-testid="stagnant-empty">
            <div className="rv-empty__icon">
              <Icon name="checkCircle" size={26} />
            </div>
            <h2 className="rv-empty__title">{t("collection.m7e0d09ddd1b4")}</h2>
            <p className="rv-empty__body">{t("collection.mb8eeef84212d")}</p>
          </div>
        ) : (
          rows.map((row) => {
            const suggestion = row.suggestion as T104StagnationSuggestion;
            const fate = extractFateOf(row.extract);
            const fateSupported = canSetExtractFate();
            const reactivateSupported = canReactivateExtractFate();
            return (
              <div
                className="lc-card se-card"
                key={row.extract.id}
                data-testid="stagnant-row"
                data-extract-id={row.extract.id}
                data-suggestion={suggestion}
              >
                <div className="lc-card__meta">
                  <span className="badge badge--soft">{stageLabel(row.extract.stage)}</span>
                  <Prio priority={row.extract.priority} />
                  <span className="badge se-badge--postpone" data-testid="stagnant-postpones">
                    {t("collection.m3f118f6829af")}
                    {row.postponeCount}
                  </span>
                  <span className="badge badge--soft" data-testid="stagnant-stale">
                    {row.daysSinceProgress}
                    {t("collection.ma4651e681718")}
                  </span>
                  {fate ? (
                    <span className="badge badge--soft" data-testid="stagnant-fate">
                      {extractFateLabel(fate)}
                    </span>
                  ) : null}
                </div>

                <div className="lc-card__body">
                  <div className="lc-card__prompt" data-testid="stagnant-title">
                    <Icon name="extract" size={14} />
                    <span className="se-title" title={row.extract.title}>
                      {row.extract.title}
                    </span>
                  </div>
                  <div className="se-reasons" data-testid="stagnant-reasons">
                    {row.reasons.map((reason) => (
                      <span className="se-reason" key={reason} data-reason={reason}>
                        {REASON_LABEL[reason]}
                      </span>
                    ))}
                  </div>
                  <div className="se-suggest" data-testid="stagnant-suggestion">
                    <Icon name="sparkle" size={12} />
                    {t("collection.m003c052ea56a")}
                    {SUGGESTION_LABEL[suggestion]}
                  </div>
                </div>

                <div className="lc-card__actions" data-testid="stagnant-actions">
                  <button
                    type="button"
                    className={`rv-repair__btn${suggestion === "rewrite" ? " se-btn--suggested" : ""}`}
                    data-testid="stagnant-rewrite"
                    disabled={busyId === row.extract.id}
                    onClick={() => open(row.extract.id)}
                  >
                    <Icon name="edit" size={14} />
                    {t("collection.m4b7ce7840ba1")}
                  </button>
                  <button
                    type="button"
                    className={`rv-repair__btn${suggestion === "convert" ? " se-btn--suggested" : ""}`}
                    data-testid="stagnant-convert"
                    disabled={busyId === row.extract.id}
                    onClick={() => open(row.extract.id)}
                  >
                    <Icon name="card" size={14} />
                    {t("collection.mfc7dd2a0c71e")}
                  </button>
                  <button
                    type="button"
                    className={`rv-repair__btn${suggestion === "postpone" ? " se-btn--suggested" : ""}`}
                    data-testid="stagnant-postpone"
                    disabled={busyId === row.extract.id}
                    onClick={() => void act(row.extract.id, "postpone")}
                  >
                    <Icon name="hourglass" size={14} />
                    {t("collection.m6087edb47090")}
                  </button>
                  {/* Descendant-aware delete (T135 / U7): a leaf deletes quietly; a row that
                      still anchors live descendants opens the intent menu. Keeps the
                      `stagnant-delete` testid + the suggested-highlight + the row look. */}
                  <LineageDeleteMenu
                    target={{
                      id: row.extract.id,
                      // Every row on this surface is an extract (by construction).
                      type: "extract",
                      title: row.extract.title,
                    }}
                    actions={lineageDelete.actions}
                    busy={busyId === row.extract.id || lineageDelete.busy}
                    triggerClassName={`rv-repair__btn${suggestion === "delete" ? " se-btn--suggested" : ""}`}
                    triggerIcon="trash"
                    triggerLabel="Delete"
                    triggerTestId="stagnant-delete"
                    tooltipLabel="Delete extract"
                    triggerAriaLabel="Delete extract"
                  />
                  <button
                    type="button"
                    className={`rv-repair__btn${suggestion === "keep_as_reference" ? " se-btn--suggested" : ""}`}
                    data-testid="stagnant-reference"
                    disabled={busyId === row.extract.id || !fateSupported}
                    title={fateSupported ? t("collection.m33ad657cde1f") : EXTRACT_FATE_BRIDGE_HINT}
                    onClick={() => void act(row.extract.id, "reference")}
                  >
                    <Icon name="bookmark" size={14} />
                    {t("collection.mab0cedb8fbaa")}
                  </button>
                  {fate ? (
                    <button
                      type="button"
                      className="rv-repair__btn"
                      data-testid="stagnant-reactivate"
                      disabled={busyId === row.extract.id || !reactivateSupported}
                      title={
                        reactivateSupported
                          ? t("collection.m0f16cb23ecfd")
                          : EXTRACT_FATE_BRIDGE_HINT
                      }
                      onClick={() => void act(row.extract.id, "reactivate")}
                    >
                      <Icon name="restore" size={14} />
                      {t("collection.mf8aa7263bcd8")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* The descendant-aware delete outcome (T135 / U7) — Undo restores the batch for a
          branch delete, the last op for a leaf. */}
      <Snackbar
        message={lineageDelete.snackbar?.message ?? null}
        onUndo={lineageDelete.snackbar?.onUndo}
        onClose={() => lineageDelete.setSnackbar(null)}
        icon={lineageDelete.snackbar?.icon ?? "trash"}
        timeoutMs={lineageDelete.snackbar?.timeoutMs}
        testId="stagnant-delete-snackbar"
      />
    </div>
  );
}
