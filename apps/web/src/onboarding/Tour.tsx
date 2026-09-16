/**
 * First-run guided tour (design handoff — "Incremental Reading.html").
 *
 * A scripted, just-in-time walk over the real screens that teaches the whole loop:
 * the two schedulers → get a source → read & set a read-point → extract (the
 * pivotal gesture) → distill & card → review → hand off to the command center.
 * Each step changes route and anchors a Coachmark to a real `[data-coach]` control
 * (gracefully centering when the control isn't on screen). The Shell owns the
 * index + route driving; this module owns the step content and the rail/coach UI.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Coachmark, type Placement } from "../help/Contextual";
import { cx } from "../help/primitives";
import { t, useLocale } from "../i18n";
import { Kbd } from "../shell/Kbd";

export interface TourStep {
  key: string;
  name: string;
  /** Real renderer route to show for this step. */
  route: string;
  /** `[data-coach=…]` anchor on that route, or null to center. */
  target: string | null;
  placement: Placement;
  icon: IconName;
  eyebrow: string;
  title: string;
  body: ReactNode;
  demo?: ReactNode;
}

function SchedulerDemo() {
  useLocale();
  return (
    <div className="primer">
      <div className="primer__col">
        <span className="sched sched--fsrs">
          <Icon name="brain" size={14} /> <b>92%</b>
          {t("details.ma3eaa465ea5d")}
        </span>
        <span className="primer__q">{t("details.m8b2f3bd5d595")}</span>
        <span className="primer__who">{t("details.m164a490f5c0d")}</span>
      </div>
      <div className="primer__col">
        <span className="sched sched--attn">
          <Icon name="gauge" size={14} />
          {t("details.m24282f764a4d")}
        </span>
        <span className="primer__q">{t("details.md3ea1103db56")}</span>
        <span className="primer__who">Sources &amp; extracts</span>
      </div>
    </div>
  );
}

function ExtractDemo() {
  useLocale();
  return (
    <div className="coach__demo">
      <div className="coach__demo-card">
        <b style={{ color: "var(--el-extract)" }}>
          <Icon name="extract" size={14} />
          {t("details.m6874e92c88df")}
          <Kbd keys="E" />
        </b>
        <span>{t("details.mf1e3c2d719d0")}</span>
      </div>
      <div className="coach__demo-card">
        <b style={{ color: "oklch(0.62 0.13 95)" }}>
          <Icon name="highlight" size={14} />
          {t("details.mec017f02d783")}
          <Kbd keys="H" />
        </b>
        <span>{t("details.m9c1f56735bbf")}</span>
      </div>
    </div>
  );
}

