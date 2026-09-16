import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { TypeIcon } from "../../components/inspector/primitives";
import { i18n, t, useLocale } from "../../i18n";
import {
  appApi,
  type QueueSessionPlanRequest,
  type QueueSessionPlanResult,
} from "../../lib/appApi";
import { sessionMinuteLabel } from "../../lib/queueTimeEstimate";

const PRESETS = [15, 25, 45] as const;

/**
 * Budget-meter / chip categories. Distillation = due Extract work (attention
 * scheduler), Cards = FSRS active recall, Other work = sources / topics / tasks.
 * Colors come from the element-type tokens so the meter matches each row's
 * `TypeIcon` tone.
 */
const CATEGORIES = [
  {
    minutesKey: "distillationMinutes",
    get label() {
      return t("options.me68a9a3d4152");
    },
    color: "var(--el-extract)",
  },
  {
    minutesKey: "cardMinutes",
    get label() {
      return t("options.ma52fcbbc3364");
    },
    color: "var(--el-card)",
  },
  {
    minutesKey: "otherMinutes",
    get label() {
      return t("options.m47f776453fbe");
    },
    color: "var(--el-source)",
  },
] as const;

export function SessionAssemblyPreview({
  open,
  asOf,
  defaultTargetMinutes,
  request,
  onClose,
}: {
  open: boolean;
  asOf?: string;
  defaultTargetMinutes: number;
  request?: Omit<QueueSessionPlanRequest, "targetMinutes">;
  onClose: () => void;
}) {
  useLocale();
  const navigate = useNavigate();
  const titleId = useId();
  const [target, setTarget] = useState(defaultTargetMinutes);
  const [plan, setPlan] = useState<QueueSessionPlanResult | null>(null);
  const [planRequestKey, setPlanRequestKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const loadSeqRef = useRef(0);
  const invalid = !Number.isFinite(target) || !Number.isInteger(target) || target < 0;

  const fullRequest = useMemo<QueueSessionPlanRequest | null>(() => {
    if (invalid) return null;
    return {
      ...(request ?? {}),
      ...(asOf ? { asOf } : {}),
      targetMinutes: target,
    };
  }, [asOf, invalid, request, target]);
  const requestKey = useMemo(
    () => (fullRequest ? JSON.stringify(fullRequest) : null),
    [fullRequest],
  );

  // Request shape shared by every preset preview (everything but the time box),
  // derived from a stable JSON key so it keeps a constant identity across the
  // panel's own re-renders AND across parent re-renders that hand us a fresh
  // `request` object literal (both mount sites do). Keying on the parsed-from-
  // string value — not the raw memo of an unstable prop — is what stops the
  // preset previews from refetching (and blanking each card's consequence) on
  // every unrelated parent render; they refetch only when filters/clock change.
  const baseRequestKey = useMemo(
    () => JSON.stringify({ ...(request ?? {}), ...(asOf ? { asOf } : {}) }),
    [asOf, request],
  );
  const baseRequest = useMemo<Omit<QueueSessionPlanRequest, "targetMinutes">>(
    () => JSON.parse(baseRequestKey),
    [baseRequestKey],
  );

  const load = useCallback(async () => {
    if (!open || !fullRequest || !requestKey) return;
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    setLoading(true);
    setPlan(null);
    setPlanRequestKey(null);
    setError(null);
    try {
      const next = await appApi.previewSessionPlan(fullRequest);
      if (loadSeqRef.current !== seq) return;
      setPlan(next);
      setPlanRequestKey(requestKey);
      window.setTimeout(() => statusRef.current?.focus(), 0);
    } catch (e) {
      if (loadSeqRef.current !== seq) return;
      setPlan(null);
      setPlanRequestKey(null);
      setError(e instanceof Error ? e.message : String(e));
      window.setTimeout(() => statusRef.current?.focus(), 0);
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [fullRequest, open, requestKey]);

  // Best-effort per-preset previews that power each card's "N items / X% full"
  // consequence. Seq-guarded like `load`; failures are swallowed because the
  // main load owns the visible error surface.
  const [presetOutcomes, setPresetOutcomes] = useState<ReadonlyMap<number, QueueSessionPlanResult>>(
    () => new Map(),
  );
  const presetSeqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const seq = presetSeqRef.current + 1;
    presetSeqRef.current = seq;
    setPresetOutcomes(new Map());
    for (const minutes of PRESETS) {
      void appApi
        .previewSessionPlan({ ...baseRequest, targetMinutes: minutes })
        .then((result) => {
          if (presetSeqRef.current !== seq) return;
          setPresetOutcomes((prev) => {
            const nextMap = new Map(prev);
            nextMap.set(minutes, result);
            return nextMap;
          });
        })
        .catch(() => undefined);
    }
    // Invalidate any still-in-flight previews when the deps change or the panel
    // unmounts, so a late resolve can never write stale preset meta.
    return () => {
      presetSeqRef.current += 1;
    };
  }, [baseRequest, open]);

  useEffect(() => {
    if (!open) return;
    setTarget(defaultTargetMinutes);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [defaultTargetMinutes, open]);

  useEffect(() => {
    if (!open || invalid) return;
    void load();
  }, [invalid, load, open]);

  if (!open) return null;

  const approximate = plan?.usesDefaultEstimate ?? false;
  const planReady = !!plan && planRequestKey === requestKey;
  const canStart = planReady && (plan?.items.length ?? 0) > 0 && !loading && !confirming;
  const compositionCopy = plan ? sessionCompositionCopy(plan) : null;
  // `composition` is required on the live result, but stay tolerant of plans
  // that omit it (older fixtures / partial mocks) so the meter degrades to "no
  // breakdown" instead of crashing the panel.
  const composition = plan?.composition ?? null;
  const isPresetActive = (PRESETS as readonly number[]).includes(target);
  const mainRole = invalid || error ? "alert" : "status";

  const pctOf = (minutes: number): string => {
    if (!plan || plan.targetMinutes <= 0) return "0%";
    return `${Math.min(100, (minutes / plan.targetMinutes) * 100)}%`;
  };
  const freeMinutes = plan ? Math.max(0, Math.round(plan.targetMinutes - plan.plannedMinutes)) : 0;
  const showFloor =
    !!plan &&
    !!composition &&
    composition.status === "active" &&
    composition.quotaFloorMinutes > 0 &&
    composition.quotaFloorMinutes < plan.targetMinutes;

  return (
    <section className="q-session-preview" data-testid="session-preview" aria-labelledby={titleId}>
      <div className="q-session-preview__head">
        <div>
          <h2 id={titleId} className="q-session-preview__title">
            {t("learning.m4b564f5f3704")}
          </h2>
          <p className="q-session-preview__sub">{t("learning.m0034f7ade1af")}</p>
        </div>
        <button
          type="button"
          className="q-session-preview__close"
          aria-label={t("learning.m8a59dadf05d1")}
          onClick={onClose}
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="q-session-preview__split">
        <div className="q-session-preview__rail">
          <fieldset className="q-session-preview__presets">
            <legend className="q-session-preview__rail-label">{t("learning.m933be42a1f31")}</legend>
            <div className="q-session-preview__cards">
              {PRESETS.map((minutes) => {
                const outcome = presetOutcomes.get(minutes);
                const items = outcome
                  ? `${outcome.plannedCount} item${i18n.language.startsWith("zh") ? "" : outcome.plannedCount === 1 ? "" : "s"}`
                  : null;
                const pct =
                  outcome && outcome.targetMinutes > 0
                    ? Math.round((outcome.plannedMinutes / outcome.targetMinutes) * 100)
                    : null;
                const meta = items ? (pct === null ? items : `${items} · ${pct}% full`) : " ";
                return (
                  <button
                    key={minutes}
                    type="button"
                    className={`q-session-preview__card${target === minutes ? " q-session-preview__card--on" : ""}`}
                    aria-pressed={target === minutes}
                    onClick={() => setTarget(minutes)}
                  >
                    <span className="q-session-preview__card-min">
                      {minutes}
                      <i>{t("learning.m1f6fa6f69d18")}</i>
                    </span>
                    <span className="q-session-preview__card-meta">{meta}</span>
                  </button>
                );
              })}
              <label
                className={`q-session-preview__card${isPresetActive ? "" : " q-session-preview__card--on"}`}
              >
                <span className="q-session-preview__card-min">
                  <input
                    ref={inputRef}
                    data-testid="session-target-minutes"
                    aria-label={t("learning.m23e7fd23cbc3")}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    step={1}
                    value={target}
                    onChange={(event) => setTarget(Number(event.currentTarget.value))}
                  />
                  <i>{t("learning.m1f6fa6f69d18")}</i>
                </span>
                <span className="q-session-preview__card-meta">{t("learning.ma5e53b222914")}</span>
              </label>
            </div>
          </fieldset>

          {!invalid && plan && composition ? (
            <>
              <div className="q-session-preview__meter">
                <div className="q-session-preview__meter-head">
                  <span>
                    <b>{sessionMinuteLabel(plan.plannedMinutes, approximate)}</b>
                    {t("learning.m5ed0f9bb209c")}
                  </span>
                  <span className="q-session-preview__meter-free">
                    {freeMinutes > 0
                      ? t("learning.m7cba295a27f0", { value1: String(freeMinutes) })
                      : t("learning.mb1d61188a9aa")}
                  </span>
                </div>
                <div className="q-session-preview__bar">
                  {CATEGORIES.map((category) => (
                    <div
                      key={category.label}
                      className="q-session-preview__bar-seg"
                      style={{
                        width: pctOf(composition[category.minutesKey]),
                        background: category.color,
                      }}
                    />
                  ))}
                  <div
                    className="q-session-preview__bar-free"
                    style={{ width: pctOf(freeMinutes) }}
                  />
                  {showFloor ? (
                    <span
                      className="q-session-preview__floor"
                      style={{ left: pctOf(composition.quotaFloorMinutes) }}
                    >
                      <i />
                      <em>
                        {t("learning.me6f88d9d3a5b")}
                        {composition.quotaFloorMinutes}m
                      </em>
                    </span>
                  ) : null}
                </div>
                <div className="q-session-preview__chips">
                  {CATEGORIES.filter((category) => composition[category.minutesKey] > 0).map(
                    (category) => (
                      <span className="q-session-preview__chip" key={category.label}>
                        <span
                          className="q-session-preview__dot"
                          style={{ background: category.color }}
                        />
                        {category.label} <b>{Math.round(composition[category.minutesKey])}m</b>
                      </span>
                    ),
                  )}
                </div>
              </div>

              {composition.status === "active" ? (
                <p className="q-session-preview__floornote">
                  <Icon name="flame" size={12} />
                  {t("learning.mea2c9f4b00ab")}
                  {composition.quotaFloorMinutes}
                  {t("learning.maca71a39f275")}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div
          ref={statusRef}
          tabIndex={-1}
          className="q-session-preview__main"
          role={mainRole}
          {...(mainRole === "status" ? { "aria-live": "polite" as const } : {})}
        >
          {invalid ? (
            <div
              className="q-session-preview__state q-session-preview__state--error"
              data-testid="session-preview-error"
            >
              {t("learning.m281bd5108f35")}
            </div>
          ) : loading ? (
            <div className="q-session-preview__state">{t("learning.md0f1b8de1e70")}</div>
          ) : error ? (
            <div
              className="q-session-preview__state q-session-preview__state--error"
              data-testid="session-preview-error"
            >
              {error}
            </div>
          ) : plan ? (
            <>
              {compositionCopy ? (
                <p className="sr-only" data-testid="session-composition">
                  {compositionCopy}
                </p>
              ) : null}
              <div className="q-session-preview__summary">
                <span className="q-session-preview__summary-title">
                  {t("learning.maf56fe657b85")}
                  <b>{plan.plannedCount}</b>
                  {t("learning.ma4282e4b2298")}
                  {plan.candidateCount}
                  {t("learning.mc22d64101ff5")}
                  {i18n.language.startsWith("zh") ? "" : plan.candidateCount === 1 ? "" : "s"}
                </span>
                <strong className="q-session-preview__total" data-testid="session-planned-minutes">
                  {sessionMinuteLabel(plan.plannedMinutes, approximate)}
                </strong>
              </div>
              {plan.overTarget ? (
                <p className="q-session-preview__note">{t("learning.mee26ae83fcbb")}</p>
              ) : approximate ? (
                <p className="q-session-preview__note">{t("learning.m310f8430708d")}</p>
              ) : null}

              {plan.items.length === 0 ? (
                <div className="q-session-preview__empty">{t("learning.m11edba3d8f48")}</div>
              ) : (
                <ul className="q-session-preview__list" aria-label={t("learning.m3821159569b7")}>
                  {plan.items.map((row) => (
                    <li key={row.item.id} className="q-session-preview__row">
                      <TypeIcon type={row.item.type} />
                      <span className="q-session-preview__row-title" title={row.item.title}>
                        {row.item.title}
                      </span>
                      <span
                        className="q-session-preview__row-est"
                        data-testid="session-planned-row-minutes"
                      >
                        {sessionMinuteLabel(
                          row.estimatedMinutes,
                          row.estimateConfidence === "default",
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="q-session-preview__leftout">
                <div className="q-session-preview__leftout-head" data-testid="session-cut-list">
                  <span data-testid="session-cut-count">
                    {t("learning.m6b2c8f4e6639")}
                    {plan.cut.totalCount}
                    {t("learning.ma5f3c2e9f903")}
                    {i18n.language.startsWith("zh") ? "" : plan.cut.totalCount === 1 ? "" : "s"}
                  </span>
                  <strong>{sessionMinuteLabel(plan.cut.totalMinutes, approximate)}</strong>
                </div>
                {plan.cut.items.length > 0 ? (
                  <ul className="q-session-preview__list" aria-label={t("learning.m597f31b28995")}>
                    {plan.cut.items.map((row) => (
                      <li
                        key={row.item.id}
                        className="q-session-preview__row q-session-preview__row--out"
                      >
                        <TypeIcon type={row.item.type} />
                        <span className="q-session-preview__row-title" title={row.item.title}>
                          {row.item.title}
                        </span>
                        <span className="q-session-preview__tag">
                          <Icon name="ban" size={11} />
                          {row.reason === "did_not_fit" ? t("learning.m9d69cfceeff6") : row.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="q-session-preview__foot">
        <button
          type="button"
          className="q-session-preview__btn q-session-preview__btn--ghost"
          disabled={confirming}
          onClick={onClose}
        >
          {t("learning.m0ef70263b054")}
        </button>
        <button
          type="button"
          className="q-session-preview__btn q-session-preview__btn--primary"
          data-testid="session-preview-start"
          disabled={!canStart}
          onClick={() => {
            if (!plan || planRequestKey !== requestKey) return;
            setConfirming(true);
            // Non-binding: the forecast is informational. Starting just opens the live
            // queue with the chosen time box as the gauge's reference line (?target=) —
            // no frozen deck is stored, so a reload/back can never "expire" a session.
            void navigate({
              to: "/process",
              search: { ...(asOf ? { asOf } : {}), target },
            });
          }}
        >
          <Icon name="play" size={14} />
          {t("learning.m23b7532db30a")}
        </button>
      </div>
    </section>
  );
}

function sessionCompositionCopy(plan: QueueSessionPlanResult): string | null {
  const { composition } = plan;
  if (!composition) return null;
  if (composition.status === "unavailable_no_time_estimate") return null;
  let first: string;
  if (composition.status === "active") {
    first = `Distillation floor active: ${composition.quotaFloorMinutes} min reserved.`;
  } else if (composition.status === "returned_empty_backlog") {
    first = "Distillation share returned: no due extracts.";
  } else if (composition.status === "inactive_filtered_out") {
    return "Current filter: distillation quota inactive.";
  } else {
    return "Distillation floor off.";
  }
  const other = composition.otherMinutes
    ? `, ${Math.round(composition.otherMinutes)} min other work`
    : "";
  return `${first} Planned ${Math.round(composition.distillationMinutes)} min distillation, ${Math.round(
    composition.cardMinutes,
  )} min cards${other}.`;
}
