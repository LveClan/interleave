import { languages } from "@interleave/i18n";
import { useEffect, useState } from "react";
import { t, useLocale } from "../i18n";
import { appApi, isDesktop } from "../lib/appApi";

export function LanguageSetting({ disabled = false }: { disabled?: boolean }) {
  useLocale();
  const [preference, setPreference] = useState("system");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const bridge = window.appApi;
    if (!isDesktop() || !bridge) return;
    let active = true;
    let changed = false;
    const unsubscribe = bridge.locale.onChanged((state) => {
      changed = true;
      setPreference(state.preference);
    });
    void bridge.locale
      .get()
      .then((state) => {
        if (active && !changed) setPreference(state.preference);
      })
      .catch((error: unknown) => {
        console.error("[locale] load failed", error);
        if (active) setError(t("common.languageLoadFailed"));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const save = async (language: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await appApi.updateAppSettings({ patch: { language } });
      setPreference(result.settings.language);
    } catch (error) {
      console.error("[locale] save failed", error);
      setError(t("common.languageSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <select
        aria-label={t("common.language")}
        data-testid="setting-language"
        value={preference}
        disabled={busy || disabled || !isDesktop()}
        onChange={(event) => void save(event.target.value)}
        className="max-w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text"
      >
        <option value="system">{t("common.systemLanguage")}</option>
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.nativeName}
          </option>
        ))}
        {preference !== "system" && !languages.some((language) => language.code === preference) ? (
          <option value={preference}>
            {t("common.languageUnsupported", { language: preference })}
          </option>
        ) : null}
      </select>
      {error ? (
        <p role="alert" className="mt-1 text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
