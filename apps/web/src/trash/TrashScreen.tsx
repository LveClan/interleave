import { format, t, useLocale } from "../i18n";
/**
 * Trash view (T044, extended for T135 / U8) — recover or permanently delete
 * soft-deleted elements.
 *
 * Rebuilt from the design kit's `TrashScreen` (`design/kit/app/screen-extra.jsx`):
 * a centered column of `result` rows, each with a `TypeIcon`, a dimmed title, a
 * "{type} · from {source} · deleted {when}" meta line, and per-row Restore +
 * permanent-delete buttons; an "Empty trash" action in the head; an `EmptyState`
 * "Trash is empty"; and the "deleted items are recoverable for {N} days" sub.
 *
 * Architecture (non-negotiable): this is UI ONLY — no SQL, no soft-delete/restore
 * logic. The trash list comes from `appApi.listTrash()` (read-only); Restore /
 * Purge / Empty are typed `appApi.*` calls over the preload bridge, and the main
 * process owns the transaction + the `operation_log` op.
 *
 * T135 / U8 additions:
 *  - Branch grouping: rows sharing a delete `batchId` are grouped under one entry
 *    with a child count + the source for context, and ONE Restore that calls
 *    `restoreBatchFromTrash` (root-first, atomic) — Notion/Finder restore-as-unit.
 *  - Purge-guard recovery (R12): when `purgeFromTrash` returns `{ blocked: true }`
 *    (the tombstone still anchors live descendants), the dead-end is replaced by an
 *    inline `--warn` recovery row with Restore + Delete-branch next steps.
 *  - Empty Trash surfaces how many rows it SKIPPED (still anchor live items).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Snackbar } from "../components/Snackbar";
import { AutoVirtualList } from "../components/VirtualList";
import { appApi, isDesktop, type TrashItemSummary } from "../lib/appApi";
import "./trash.css";

/** The lucide icon for an element type (mirrors the kit's `TypeIcon`). */
function typeIcon(type: string): IconName {
  switch (type) {
    case "source":
      return "library";
    case "extract":
      return "layers";
    case "card":
      return "review";
    case "topic":
      return "concepts";
    case "task":
      return "checkCircle";
    default:
      return "inbox";
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case "source":
      return t("trash.sourceType");
    case "topic":
      return t("trash.topicType");
    case "extract":
      return t("trash.extractType");
    case "card":
      return t("trash.cardType");
    case "task":
      return t("trash.taskType");
    case "concept":
      return t("trash.conceptType");
    case "media_fragment":
      return t("trash.mediaType");
    case "synthesis_note":
      return t("trash.synthesisType");
    default:
      return type;
  }
}

/** A short "deleted {relative}" label from an ISO timestamp. */
function deletedAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return t("trash.recently");
  const mins = Math.max(0, Math.round((now - then) / 60_000));
  if (mins < 1) return format.relative(0, "second");
  if (mins < 60) return format.relative(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return format.relative(-hours, "hour");
  const days = Math.round(hours / 24);
  return format.relative(-days, "day");
}

/** One displayed entry: a single trashed row, or a grouped branch delete. */
type TrashEntry =
  | { readonly kind: "single"; readonly item: TrashItemSummary }
  | {
      readonly kind: "group";
      readonly batchId: string;
      readonly header: TrashItemSummary;
      readonly members: readonly TrashItemSummary[];
    };

/**
 * Fold the flat trash list into entries: rows sharing a delete `batchId` (with 2+
 * members) become ONE group; everything else stays a single row. The newest-deleted
 * order is preserved; each group sits at the position of its first-seen member.
 */
export function groupTrashRows(items: readonly TrashItemSummary[]): readonly TrashEntry[] {
  const byBatch = new Map<string, TrashItemSummary[]>();
  for (const item of items) {
    if (item.deleteBatchId) {
      const list = byBatch.get(item.deleteBatchId);
      if (list) list.push(item);
      else byBatch.set(item.deleteBatchId, [item]);
    }
  }
  const entries: TrashEntry[] = [];
  const consumed = new Set<string>();
  for (const item of items) {
    const batchId = item.deleteBatchId;
    if (batchId) {
      const members = byBatch.get(batchId);
      if (members && members.length > 1) {
        if (consumed.has(batchId)) continue;
        consumed.add(batchId);
        entries.push({ kind: "group", batchId, header: members[0] as TrashItemSummary, members });
        continue;
      }
    }
    entries.push({ kind: "single", item });
  }
  return entries;
}

