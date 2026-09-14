import {
  createFormatters,
  createI18n,
  type I18n,
  type LocaleState,
  languages,
  type TFunction,
} from "@interleave/i18n";
import { useSyncExternalStore } from "react";
import { isDesktop } from "./lib/appApi";

export const i18n: I18n = createI18n();
export const t: TFunction = i18n.t;
export const format = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    createFormatters(i18n.language).number(value, options),
  date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
    createFormatters(i18n.language).date(value, options),
  relative: (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    createFormatters(i18n.language).relative(value, unit),
  bytes: (value: number) => createFormatters(i18n.language).bytes(value),
};

function subscribe(callback: () => void) {
  i18n.on("languageChanged", callback);
  return () => {
    i18n.off("languageChanged", callback);
  };
}

/** Subscribe presentation components; plain helpers can use the same instance's t. */
export function useLocale() {
  return useSyncExternalStore(
    subscribe,
    () => i18n.language,
    () => "en",
  );
}

function applyLocale(state: LocaleState) {
  void i18n.changeLanguage(state.locale);
  document.documentElement.lang = state.locale;
  document.documentElement.dir =
    languages.find((language) => language.code === state.locale)?.direction ?? "ltr";
}

export async function initializeLocale(): Promise<void> {
  const bridge = window.appApi;
  if (!isDesktop() || !bridge) {
    applyLocale({ preference: "system", systemLocale: navigator.language, locale: "en" });
    return;
  }
  // Subscribe first so a settings mutation cannot be lost during initialization.
  let changed = false;
  bridge.locale.onChanged((state) => {
    changed = true;
    applyLocale(state);
  });
  const state = await bridge.locale.get();
  if (!changed) applyLocale(state);
}
