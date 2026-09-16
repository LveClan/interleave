import { t, useLocale } from "../i18n";
/**
 * Retired-card inventory (T082) — the maintenance surface for cards that have
 * gracefully left active review.
 *
 * A low-value MATURE card (high stability, low priority, well-learned) can be
 * RETIRED so it stops costing review time WITHOUT being deleted or losing its
 * lineage/history. Retirement is the durable `cards.is_retired` flag (the source of
 * truth for "skip in the due/review reads"), set from the review repair row or the
 * inspector. This view lists every LIVE retired card — most-mature first — with its
 * body + memory signals (stability/reps/lapses) + lineage source, and offers:
 *  - **Un-retire** — `appApi.unretireCard` (`cards.unretire` → `update_element`),
 *    returning the card to the normal due read at its existing due date.
 *
 * Retire ≠ suspend ≠ delete: retire is "done with, kept for reference, low-value", a
 * distinct reversible exit. (Auto-retirement under overload is the auto-postpone
 * family — out of scope here; this is the explicit, reversible inventory.)
 *
 * Architecture (non-negotiable): this is UI only — no SQL, no FSRS math, no
 * retirement logic. The list comes from `appApi.retiredCards()` (read-only), and the
 * action is a typed `appApi.*` call over the preload bridge; the main process owns
 * the transaction + the `operation_log` op. Un-retiring never destroys the card or
 * its `review_logs`.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Prio } from "../components/inspector/primitives";
import "../components/inspector/inspector.css";
import { appApi, isDesktop, type RetiredCardSummary } from "../lib/appApi";
import { formatStability } from "../lib/formatFsrs";
import "../review/review.css";
import "./leech-cleanup.css";

export function RetiredCards() {
  useLocale();
  const desktop = isDesktop();
  const [cards, setCards] = useState<readonly RetiredCardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isDesktop()) {
      setLoading(false);
      return;
    }
    try {
      const res = await appApi.retiredCards();
      setCards(res.cards);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unretire = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await appApi.unretireCard({ cardId: id });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (!desktop) {
    return (
      <div className="rv-shell" data-testid="route-retired-cards">
        <div className="rv-blank">
          <div className="rv-empty">
            <div className="rv-empty__icon">
              <Icon name="archive" size={26} />
            </div>
            <h1 className="rv-empty__title">{t("collection.m3c95d7bd7c41")}</h1>
            <p className="rv-empty__body">{t("collection.mc959b6a9a1f0")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-shell lc-shell" data-testid="route-retired-cards">
      <div className="lc-head">
        <div>
          <h1 className="lc-title">
            <Icon name="archive" size={18} />
            {t("collection.m8d9ba07feb19")}
          </h1>
          <p className="lc-sub">{t("collection.m62e5a40a7455")}</p>
        </div>
        <span className="lc-count" data-testid="retired-count">
          {cards.length}
          {t("collection.mf307c26e973f")}
        </span>
      </div>

      {error ? (
        <p className="pq-error" data-testid="retired-error" style={{ padding: "8px 24px" }}>
          {error}
        </p>
      ) : null}

      <div className="lc-list">
        {loading ? (
          <p className="lc-loading" data-testid="retired-loading">
            {t("collection.m0a5afbeee779")}
          </p>
        ) : cards.length === 0 ? (
          <div className="rv-empty" data-testid="retired-empty">
            <div className="rv-empty__icon">
              <Icon name="checkCircle" size={26} />
            </div>
            <h2 className="rv-empty__title">{t("collection.mf9711236d4be")}</h2>
            <p className="rv-empty__body">{t("collection.m3dd710a34af1")}</p>
          </div>
        ) : (
          cards.map((card) => (
            <div
              className="lc-card"
              key={card.id}
              data-testid="retired-card"
              data-card-id={card.id}
            >
              <div className="lc-card__meta">
                <span className="badge badge--soft">
                  {card.kind === "cloze" ? t("collection.mde503889179e") : "Q&A"}
                </span>
                <Prio priority={card.priority} />
                <span className="badge badge--retired" data-testid="retired-card-badge">
                  <Icon name="archive" size={11} />
                  {t("collection.md1cd7e9ee7d3")}
                </span>
                <span className="badge badge--soft" data-testid="retired-card-stability">
                  {formatStability(card.stability)}
                  {t("collection.m942bce65b99c")}
                </span>
              </div>
              <div className="lc-card__body">
                <div className="lc-card__prompt" data-testid="retired-card-prompt">
                  {card.kind === "cloze" ? card.cloze : card.prompt}
                </div>
                {card.kind === "qa" && card.answer ? (
                  <div className="lc-card__answer">{card.answer}</div>
                ) : null}
                {card.sourceTitle ? (
                  <div className="refblock lc-card__src">
                    {card.sourceTitle}
                    {card.sourceLocationLabel ? ` · ${card.sourceLocationLabel}` : ""}
                  </div>
                ) : null}
              </div>

              <div className="lc-card__actions" data-testid="retired-card-actions">
                <button
                  type="button"
                  className="rv-repair__btn"
                  data-testid="retired-unretire"
                  disabled={busyId === card.id}
                  onClick={() => void unretire(card.id)}
                >
                  <Icon name="archive" size={14} />
                  {t("collection.m9207ff62308b")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