export function TrashScreen() {
  useLocale();
  const desktop = isDesktop();
  const [items, setItems] = useState<readonly TrashItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  // The id of a row whose purge was BLOCKED by live descendants (R12) — its inline
  // recovery block (Restore / Delete branch) is shown instead of a dead-end error.
  const [blockedPurgeId, setBlockedPurgeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; onUndo?: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!isDesktop()) {
      setLoading(false);
      return;
    }
    try {
      const res = await appApi.listTrash();
      setItems(res.items);
      setError(null);
    } catch (e) {
      console.error("[trash] load failed", e);
      setError(t("trash.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => groupTrashRows(items), [items]);

  const restore = useCallback(
    async (item: TrashItemSummary) => {
      setBusyId(item.id);
      setError(null);
      setBlockedPurgeId(null);
      try {
        await appApi.restoreFromTrash({ id: item.id });
        await load();
        // The restore is itself undoable via the general command-level undo
        // (re-trashes the element); offer it on the toast.
        setToast({
          message: t("trash.restored", { title: item.title.slice(0, 40) }),
          onUndo: async () => {
            try {
              await appApi.undoLast();
              await load();
              setToast(null);
            } catch (error) {
              console.error("[trash] undo failed", error);
              setError(t("shell.undoFailed"));
            }
          },
        });
      } catch (e) {
        console.error("[trash] restore failed", e);
        setError(t("trash.restoreFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  /** Restore a whole branch-delete batch as one unit (root-first, atomic) — T135 / U8. */
  const restoreBatch = useCallback(
    async (batchId: string, label: string) => {
      setBusyId(batchId);
      setError(null);
      setBlockedPurgeId(null);
      try {
        const res = await appApi.restoreBatchFromTrash({ batchId });
        await load();
        // Surface a partial restore (a member with newer intent stays a tombstone)
        // rather than hiding it.
        if (res.skipped.length > 0) {
          setError(
            t("trash.partialRestore", { count: res.restored.length, skipped: res.skipped.length }),
          );
        }
        setToast({
          message: t("trash.restoredBatch", {
            count: res.restored.length,
            title: label.slice(0, 32),
          }),
          // The batch restore threads ONE fresh `restore_element` batchId through every
          // restored node (T135 / A1), so `undoLast` (which reverses the whole most-recent
          // batch) re-trashes the WHOLE group atomically — never a partial single-node undo.
          onUndo: async () => {
            try {
              await appApi.undoLast();
              await load();
              setToast(null);
            } catch (error) {
              console.error("[trash] undo failed", error);
              setError(t("shell.undoFailed"));
            }
          },
        });
      } catch (e) {
        console.error("[trash] restore batch failed", e);
        setError(t("trash.restoreFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const purge = useCallback(
    async (id: string) => {
      setBusyId(id);
      setConfirmPurgeId(null);
      setError(null);
      setBlockedPurgeId(null);
      try {
        // T135 / U8: a purge that still anchors live descendants is REFUSED at the seam and
        // returns `{ blocked: true, liveDependents }` (not a throw). Instead of a dead-end
        // error, surface the inline recovery block (Restore / Delete branch) under the row.
        const result = await appApi.purgeFromTrash({ id });
        if (result.blocked) {
          setBlockedPurgeId(id);
          return;
        }
        await load();
      } catch (e) {
        console.error("[trash] purge failed", e);
        setError(t("trash.deleteFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  /** The R12 recovery "Delete branch" action — soft-cascade the whole live branch. */
  const deleteBranchFromGuard = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await appApi.softDeleteSubtree({ id, includeSubtree: true });
        setBlockedPurgeId(null);
        await load();
      } catch (e) {
        console.error("[trash] delete branch failed", e);
        setError(t("trash.deleteFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const empty = useCallback(async () => {
    setConfirmEmpty(false);
    setError(null);
    setBlockedPurgeId(null);
    try {
      const res = await appApi.emptyTrash();
      await load();
      // Surface the skipped count (rows that still anchor live items) so Empty Trash is
      // honest about what it could NOT remove (T135 / U8 / AE7).
      if (res.skipped > 0) {
        setError(t("trash.emptySkipped", { purged: res.purged, skipped: res.skipped }));
      }
    } catch (e) {
      console.error("[trash] empty failed", e);
      setError(t("trash.deleteFailed"));
    }
  }, [load]);

  /** The inline purge-guard recovery block (R12) shown under a blocked row. */
  const renderPurgeGuard = useCallback(
    (item: TrashItemSummary) => (
      <div className="trash-guard" data-testid="trash-purge-guard" data-id={item.id}>
        <span className="trash-guard__msg">
          <Icon name="warning" size={13} />
          {t("trash.thisItemStillHasLiveDescendantsRestore")}
        </span>
        <div className="trash-guard__actions">
          <button
            type="button"
            className="trash-btn trash-btn--warn"
            data-testid="trash-guard-restore"
            disabled={busyId === item.id}
            onClick={() => void restore(item)}
          >
            <Icon name="restore" size={14} />
            {t("trash.restore")}
          </button>
          <button
            type="button"
            className="trash-btn trash-btn--warn"
            data-testid="trash-guard-delete-branch"
            disabled={busyId === item.id}
            onClick={() => void deleteBranchFromGuard(item.id)}
          >
            <Icon name="trash" size={14} />
            {t("trash.deleteBranch")}
          </button>
        </div>
      </div>
    ),
    [busyId, restore, deleteBranchFromGuard],
  );

  /** One single (ungrouped) trash row — its Restore + two-stage purge + recovery. */
  const renderSingle = useCallback(
    (item: TrashItemSummary) => (
      <div className="trash-row" key={item.id} data-testid="trash-row" data-id={item.id}>
        <span className="trash-row__icon">
          <Icon name={typeIcon(item.type)} size={16} />
        </span>
        <div className="trash-row__body">
          <div className="trash-row__title" data-testid="trash-row-title">
            {item.title}
          </div>
          <div className="trash-row__meta">
            <span className="trash-row__type">{typeLabel(item.type)}</span>
            {item.sourceTitle ? (
              <>
                <span className="trash-row__dot">·</span>
                <span>{t("trash.source", { title: item.sourceTitle })}</span>
              </>
            ) : null}
            <span className="trash-row__dot">·</span>
            <span title={format.date(item.deletedAt, { dateStyle: "medium", timeStyle: "short" })}>
              {t("trash.deletedAt", { when: deletedAgo(item.deletedAt) })}
            </span>
          </div>
          {blockedPurgeId === item.id ? renderPurgeGuard(item) : null}
        </div>
        <div className="trash-row__actions">
          <button
            type="button"
            className="trash-btn"
            data-testid="trash-restore"
            disabled={busyId === item.id}
            onClick={() => void restore(item)}
          >
            <Icon name="restore" size={14} />
            {t("trash.restore")}
          </button>
          {confirmPurgeId === item.id ? (
            <>
              <button
                type="button"
                className="trash-btn trash-btn--danger"
                data-testid="trash-purge-yes"
                disabled={busyId === item.id}
                onClick={() => void purge(item.id)}
              >
                {t("trash.deleteForever")}
              </button>
              <button
                type="button"
                className="trash-btn"
                data-testid="trash-purge-cancel"
                onClick={() => setConfirmPurgeId(null)}
              >
                {t("trash.cancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="trash-btn trash-btn--icon trash-btn--danger"
              data-testid="trash-purge"
              title={t("trash.deletePermanently")}
              aria-label={t("trash.deletePermanently")}
              disabled={busyId === item.id}
              onClick={() => {
                setBlockedPurgeId(null);
                setConfirmPurgeId(item.id);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      </div>
    ),
    [busyId, confirmPurgeId, blockedPurgeId, restore, purge, renderPurgeGuard],
  );

  /** One grouped branch-delete entry — a child count, source context, one Restore. */
  const renderGroup = useCallback(
    (entry: Extract<TrashEntry, { kind: "group" }>) => {
      const { batchId, header, members } = entry;
      const busy = busyId === batchId;
      return (
        <div
          className="trash-row trash-group"
          key={batchId}
          data-testid="trash-group"
          data-batch-id={batchId}
        >
          <span className="trash-row__icon">
            <Icon name="treeBranch" size={16} />
          </span>
          <div className="trash-row__body">
            <div className="trash-row__title" data-testid="trash-group-title">
              {header.title}
            </div>
            <div className="trash-row__meta">
              <span className="trash-group__count" data-testid="trash-group-count">
                {t("trash.branchCount", { count: members.length })}
              </span>
              {header.sourceTitle ? (
                <>
                  <span className="trash-row__dot">·</span>
                  <span>{t("trash.source", { title: header.sourceTitle })}</span>
                </>
              ) : null}
              <span className="trash-row__dot">·</span>
              <span
                title={format.date(header.deletedAt, { dateStyle: "medium", timeStyle: "short" })}
              >
                {t("trash.deletedAt", { when: deletedAgo(header.deletedAt) })}
              </span>
            </div>
          </div>
          <div className="trash-row__actions">
            <button
              type="button"
              className="trash-btn"
              data-testid="trash-group-restore"
              disabled={busy}
              onClick={() => void restoreBatch(batchId, header.title)}
            >
              <Icon name="restore" size={14} />
              {t("trash.restoreBranch")}
            </button>
          </div>
        </div>
      );
    },
    [busyId, restoreBatch],
  );

  const renderEntry = useCallback(
    (entry: TrashEntry) => (entry.kind === "group" ? renderGroup(entry) : renderSingle(entry.item)),
    [renderGroup, renderSingle],
  );

  if (!desktop) {
    return (
      <div className="trash-shell" data-testid="route-trash">
        <div className="trash-empty">
          <div className="trash-empty__icon">
            <Icon name="trash" size={26} />
          </div>
          <h1 className="trash-empty__title">{t("trash.trash")}</h1>
          <p className="trash-empty__body">{t("trash.deletedSourcesExtractsAndCardsLandHere")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="trash-shell" data-testid="route-trash">
      <div className="trash-head">
        <div>
          <h1 className="trash-title">{t("trash.trash")}</h1>
          <p className="trash-sub">{t("trash.localFirstDeletedItemsAreRecoverableFor")}</p>
        </div>
        {items.length > 0 ? (
          confirmEmpty ? (
            <div className="trash-confirm" data-testid="trash-empty-confirm">
              <span>{t("trash.confirmEmpty", { count: items.length })}</span>
              <button
                type="button"
                className="trash-btn trash-btn--danger"
                data-testid="trash-empty-yes"
                onClick={() => void empty()}
              >
                {t("trash.emptyTrash")}
              </button>
              <button
                type="button"
                className="trash-btn"
                data-testid="trash-empty-cancel"
                onClick={() => setConfirmEmpty(false)}
              >
                {t("trash.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="trash-btn trash-btn--danger"
              data-testid="trash-empty"
              onClick={() => setConfirmEmpty(true)}
            >
              <Icon name="trash" size={14} />
              {t("trash.emptyTrash")}
            </button>
          )
        ) : null}
      </div>

      {error ? (
        <p className="trash-error" data-testid="trash-error">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="trash-loading" data-testid="trash-loading">
          {t("trash.loading")}
        </p>
      ) : items.length === 0 ? (
        <div className="trash-empty" data-testid="trash-empty-state">
          <div className="trash-empty__icon">
            <Icon name="trash" size={26} />
          </div>
          <h2 className="trash-empty__title">{t("trash.trashIsEmpty")}</h2>
          <p className="trash-empty__body">
            {t("trash.nothingToRecoverDeletedSourcesExtractsAnd")}
          </p>
        </div>
      ) : (
        // Virtualized once it crosses the threshold (years-of-use scale, T100); inline
        // below it so the everyday trash keeps its exact kit layout. Groups + singles are
        // folded into one entry list so a branch delete reads as a single recoverable unit.
        <AutoVirtualList
          items={entries}
          itemKey={(entry) => (entry.kind === "group" ? `batch:${entry.batchId}` : entry.item.id)}
          estimateSize={80}
          height={560}
          className="trash-list trash-list--virtual"
          testId="trash-list"
          renderInline={() => (
            <div className="trash-list" data-testid="trash-list">
              {entries.map((entry) => renderEntry(entry))}
            </div>
          )}
          renderItem={(entry) => renderEntry(entry)}
        />
      )}

      <Snackbar
        message={toast?.message ?? null}
        onUndo={toast?.onUndo}
        onClose={() => setToast(null)}
        icon="restore"
        testId="trash-snackbar"
      />
    </div>
  );
}
