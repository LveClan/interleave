import type { SkimReceipt, SkimVerdict, SourceStructure, StructureRange } from "@interleave/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { requestQueueRefresh } from "../../components/queue/queueRefresh";
import { t, useLocale } from "../../i18n";
import { appApi, isDesktop } from "../../lib/appApi";
import { sourceReadingChanged } from "../../lib/sourceReadingEvents";
import "./structural-skim.css";

export function StructuralSkim({ sourceId }: { sourceId: string }) {
  useLocale();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [data, setData] = useState<SourceStructure | null>(null);
  const [choices, setChoices] = useState<
    Record<string, { verdict: SkimVerdict; priority: number }>
  >({});
  const [receipt, setReceipt] = useState<SkimReceipt | null>(null);
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [title, setTitle] = useState("");
  const alive = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = async () => {
    try {
      const result = await appApi.getSourceStructure(sourceId);
      if (alive.current) {
        setData(result);
        setError(false);
      }
    } catch {
      if (alive.current) setError(true);
    }
  };
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await action();
      sourceReadingChanged(sourceId);
      requestQueueRefresh();
    } catch {
      if (alive.current) setError(true);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const choose = (range: StructureRange, verdict: SkimVerdict) =>
    setChoices((previous) => ({
      ...previous,
      [range.key]: { verdict, priority: previous[range.key]?.priority ?? range.priority },
    }));
  const addManual = () =>
    void run(async () => {
      const from = data?.units[Number(start)],
        to = data?.units[Number(end)];
      if (!from || !to || from.documentId !== to.documentId) throw new Error("Invalid range");
      const range = await appApi.manualSourceSection({
        sourceId,
        documentId: from.documentId,
        start: from.id,
        end: to.id,
        title,
      });
      if (alive.current)
        setData((previous) =>
          previous
            ? {
                ...previous,
                ranges: [...previous.ranges.filter((r) => r.key !== range.key), range],
              }
            : null,
        );
    });
  if (!isDesktop()) return null;
  return (
    <section className="structural-skim" aria-label={t("sourceReturn.skim")}>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!data) void load();
        }}
      >
        <Icon name="layers" size={14} />
        {t("sourceReturn.skim")}
      </button>
      {open && (
        <>
          {error && <p role="alert">{t("sourceReturn.skimFailed")}</p>}
          <ol className="structural-skim__rows">
            {data?.ranges.map((range) => (
              <li key={range.key} style={{ paddingLeft: `${Math.min(range.depth, 6) * 12}px` }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm structural-skim__title"
                  disabled={!range.topicId}
                  onClick={() =>
                    range.topicId &&
                    void navigate({
                      to: "/source/$id",
                      params: { id: range.topicId },
                      search: { entry: "queue" },
                    })
                  }
                >
                  {range.title}
                </button>
                <span>{range.unitIds.length}</span>
                <select
                  aria-label={`${range.title}: ${t("sourceReturn.verdict")}`}
                  disabled={busy || !range.valid}
                  value={choices[range.key]?.verdict ?? ""}
                  onChange={(e) =>
                    e.target.value
                      ? choose(range, e.target.value as SkimVerdict)
                      : setChoices((previous) => {
                          const next = { ...previous };
                          delete next[range.key];
                          return next;
                        })
                  }
                >
                  <option value="">
                    {range.verdict === "extract_worthy"
                      ? t("sourceReturn.extractWorthy")
                      : range.verdict === "later"
                        ? t("sourceReturn.skimLater")
                        : range.verdict === "ignore"
                          ? t("sourceReturn.skimIgnore")
                          : t("sourceReturn.undecided")}
                  </option>
                  <option value="extract_worthy">{t("sourceReturn.extractWorthy")}</option>
                  <option value="later">{t("sourceReturn.skimLater")}</option>
                  <option value="ignore">{t("sourceReturn.skimIgnore")}</option>
                </select>
                <select
                  aria-label={`${range.title}: ${t("sourceReturn.sectionPriority")}`}
                  value={choices[range.key]?.priority ?? range.priority}
                  disabled={busy}
                  onChange={(e) =>
                    setChoices((previous) => ({
                      ...previous,
                      [range.key]: {
                        verdict: previous[range.key]?.verdict ?? range.verdict ?? "extract_worthy",
                        priority: Number(e.target.value),
                      },
                    }))
                  }
                >
                  <option value={0.875}>A</option>
                  <option value={0.625}>B</option>
                  <option value={0.375}>C</option>
                  <option value={0.125}>D</option>
                  {![0.875, 0.625, 0.375, 0.125].includes(range.priority) && (
                    <option value={range.priority}>{range.priority}</option>
                  )}
                </select>
                {!range.valid && <span>{t("sourceReturn.moved")}</span>}
              </li>
            ))}
          </ol>
          <div className="structural-skim__actions">
            <input
              aria-label={t("sourceReturn.sectionTitle")}
              placeholder={t("sourceReturn.sectionTitle")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              aria-label={t("sourceReturn.rangeStart")}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            >
              <option value="">{t("sourceReturn.rangeStart")}</option>
              {data?.units.map((u, i) => (
                <option key={`${u.documentId}:${u.id}`} value={i}>
                  {u.label}
                </option>
              ))}
            </select>
            <select
              aria-label={t("sourceReturn.rangeEnd")}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            >
              <option value="">{t("sourceReturn.rangeEnd")}</option>
              {data?.units.map((u, i) => (
                <option key={`${u.documentId}:${u.id}`} value={i}>
                  {u.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || !title.trim() || start === "" || end === ""}
              onClick={addManual}
            >
              <Icon name="plus" size={14} />
              {t("sourceReturn.makeSection")}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || Object.keys(choices).length === 0}
              onClick={() =>
                void run(async () => {
                  const decisions =
                    data?.ranges.flatMap((range) => {
                      const choice = choices[range.key];
                      return choice ? [{ range, ...choice }] : [];
                    }) ?? [];
                  const result = await appApi.applySourceSkim({ sourceId, decisions });
                  if (!alive.current) return;
                  setReceipt(result);
                  setChoices({});
                  await load();
                })
              }
            >
              <Icon name="check" size={14} />
              {t("sourceReturn.applySkim")}
            </button>
            {receipt && (
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                title={t("sourceReturn.undoSkim")}
                aria-label={t("sourceReturn.undoSkim")}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await appApi.undoSourceSkim(receipt);
                    if (!result.undone) throw new Error("Changed");
                    if (alive.current) {
                      setReceipt(null);
                      await load();
                    }
                  })
                }
              >
                <Icon name="undo" size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
