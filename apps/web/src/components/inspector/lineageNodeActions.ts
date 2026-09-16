import { t } from "../../i18n";
/**
 * Type-aware action-catalog builder for the lineage-tree context menu (U4).
 *
 * `buildLineageNodeMenu` is a PURE function: no React, no `appApi`/IPC, no Node.
 * It maps a {@link LineageNode} plus an injected handler bag to the flat
 * {@link ContextMenuItem}[] the reusable `ContextMenu` primitive renders. All side
 * effects (clipboard, router, IPC) live in the handlers the host injects, which keeps
 * this catalog trivially unit-testable and keeps `LineageTree`/the catalog free of the
 * renderer's command surface.
 *
 * ## Catalog shape (order matters — R3)
 *
 * **Tombstone branch (exclusive).** When `node.deleted` is true the node is a
 * soft-deleted tombstone and gets ONLY restore/purge affordances — none of the live
 * actions below:
 *   1. Restore (`restore`)
 *   2. Restore ancestor chain (`treeBranch`)
 *   3. separator
 *   4. "Delete permanently…" — a danger **submenu** whose single danger child
 *      ("Yes, permanently delete") fires `purge`. Modelling the destructive confirm as
 *      a one-child submenu means no top-level item ever calls `purge` directly; the user
 *      must open the submenu and pick the explicit child.
 *
 * **Live node.** Every live type gets the universal "All" actions; extract and card
 * types insert their extras as a visually separated block. The grouping (top → bottom):
 *   1. Open · Copy reference · Copy text                       (navigate + clipboard)
 *   2. separator + type-specific extras, only when present:
 *        - extract: Advance stage · Create card · Postpone · Mark done
 *        - card:    Suspend · Flag leech · Retire   (NO Postpone — cards are
 *                   FSRS-scheduled by design)
 *   3. separator + Set priority (4-child submenu A/B/C/D) · Rename… (capability-gated) ·
 *      Delete
 *
 * Separators only appear between non-empty groups, so source/topic nodes (no extras)
 * collapse the middle block to a single separator between the clipboard group and the
 * priority/delete group.
 *
 * **Rename** is a capability gate: the "Rename…" item appears only when
 * `handlers.rename` is provided. Omitting the handler omits the item entirely (KTD1
 * fallback for types whose rename path is unavailable).
 *
 * **Set priority** is always a submenu with four children A/B/C/D (A highest → D lowest),
 * each calling `setPriority(node, label)`.
 */
import type { LineageNode, PriorityLabel } from "../../lib/appApi";
import type {
  ContextMenuActionItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenuItem,
} from "../menu/types";

/** Priority bucket labels, highest (A) → lowest (D). Re-exported from the appApi contract
 * so the catalog and `setElementPriority` can never drift apart. */
export type { PriorityLabel };

/**
 * The injected side-effecting handlers. Each receives the node the menu was opened on.
 * `rename` is optional: omit it to capability-gate the "Rename…" item off for a type
 * whose rename path is unavailable.
 */
export interface LineageNodeMenuHandlers {
  // All live types
  readonly open: (node: LineageNode) => void;
  readonly copyReference: (node: LineageNode) => void;
  readonly copyText: (node: LineageNode) => void;
  readonly setPriority: (node: LineageNode, priority: PriorityLabel) => void;
  /** Optional → capability gate: omit to drop "Rename…" for this node. */
  readonly rename?: (node: LineageNode) => void;
  readonly delete: (node: LineageNode) => void;
  // Extract-only
  readonly advanceStage: (node: LineageNode) => void;
  readonly createCard: (node: LineageNode) => void;
  readonly postpone: (node: LineageNode) => void;
  readonly markDone: (node: LineageNode) => void;
  // Card-only
  readonly suspend: (node: LineageNode) => void;
  readonly flagLeech: (node: LineageNode) => void;
  readonly retire: (node: LineageNode) => void;
  // Tombstone-only
  readonly restore: (node: LineageNode) => void;
  readonly restoreAncestorChain: (node: LineageNode) => void;
  readonly purge: (node: LineageNode) => void;
}

/**
 * A/B/C/D priority children, highest → lowest, with a short relative hint and a leading
 * color dot from the `--prio-*` tokens (A red → D grey) so the scale reads at a glance.
 */
const PRIORITY_LABELS: ReadonlyArray<{ label: PriorityLabel; hint: string; dot: string }> = [
  {
    label: "A",
    get hint() {
      return t("options.md402ef10d054");
    },
    dot: "var(--prio-a)",
  },
  {
    label: "B",
    get hint() {
      return t("options.mc4ebc6d4a583");
    },
    dot: "var(--prio-b)",
  },
  {
    label: "C",
    get hint() {
      return t("options.ma7248eeb45eb");
    },
    dot: "var(--prio-c)",
  },
  {
    label: "D",
    get hint() {
      return t("options.mf793de205ead");
    },
    dot: "var(--prio-d)",
  },
];

function separator(id: string): ContextMenuSeparator {
  return { kind: "separator", id };
}

