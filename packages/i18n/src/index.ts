import { createInstance, type i18n, type TFunction } from "i18next";

export type { i18n as I18n, TFunction } from "i18next";

import { type english, type LanguageDefinition, languages } from "./resources";

export { english, type LanguageDefinition, languages, type Messages } from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof english };
    strictKeyChecks: true;
    returnNull: false;
    enableSelector: false;
  }
}

export interface LocaleState {
  readonly preference: string;
  readonly locale: string;
  readonly systemLocale: string;
}

/** Normalize system tags without letting corrupt preferences reach Intl. */
export function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value.replaceAll("_", "-"))[0] ?? null;
  } catch {
    return null;
  }
}

export function resolveLocale(
  preference: string,
  systemLocale: string,
  available: readonly LanguageDefinition[] = languages,
): string {
  const requested = canonicalLocale(preference === "system" ? systemLocale : preference);
  if (!requested) return "en";
  const exact = available.find((language) => language.code === requested);
  if (exact) return exact.code;
  const requestedLocale = new Intl.Locale(requested).maximize();
  // Match regional variants only within the same script (zh-TW must not become zh-CN).
  const compatible = available.find((language) => {
    const candidate = new Intl.Locale(language.code).maximize();
    return (
      candidate.language === requestedLocale.language && candidate.script === requestedLocale.script
    );
  });
  return compatible?.code ?? "en";
}

export function createI18n(
  locale = "en",
  available: readonly LanguageDefinition[] = languages,
): i18n {
  const instance = createInstance();
  void instance.init({
    lng: resolveLocale(locale, "en", available),
    fallbackLng: "en",
    supportedLngs: available.map((language) => language.code),
    load: "currentOnly",
    resources: Object.fromEntries(
      available.map((language) => [
        language.code,
        { translation: structuredClone(language.messages) },
      ]),
    ),
    initImmediate: false,
    showSupportNotice: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });
  return instance;
}

export type Translate = TFunction;

export function createFormatters(locale: string) {
  const safeLocale = canonicalLocale(locale) ?? "en";
  return {
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(safeLocale, options).format(value),
    date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? ""
        : new Intl.DateTimeFormat(safeLocale, options).format(date);
    },
    relative: (value: number, unit: Intl.RelativeTimeFormatUnit) =>
      new Intl.RelativeTimeFormat(safeLocale, { numeric: "auto", style: "short" }).format(
        value,
        unit,
      ),
    bytes: (bytes: number) => {
      const units = ["byte", "kilobyte", "megabyte", "gigabyte"];
      const index = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)));
      return new Intl.NumberFormat(safeLocale, {
        style: "unit",
        unit: units[index],
        unitDisplay: "short",
        minimumFractionDigits: index === 0 ? 0 : 1,
        maximumFractionDigits: index === 0 ? 0 : 1,
      }).format(bytes / 1024 ** index);
    },
  };
}
