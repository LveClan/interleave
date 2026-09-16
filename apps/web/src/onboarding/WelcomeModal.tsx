/**
 * First-run welcome modal (design handoff — "Incremental Reading.html").
 *
 * Step 0 of onboarding: names the loop, pre-empts the three misconceptions, lets
 * the user pick a theme, and offers four exits — start the guided tour, import
 * their own source, explore alone, or skip and turn off contextual tips. Shown
 * once on first launch; the Shell owns the `ui.seenOnboarding` flag persistence.
 *
 * Presentation-only.
 */
import { useEffect } from "react";
import { Icon } from "../components/Icon";
import { Btn, Pipeline, Segmented } from "../help/primitives";
import { t, useLocale } from "../i18n";
import type { Theme } from "../theme";
import "./onboarding.css";

export function WelcomeModal({
  open,
  theme,
  onPickTheme,
  onStartTour,
  onImport,
  onExplore,
  onDisableTips,
}: {
  open: boolean;
  theme: Theme;
  onPickTheme: (theme: Theme) => void;
  onStartTour: () => void;
  onImport: () => void;
  onExplore: () => void;
  onDisableTips: () => void;
}) {
  useLocale();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExplore();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onExplore]);

  if (!open) return null;

  return (
    <div className="welcome-overlay" data-testid="welcome-modal">
      <div
        className="welcome"
        role="dialog"
        aria-modal="true"
        aria-label={t("details.mfdddc965c4ae")}
      >
        <span className="welcome__eyebrow">
          <Icon name="shield" size={13} />
          {t("details.m40573ec21458")}
        </span>
        <h1 className="welcome__title">{t("details.m394093d8d9fa")}</h1>
        <p className="welcome__lede">
          {t("details.m609d08e0e8d6")} <b>{t("details.md8fb319d566a")}</b>
          {t("details.mcddddf98e0d2")}
        </p>

        <div className="welcome__pipeline">
          <Pipeline active="extract" />
          <div className="welcome__pipeline-cap">{t("details.mcb0954ec2a5e")}</div>
        </div>

        <div className="welcome__myths">
          <div className="myth">
            <span className="myth__x">
              <Icon name="x" size={11} />
            </span>
            <span>
              <b>{t("details.mbaa565991f74")}</b>
              {t("details.m64b4d763c4a5")}
            </span>
          </div>
          <div className="myth">
            <span className="myth__x">
              <Icon name="x" size={11} />
            </span>
            <span>
              <b>{t("details.m77dc93defc01")}</b>
              {t("details.ma4518ee1412f")}
            </span>
          </div>
          <div className="myth">
            <span className="myth__x">
              <Icon name="x" size={11} />
            </span>
            <span>
              <b>{t("details.mfe2ffc2617c5")}</b>
              {t("details.m37377b919054")}
            </span>
          </div>
        </div>

        <div className="welcome__theme">
          <span className="welcome__theme-label">{t("details.m3907fa7f8072")}</span>
          <Segmented<Theme>
            value={theme}
            onChange={onPickTheme}
            options={[
              {
                value: "system",
                get label() {
                  return t("options.m6725e7bbcd28");
                },
                icon: "system",
              },
              {
                value: "light",
                get label() {
                  return t("options.mdbcd5e7bb7a0");
                },
                icon: "sun",
              },
              {
                value: "dark",
                get label() {
                  return t("options.m60acc53f13a5");
                },
                icon: "moon",
              },
            ]}
          />
        </div>

        <div className="welcome__actions">
          <Btn variant="primary" size="lg" icon="play" block onClick={onStartTour}>
            {t("details.me32c8ffa3225")}
          </Btn>
          <div className="welcome__row2">
            <Btn icon="upload" onClick={onImport}>
              {t("details.m4d667dd60bf8")}
            </Btn>
            <Btn variant="ghost" onClick={onExplore}>
              {t("details.maa8ac12d50f4")}
            </Btn>
          </div>
        </div>
        <div className="welcome__skip">
          <button type="button" onClick={onDisableTips}>
            Skip &amp; turn off contextual tips
          </button>
        </div>
      </div>
    </div>
  );
}