/**
 * Build the right-click context-menu items for one lineage node.
 *
 * Tombstone nodes (`node.deleted`) return the restore/purge branch only; live nodes
 * return the universal actions plus any extract-/card-specific extras. See the file
 * JSDoc for the exact grouping and ordering.
 */
export function buildLineageNodeMenu(
  node: LineageNode,
  handlers: LineageNodeMenuHandlers,
): ContextMenuItem[] {
  if (node.deleted) {
    const purgeConfirm: ContextMenuActionItem = {
      kind: "action",
      id: "purge-confirm",
      get label() {
        return t("options.mb7ec96132dd4");
      },
      icon: "trash",
      danger: true,
      onSelect: () => handlers.purge(node),
    };
    const purgeSubmenu: ContextMenuSubmenuItem = {
      kind: "submenu",
      id: "purge",
      get label() {
        return t("options.m8f632e09d806");
      },
      icon: "trash",
      danger: true,
      items: [purgeConfirm],
    };
    return [
      {
        kind: "action",
        id: "restore",
        get label() {
          return t("options.ma76e13b98392");
        },
        icon: "restore",
        onSelect: () => handlers.restore(node),
      },
      {
        kind: "action",
        id: "restore-chain",
        get label() {
          return t("options.md85a3f13e698");
        },
        icon: "treeBranch",
        onSelect: () => handlers.restoreAncestorChain(node),
      },
      separator("sep-tombstone"),
      purgeSubmenu,
    ];
  }

  // --- Group 1: open + clipboard (every live type) -----------------------------------
  const items: ContextMenuItem[] = [
    {
      kind: "action",
      id: "open",
      get label() {
        return t("options.med077f3d8125");
      },
      icon: "external",
      onSelect: () => handlers.open(node),
    },
    {
      kind: "action",
      id: "copy-ref",
      get label() {
        return t("options.m141ae3df92ab");
      },
      icon: "link",
      onSelect: () => handlers.copyReference(node),
    },
    {
      kind: "action",
      id: "copy-text",
      get label() {
        return t("options.mb0ac9cea8687");
      },
      icon: "copy",
      onSelect: () => handlers.copyText(node),
    },
  ];

  // --- Group 2: type-specific extras (extract / card) --------------------------------
  const extras: ContextMenuActionItem[] = [];
  if (node.type === "extract") {
    extras.push(
      {
        kind: "action",
        id: "advance-stage",
        get label() {
          return t("options.m3e98ff96a6de");
        },
        icon: "sparkle",
        onSelect: () => handlers.advanceStage(node),
      },
      {
        kind: "action",
        id: "create-card",
        get label() {
          return t("options.m939a6a1b0d27");
        },
        icon: "plus",
        onSelect: () => handlers.createCard(node),
      },
      {
        kind: "action",
        id: "postpone",
        get label() {
          return t("options.m63fb48d94634");
        },
        icon: "pause",
        onSelect: () => handlers.postpone(node),
      },
      {
        kind: "action",
        id: "mark-done",
        get label() {
          return t("options.m95acc4a22bde");
        },
        icon: "checkCircle",
        onSelect: () => handlers.markDone(node),
      },
    );
  } else if (node.type === "card") {
    // Cards get NO "Postpone" — they are FSRS-scheduled by design.
    extras.push(
      {
        kind: "action",
        id: "suspend",
        get label() {
          return t("options.m4948e134182f");
        },
        icon: "pause2",
        onSelect: () => handlers.suspend(node),
      },
      {
        kind: "action",
        id: "flag-leech",
        get label() {
          return t("options.md12aca99dca2");
        },
        icon: "leech",
        onSelect: () => handlers.flagLeech(node),
      },
      {
        kind: "action",
        id: "retire",
        get label() {
          return t("options.mda8597f3f278");
        },
        icon: "archive",
        onSelect: () => handlers.retire(node),
      },
    );
  }
  if (extras.length > 0) {
    items.push(separator("sep-type"), ...extras);
  }

  // --- Group 3: priority + rename + delete (every live type) -------------------------
  const prioritySubmenu: ContextMenuSubmenuItem = {
    kind: "submenu",
    id: "priority",
    get label() {
      return t("options.m491dc6df71d6");
    },
    icon: "arrowUp",
    items: PRIORITY_LABELS.map(({ label, hint, dot }) => ({
      kind: "action",
      id: `priority-${label}`,
      label,
      hint,
      dot,
      onSelect: () => handlers.setPriority(node, label),
    })),
  };
  items.push(separator("sep-actions"), prioritySubmenu);

  if (handlers.rename) {
    const rename = handlers.rename;
    items.push({
      kind: "action",
      id: "rename",
      get label() {
        return t("options.m6fa62b3dba2f");
      },
      icon: "edit",
      onSelect: () => rename(node),
    });
  }

  items.push({
    kind: "action",
    id: "delete",
    get label() {
      return t("options.me2d0a54968ea");
    },
    icon: "trash",
    danger: true,
    onSelect: () => handlers.delete(node),
  });

  return items;
}
