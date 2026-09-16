import { t, useLocale } from "../i18n";
/**
 * SynthesisCreate (T095) — the "New synthesis note" entry point at `/synthesis/new`.
 *
 * A tiny screen that prompts for a title, creates a `synthesis_note` element through
 * the typed `synthesis.create` bridge (`create_element`), and navigates to the new
 * note's editor (`/synthesis/$id`). Reachable from the command palette ("New synthesis
 * note") and the Library so a synthesis note is never an isolated UI. The renderer
 * holds no SQL — it ships an intent and routes to what main created.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { appApi, isDesktop } from "../lib/appApi";
import "./synthesis.css";

export function SynthesisCreate() {
  useLocale();
  const desktop = isDesktop();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const create = useCallback(async () => {
    const trimmed = title.trim();
    if (!desktop || !trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appApi.createSynthesisNote({ title: trimmed });
      void navigate({ to: "/synthesis/$id", params: { id: res.element.id } });
    } catch {
      setError("Could not create the synthesis note.");
      setBusy(false);
    }
  }, [desktop, title, busy, navigate]);

  if (!desktop) {
    return (
      <div className="reader-state" data-testid="route-synthesis-new">
        <span className="reader-state__icon">
          <Icon name="synthesis" size={26} />
        </span>
        <h1 className="font-semibold text-text text-xl tracking-tight">
          {t("collection.m2ab180ff0231")}
        </h1>
        <p className="max-w-sm">{t("collection.md594458e3181")}</p>
      </div>
    );
  }

  return (
    <div className="synthesis-create" data-testid="route-synthesis-new">
      <div className="synthesis-create__card">
        <span className="synthesis-create__icon">
          <Icon name="synthesis" size={22} />
        </span>
        <h1 className="synthesis-create__title">{t("collection.m2ab180ff0231")}</h1>
        <p className="synthesis-create__hint">
          A long-lived writing surface that collects extracts &amp; cards and returns for
          incremental refinement.
        </p>
        <input
          ref={inputRef}
          className="synthesis-create__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder={t("collection.m48638f1fcf9e")}
          aria-label={t("collection.m42dea0867741")}
          data-testid="synthesis-create-title"
          maxLength={256}
        />
        {error ? (
          <p className="text-danger text-sm" data-testid="synthesis-create-error">
            {error}
          </p>
        ) : null}
        <div className="synthesis-create__actions">
          <button
            type="button"
            className="reader-btn"
            onClick={() => void navigate({ to: "/library" })}
          >
            {t("collection.m0ef70263b054")}
          </button>
          <button
            type="button"
            className="reader-btn reader-btn--primary"
            data-testid="synthesis-create-save"
            disabled={busy || title.trim().length === 0}
            onClick={() => void create()}
          >
            <Icon name="plus" size={14} />
            {t("collection.m77474af78e49")}
          </button>
        </div>
      </div>
    </div>
  );
}