export function getTourSteps(): TourStep[] {
  return [
    {
      key: "schedulers",
      name: "Two clocks",
      route: "/queue",
      target: null,
      placement: "center",
      icon: "gauge",
      eyebrow: "The one idea to hold",
      get title() {
        return t("supplement.me67c8771bc1c");
      },
      demo: <SchedulerDemo />,
      body: (
        <>
          {t("details.md3ad4ee914da")} <b>{t("details.ma52fcbbc3364")}</b>
          {t("details.mab080596b417")}
          <b>{t("details.m9d1ea5d8723c")}</b>
          {t("details.m58f0e3f6d923")}
        </>
      ),
    },
    {
      key: "source",
      name: "Get a source",
      route: "/inbox",
      target: '[data-coach="import"]',
      placement: "bottom",
      icon: "inbox",
      eyebrow: "Step 2 · Capture",
      get title() {
        return t("supplement.m8ef4e1b8afb2");
      },
      body: (
        <>
          {t("details.m12419a5e554a")}
          <b>{t("details.m254bb97b57f1")}</b>
          {t("details.m7b1fc64f252f")} <b>C</b>
          {t("details.m8ddc793cefef")}
        </>
      ),
    },
    {
      key: "read",
      name: "Read a little",
      route: "/inbox",
      target: null,
      placement: "center",
      icon: "bookmark",
      eyebrow: "Step 3 · Incremental reading",
      get title() {
        return t("supplement.m6959270def0f");
      },
      body: (
        <>
          {t("details.m0275bb3f16ea")}
          <Kbd keys="␣" />
          {t("details.m5be14e362479")}
        </>
      ),
    },
    {
      key: "extract",
      name: "Extract",
      route: "/inbox",
      target: null,
      placement: "center",
      icon: "extract",
      eyebrow: "Step 4 · The pivotal gesture",
      get title() {
        return t("supplement.mb21b2ad3cb7b");
      },
      demo: <ExtractDemo />,
      body: (
        <>
          {t("details.mbe175d426933")}{" "}
          <b>
            {t("details.m3c97faf97ccb")}
            <Kbd keys="E" />
          </b>{" "}
          {t("details.m7b1b96f734cf")}{" "}
          <b>
            {t("details.m32870bd02c07")}
            <Kbd keys="H" />
          </b>{" "}
          {t("details.m0f5297285ac9")}
        </>
      ),
    },
    {
      key: "distill",
      name: "Distill & card",
      route: "/queue",
      target: null,
      placement: "center",
      icon: "sparkle",
      eyebrow: "Step 5 · Refine",
      get title() {
        return t("supplement.m60430f016198");
      },
      body: (
        <>
          {t("details.m757843d376bc")}
          <b>{t("details.m572abcbf8e95")}</b>
          {t("details.mfa7a6520e7b4")}
        </>
      ),
    },
    {
      key: "review",
      name: "Review",
      route: "/review",
      target: '[data-coach="review-card"]',
      placement: "center",
      icon: "review",
      eyebrow: "Step 6 · Close the loop",
      get title() {
        return t("supplement.mb51f98f03334");
      },
      body: (
        <>
          {t("details.m81145a66ef26")}
          <Kbd keys="␣" />
          {t("details.mc021cc249326")}
          <b>1–4</b>
          {t("details.mc8f930af7343")}
          <b>{t("details.mf72894d8fbb3")}</b>
          {t("details.m5153d3851956")}
        </>
      ),
    },
    {
      key: "handoff",
      name: "You’re set",
      route: "/queue",
      target: '[data-coach="start-session"]',
      placement: "bottom",
      icon: "check",
      eyebrow: "That’s the whole loop",
      get title() {
        return t("supplement.mbed96967210b");
      },
      body: (
        <>
          {t("details.m8c784f03f56d")} <b>{t("details.mb1c52ee3677d")}</b>
          {t("details.m848bd74c2b03")}
          <Kbd keys="?" />
          {t("details.ma5e8b320ace3")} <Kbd keys={["⌘", "K"]} />
          {t("details.m51c44bee0eb4")}
        </>
      ),
    },
  ];
}

export function TourLayer({
  index,
  onNext,
  onPrev,
  onSkip,
}: {
  index: number | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  useLocale();
  const steps = getTourSteps();
  if (index == null || index < 0 || index >= steps.length) return null;
  const s = steps[index];
  if (!s) return null;
  const total = steps.length;
  return (
    <>
      <div className="tour-rail">
        <div className="tour-rail__label">
          <span className="tour-rail__step">{t("details.m8ef7823ca89b")}</span>
          <span className="tour-rail__name">{s.name}</span>
        </div>
        <div className="tour-rail__track">
          {steps.map((step, i) => (
            <span
              key={step.key}
              className={cx(
                "tour-rail__seg",
                i < index && "tour-rail__seg--done",
                i === index && "tour-rail__seg--on",
              )}
            />
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onSkip}>
          {t("details.m1bb6c2bb5cce")}
        </button>
      </div>
      <Coachmark
        key={s.key}
        targetSel={s.target}
        placement={s.placement}
        backdrop
        icon={s.icon}
        eyebrow={s.eyebrow}
        title={s.title}
        demo={s.demo || null}
        step={index}
        total={total}
        onNext={onNext}
        onPrev={onPrev}
        nextLabel={index === total - 1 ? "Finish" : "Next"}
      >
        {s.body}
      </Coachmark>
    </>
  );
}
