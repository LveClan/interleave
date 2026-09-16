/**
 * Help / onboarding shared primitives (design handoff — "Incremental Reading.html").
 *
 * Small token-faithful building blocks the onboarding + help-center surfaces are
 * built from. They are deliberately self-contained (the renderer has no generic
 * `Btn`/`Segmented`/`Pipeline` yet) and their styling lives in `help.css` /
 * `onboarding.css`, scoped under the `.welcome`/`.coach`/`.hc`/`.tour-rail` roots
 * so the generic class names never leak into the rest of the app.
 *
 * Presentation-only: no domain logic, no `window.appApi`.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { t, useLocale } from "../i18n";

/** Join truthy class names (the kit's `cx`). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "ghost" | "soft" | "danger";
type BtnSize = "sm" | "lg";

export type BtnProps = {
  variant?: BtnVariant | undefined;
  size?: BtnSize | undefined;
  icon?: IconName | undefined;
  iconRight?: IconName | undefined;
  block?: boolean | undefined;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** The kit's `.btn` (scoped to help/onboarding roots in CSS). */
export function Btn({
  variant,
  size,
  icon,
  iconRight,
  block,
  children,
  className,
  type = "button",
  ...rest
}: BtnProps) {
  useLocale();
  return (
    <button
      type={type}
      className={cx(
        "btn",
        variant && `btn--${variant}`,
        size && `btn--${size}`,
        !children && "btn--icon",
        block && "btn--block",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
};

/** The kit's `.segmented` toggle (used for the welcome theme picker). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  useLocale();
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx("seg", value === o.value && "seg--on")}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The north-star refinery stepper: Source → Extract → Clean → Atomic → Card →
 * Mature. `active` highlights the current stage; earlier stages render as "done".
 * Used in the welcome modal and the help center's `pipeline` figure.
 */
export const PIPELINE_STEPS: ReadonlyArray<{ key: string; icon: IconName; label: string }> = [
  {
    key: "source",
    icon: "source",
    get label() {
      return t("options.m0e570ca6fabe");
    },
  },
  {
    key: "extract",
    icon: "extract",
    get label() {
      return t("options.mc15301c0e647");
    },
  },
  {
    key: "clean",
    icon: "highlight",
    get label() {
      return t("options.m5137c8760c94");
    },
  },
  {
    key: "atomic",
    icon: "target",
    get label() {
      return t("options.m3a3cdc6b5e92");
    },
  },
  {
    key: "card",
    icon: "card",
    get label() {
      return t("options.mbe3702e3f1af");
    },
  },
  {
    key: "mature",
    icon: "brain",
    get label() {
      return t("options.m2cc08418a5a0");
    },
  },
];

/**
 * `active` highlights the current stage (earlier stages render "done"). Pass
 * `null` for a NEUTRAL diagram — every stage uniform — used by the help center's
 * `pipeline` figure, where no single stage is "current" and the green done-state
 * would clash with the otherwise blue-accented, restrained help surface.
 */
export function Pipeline({ active = "extract" }: { active?: string | null }) {
  useLocale();
  const ai =
    active == null
      ? -1
      : Math.max(
          0,
          PIPELINE_STEPS.findIndex((s) => s.key === active),
        );
  return (
    <div className="pipeline">
      {PIPELINE_STEPS.map((s, i) => (
        <div
          key={s.key}
          className={cx("pipe-step", i < ai && "pipe-step--done", i === ai && "pipe-step--on")}
        >
          <span className="pipe-step__dot">
            <Icon name={s.icon} size={14} />
          </span>
          <span className="pipe-step__lbl">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
