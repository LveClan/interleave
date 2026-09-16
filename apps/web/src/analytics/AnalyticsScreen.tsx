import { i18n, t, useLocale } from "../i18n";
/**
 * Analytics view (T045) — the system-wide learning-health snapshot.
 *
 * Rebuilt from the design kit's `AnalyticsScreen` (`design/kit/app/screen-analytics.jsx`):
 * a centered column with a top row of `Metric` tiles (Retention, Reviews, Day
 * streak, Due), a "Reviews per day" `Spark` panel, and a "System health" panel of
 * `Banner`s (leeches → /maintenance/leeches; deletions → /trash).
 *
 * Architecture (non-negotiable): this is UI ONLY — NO aggregation, NO SQL, NO date
 * math beyond formatting the already-computed numbers. The entire snapshot comes
 * from `appApi.getAnalytics()` (read-only; the domain `AnalyticsService` does all
 * the work over `review_logs`/`elements`/`review_states`), so the numbers are
 * correct, survive an app restart, and match what the user actually graded.
 *
 * T109 adds concept-level maturity/retention receipts from the read-only
 * topic-knowledge-state bridge. The renderer still does no aggregation.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BalanceBanner } from "../components/BalanceBanner";
import { Icon } from "../components/Icon";
import {
  type AnalyticsGetResult,
  appApi,
  isDesktop,
  type PriorityIntegrityGetResult,
  type TopicKnowledgeStateGetRequest,
  type TopicKnowledgeStateGetResult,
  type TopicKnowledgeStateSubject,
} from "../lib/appApi";
import { UNDO_EVENT } from "../shell/nav";
import "./analytics.css";
import { PriorityIntegrityPanel } from "./PriorityIntegrityPanel";
import { ReviewActivityHeatmap, type ReviewActivityResult } from "./ReviewActivityHeatmap";

/** Format a `[0,1]` retention fraction as a percentage string, or "—" when null. */
function formatRetention(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}`;
}

/** A small whole-number formatter with thousands separators. */
function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function graduationLabel(status: TopicKnowledgeStateSubject["graduationState"]["status"]): string {
  switch (status) {
    case "graduated":
      return "Mature";
    case "near_graduation":
      return "Near mature";
    case "needs_attention":
      return "Needs attention";
    case "building":
      return "Building";
    case "insufficient_evidence":
      return "Insufficient evidence";
  }
}

function ConceptRetentionPanel({
  data,
  error,
  onOpenConcept,
}: {
  data: TopicKnowledgeStateGetResult | null;
  error: string | null;
  onOpenConcept: (conceptId: string) => void;
}) {
  useLocale();
  const subjects = data?.subjects ?? [];
  return (
    <div className="an-panel an-knowledge" data-testid="concept-retention-panel">
      <div className="an-panel__head">
        <span className="an-panel__title">{t("collection.mb9095b2e1f9d")}</span>
        <span className="an-panel__meta">
          {data?.windowDays ?? 90}
          {t("collection.mb1c503166f16")}
        </span>
      </div>
      {error ? (
        <p className="an-priority__error" data-testid="concept-retention-error">
          {error}
        </p>
      ) : subjects.length === 0 ? (
        <p className="an-knowledge__empty" data-testid="concept-retention-empty">
          {t("collection.m21e2848b70bc")}
        </p>
      ) : (
        <div className="an-knowledge__rows" data-testid="concept-retention-rows">
          {subjects.map((subject) => (
            <button
              type="button"
              key={subject.subjectId}
              className={`an-knowledge__row an-knowledge__row--${subject.graduationState.status}`}
              data-testid="concept-retention-row"
              onClick={() => onOpenConcept(subject.subjectId)}
            >
              <span className="an-knowledge__main">
                <span className="an-knowledge__title">{subject.title}</span>
                <span className="an-knowledge__meta">
                  {graduationLabel(subject.graduationState.status)} ·{" "}
                  {subject.retention.reviewCount}
                  {t("collection.m3a186fa2a588")}
                </span>
              </span>
              <span className="an-knowledge__metric">
                <span className="an-knowledge__value">
                  {formatPct(subject.retention.measuredRetention)}
                </span>
                <span className="an-knowledge__label">
                  {t("collection.m7c51bfc4180d")}
                  {formatPct(subject.retention.retentionTarget)}
                </span>
              </span>
              <span className="an-knowledge__metric">
                <span className="an-knowledge__value">
                  {formatPct(subject.funnel.matureOfCarded)}
                </span>
                <span className="an-knowledge__label">
                  {subject.funnel.mature}/{subject.funnel.carded}
                  {t("collection.mace6de3c6478")}
                </span>
              </span>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnalyticsScreen() {
  useLocale();
  const desktop = isDesktop();
  const navigate = useNavigate();
  const [data, setData] = useState<AnalyticsGetResult | null>(null);
  // The number of low-yield sources (T083) — drives the "Low-yield sources" banner.
  // Read from the SAME read-only `SourceYieldQuery` the dedicated view renders.
  const [lowYieldCount, setLowYieldCount] = useState(0);
  // The number of stagnant extracts (T084) — drives the "Stagnant extracts" banner.
  // Read from the SAME read-only `ExtractStagnationQuery` the dedicated view renders.
  const [stagnantCount, setStagnantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ReviewActivityResult | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [priorityIntegrity, setPriorityIntegrity] = useState<PriorityIntegrityGetResult | null>(
    null,
  );
  const [priorityIntegrityError, setPriorityIntegrityError] = useState<string | null>(null);
  const [conceptKnowledge, setConceptKnowledge] = useState<TopicKnowledgeStateGetResult | null>(
    null,
  );
  const [conceptKnowledgeError, setConceptKnowledgeError] = useState<string | null>(null);
  const loadRequestId = useRef(0);
  const activityRequestId = useRef(0);
  const priorityIntegrityRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    if (!isDesktop()) {
      setLoading(false);
      return;
    }
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    setLoading(true);
    const conceptKnowledgeRequest: TopicKnowledgeStateGetRequest & {
      readonly order?: "needs_attention" | "default";
    } = { subjectType: "concept", limit: 6, order: "needs_attention" };
    const [analyticsResult, yieldResult, stagnationResult, priorityResult, conceptResult] =
      await Promise.allSettled([
        appApi.getAnalytics(),
        appApi.getSourceYield(),
        appApi.getExtractStagnation(),
        appApi.getPriorityIntegrity(),
        appApi.getTopicKnowledgeState(conceptKnowledgeRequest),
      ]);
    if (loadRequestId.current !== requestId) return;

    if (analyticsResult.status === "fulfilled") {
      setData(analyticsResult.value);
      setError(null);
    } else {
      setData(null);
      setError(
        analyticsResult.reason instanceof Error
          ? analyticsResult.reason.message
          : String(analyticsResult.reason),
      );
    }

    setLowYieldCount(yieldResult.status === "fulfilled" ? yieldResult.value.lowYieldCount : 0);
    setStagnantCount(
      stagnationResult.status === "fulfilled" ? stagnationResult.value.stagnantCount : 0,
    );
    if (priorityResult.status === "fulfilled") {
      setPriorityIntegrity(priorityResult.value);
      setPriorityIntegrityError(null);
    } else {
      setPriorityIntegrity(null);
      setPriorityIntegrityError(
        priorityResult.reason instanceof Error
          ? priorityResult.reason.message
          : String(priorityResult.reason),
      );
    }
    if (conceptResult.status === "fulfilled") {
      setConceptKnowledge(conceptResult.value);
      setConceptKnowledgeError(null);
    } else {
      setConceptKnowledge(null);
      setConceptKnowledgeError(
        conceptResult.reason instanceof Error
          ? conceptResult.reason.message
          : String(conceptResult.reason),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadActivity = useCallback(async (year?: number) => {
    if (!isDesktop()) {
      setActivityLoading(false);
      return;
    }

    const requestId = activityRequestId.current + 1;
    activityRequestId.current = requestId;
    setActivityLoading(true);
    try {
      const res = await appApi.getReviewActivity(year === undefined ? undefined : { year });
      if (activityRequestId.current !== requestId) return;
      setActivity(res);
      setActivityError(null);
    } catch (e) {
      if (activityRequestId.current !== requestId) return;
      setActivity(null);
      setActivityError(e instanceof Error ? e.message : String(e));
    } finally {
      if (activityRequestId.current === requestId) {
        setActivityLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    if (!priorityIntegrity) return;
    if (window.location.hash !== "#priority-integrity") return;
    priorityIntegrityRef.current?.scrollIntoView({ block: "start" });
    priorityIntegrityRef.current?.focus();
  }, [priorityIntegrity]);

  // Re-read after a global undo (⌘Z) reverts a mutation elsewhere so the numbers
  // stay live without a manual refresh.
  useEffect(() => {
    const handler = () => {
      void load();
      void loadActivity(activity?.year);
    };
    window.addEventListener(UNDO_EVENT, handler);
    return () => window.removeEventListener(UNDO_EVENT, handler);
  }, [activity?.year, load, loadActivity]);

  if (!desktop) {
    return (
      <div className="an-shell" data-testid="route-analytics">
        <div className="an-empty">
          <div className="an-empty__icon">
            <Icon name="analytics" size={26} />
          </div>
          <h1 className="an-empty__title">{t("collection.m94c116ee118a")}</h1>
          <p className="an-empty__body">{t("collection.m33c0bc2f98c9")}</p>
        </div>
      </div>
    );
  }

  const sparkData = data?.reviewsByDay ?? [];
  const sparkMax = sparkData.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="an-shell" data-testid="route-analytics">
      <div className="an-head">
        <div>
          <h1 className="an-title">{t("collection.m94c116ee118a")}</h1>
          <p className="an-sub">
            {t("collection.m5240dae295e2")}
            {data?.windowDays ?? 30}
            {t("collection.m8fae8e734d61")}
          </p>
        </div>
      </div>

      {error ? (
        <p className="an-error" data-testid="analytics-error">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="an-loading" data-testid="analytics-loading">
          {t("collection.m0a5afbeee779")}
        </p>
      ) : data ? (
        <div className="an-body" data-testid="analytics-body">
          {/* Import/process balance warning (T046) — advisory; hidden when balanced. */}
          <BalanceBanner asOf={data.asOf} />

          {/* Top metric row */}
          <div className="an-metrics">
            <div className="an-metric" data-testid="metric-retention">
              <span className="an-metric__val">
                {formatRetention(data.retention30d)}
                {data.retention30d !== null ? <span className="an-metric__suffix">%</span> : null}
              </span>
              <span className="an-metric__label">{t("collection.m3b1f58d94eac")}</span>
              <span className="an-metric__sub">{t("collection.mfbd7f56839c5")}</span>
            </div>
            <div className="an-metric" data-testid="metric-reviews">
              <span className="an-metric__val">{formatCount(data.reviewsTotal)}</span>
              <span className="an-metric__label">{t("collection.m84cb7871b741")}</span>
              <span className="an-metric__sub">
                ≈ {Math.round(data.reviewsPerDayAvg)}
                {t("collection.m448a17b8a5ae")}
              </span>
            </div>
            <div className="an-metric" data-testid="metric-streak">
              <span className="an-metric__val">{formatCount(data.dayStreak)}</span>
              <span className="an-metric__label">{t("collection.m4575171b4873")}</span>
              <span className="an-metric__sub">{t("collection.m58a8947d41c9")}</span>
            </div>
            <div
              className={`an-metric${data.dueCards > 0 ? " an-metric--danger" : ""}`}
              data-testid="metric-due"
            >
              <span className="an-metric__val">{formatCount(data.dueCards)}</span>
              <span className="an-metric__label">{t("collection.mf73dfabf39a9")}</span>
              <span className="an-metric__sub">
                {formatCount(data.dueTopics)}
                {t("collection.m96c22e5ead83")}
              </span>
            </div>
          </div>

          {/* Secondary metric row — throughput + maintenance counts */}
          <div className="an-metrics an-metrics--sm">
            <div className="an-metric an-metric--sm" data-testid="metric-new-cards">
              <span className="an-metric__val">{formatCount(data.newCards)}</span>
              <span className="an-metric__label">{t("collection.m3448c00f4c8f")}</span>
            </div>
            <div className="an-metric an-metric--sm" data-testid="metric-new-extracts">
              <span className="an-metric__val">{formatCount(data.newExtracts)}</span>
              <span className="an-metric__label">{t("collection.m2fdcaf4e59f9")}</span>
            </div>
            <div className="an-metric an-metric--sm" data-testid="metric-deletions">
              <span className="an-metric__val">{formatCount(data.deletions)}</span>
              <span className="an-metric__label">{t("collection.m1535d13590fe")}</span>
            </div>
            <div className="an-metric an-metric--sm" data-testid="metric-leeches">
              <span className="an-metric__val">{formatCount(data.leeches)}</span>
              <span className="an-metric__label">{t("collection.meb105f601c13")}</span>
            </div>
            <div className="an-metric an-metric--sm" data-testid="metric-retired">
              <span className="an-metric__val">{formatCount(data.retired)}</span>
              <span className="an-metric__label">{t("collection.ma9f71bc2404c")}</span>
            </div>
          </div>

          <ReviewActivityHeatmap
            activity={activity}
            loading={activityLoading}
            error={activityError}
            onYearSelect={(year) => void loadActivity(year)}
          />

          <PriorityIntegrityPanel
            ref={priorityIntegrityRef}
            data={priorityIntegrity}
            error={priorityIntegrityError}
          />

          <ConceptRetentionPanel
            data={conceptKnowledge}
            error={conceptKnowledgeError}
            onOpenConcept={(conceptId) => void navigate({ to: "/concepts", search: { conceptId } })}
          />

          {/* Reviews per day spark */}
          <div className="an-panel">
            <div className="an-panel__head">
              <span className="an-panel__title">{t("collection.m7644c030c481")}</span>
              <span className="an-panel__meta">
                {data.windowDays}
                {t("collection.mb1c503166f16")}
              </span>
            </div>
            <div className="an-spark" data-testid="analytics-spark">
              {sparkData.map((d, i) => (
                <span
                  key={d.date}
                  className={
                    i === sparkData.length - 1 && d.count > 0
                      ? "an-spark__bar an-spark__bar--hot"
                      : "an-spark__bar"
                  }
                  title={`${d.date}: ${d.count}`}
                  style={{ height: `${sparkMax > 0 ? (d.count / sparkMax) * 100 : 0}%` }}
                />
              ))}
            </div>
          </div>

          {/* System health banners */}
          <div className="an-panel">
            <div className="an-panel__head">
              <span className="an-panel__title">{t("collection.m982649422d26")}</span>
            </div>
            <div className="an-banners">
              {data.leeches > 0 ? (
                <button
                  type="button"
                  className="an-banner"
                  data-testid="banner-leeches"
                  onClick={() => void navigate({ to: "/maintenance/leeches" })}
                >
                  <Icon name="leech" size={16} />
                  <span className="an-banner__title">
                    {data.leeches}
                    {t("collection.mfee065c45b93")}
                    {data.leeches === 1 ? "" : t("collection.mc0bc1e08f974")}
                    {t("collection.mf0b074ee71a3")}
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : null}
              {data.deletions > 0 ? (
                <button
                  type="button"
                  className="an-banner"
                  data-testid="banner-deletions"
                  onClick={() => void navigate({ to: "/trash" })}
                >
                  <Icon name="trash" size={16} />
                  <span className="an-banner__title">
                    {data.deletions}
                    {t("collection.ma5f3c2e9f903")}
                    {i18n.language.startsWith("zh") ? "" : data.deletions === 1 ? "" : "s"}
                    {t("collection.med12f4545575")}
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : null}
              {data.retired > 0 ? (
                <button
                  type="button"
                  className="an-banner"
                  data-testid="banner-retired"
                  onClick={() => void navigate({ to: "/maintenance/retired" })}
                >
                  <Icon name="archive" size={16} />
                  <span className="an-banner__title">
                    {data.retired}
                    {t("collection.m231dc938e524")}
                    {i18n.language.startsWith("zh") ? "" : data.retired === 1 ? "" : "s"}
                    {t("collection.m7723bc0e0417")}
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : null}
              {/* Low-yield sources (T083) — links to the ranked per-source yield view. */}
              {lowYieldCount > 0 ? (
                <button
                  type="button"
                  className="an-banner"
                  data-testid="banner-source-yield"
                  onClick={() => void navigate({ to: "/analytics/sources" })}
                >
                  <Icon name="library" size={16} />
                  <span className="an-banner__title">
                    {lowYieldCount}
                    {t("collection.m3bd086400238")}
                    {i18n.language.startsWith("zh") ? "" : lowYieldCount === 1 ? "" : "s"}
                    {t("collection.mf721653f66a3")}
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : null}
              {/* Stagnant extracts (T084) — links to the stagnant-extracts maintenance view. */}
              {stagnantCount > 0 ? (
                <button
                  type="button"
                  className="an-banner"
                  data-testid="banner-stagnant"
                  onClick={() => void navigate({ to: "/maintenance/stagnant" })}
                >
                  <Icon name="hourglass" size={16} />
                  <span className="an-banner__title">
                    {stagnantCount}
                    {t("collection.mf860406ea72a")}
                    {i18n.language.startsWith("zh") ? "" : stagnantCount === 1 ? "" : "s"}
                    {t("collection.m6a135820f4ba")}
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ) : null}
              {data.leeches === 0 &&
              data.deletions === 0 &&
              lowYieldCount === 0 &&
              stagnantCount === 0 ? (
                <div className="an-banner an-banner--ok" data-testid="banner-healthy">
                  <Icon name="checkCircle" size={16} />
                  <span className="an-banner__title">{t("collection.m84f56c954407")}</span>
                </div>
              ) : null}
              {/* The Maintenance hub (T099) — always available: duplicates, orphan media,
                  broken sources, lineage gaps, DB + vault integrity for a large collection. */}
              <button
                type="button"
                className="an-banner"
                data-testid="banner-maintenance"
                onClick={() => void navigate({ to: "/maintenance" })}
              >
                <Icon name="shield" size={16} />
                <span className="an-banner__title">{t("collection.m3658f42df142")}</span>
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
