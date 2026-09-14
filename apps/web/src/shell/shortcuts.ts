import { t } from "../i18n";
/**
 * The single shortcut registry (T048) — the ONE source of truth for the app's
 * keyboard surface.
 *
 * Before T048, shortcuts lived in three disconnected places (`useShellShortcuts`,
 * `useProcessShortcuts`, the review screen's inline `onKey`) and the cheat sheet
 * (`nav.ts`'s `CHEAT_SHEET`) was hand-maintained documentation that could drift
 * from them. This module collapses that into one declarative list: every shortcut
 * the app binds is described here ONCE, and both the `?` cheat sheet and the `⌘K`
 * palette's action entries are DERIVED from it (see `nav.ts`) so the
 * documentation can never disagree with the handlers.
 *
 * This is pure config + a contract — NOT a handler. A registry entry declares the
 * shortcut's identity, label, keycaps, group, and the SCOPE that is responsible
 * for binding it; the actual key handling stays in the scope hook that owns that
 * surface (the shell's `useShellShortcuts`, the queue's `useProcessShortcuts`, the
 * review screen's `onKey`, the reader's selection keys). The load-bearing
 * invariant T048 enforces is the "one command per action" rule: a shortcut and
 * its on-screen button call the EXACT same typed `window.appApi` command — the
 * registry binds nothing of its own, it only NAMES what each scope must wire and
 * a Vitest drift test asserts that every scope-claimed entry is actually bound.
 *
 * No domain logic here, no SQL, no `window.appApi` calls — just the catalogue.
 */

/** Which surface is responsible for binding a shortcut. */
export type ShortcutScope = "global" | "reader" | "review" | "queue" | "triage";

/** The cheat-sheet / palette grouping a shortcut belongs to. */
export type ShortcutGroup = "Navigation" | "Reading" | "Review" | "Triage" | "Inbox" | "Actions";

/** One shortcut in the single source of truth. */
export interface ShortcutDef {
  /** Stable id, used by the drift test + as the `kbd-<id>` doc hook. */
  readonly id: string;
  /** Human label shown in the cheat sheet + palette. */
  readonly label: string;
  /**
   * The keycaps rendered in the cheat sheet / palette (the PRIMARY binding). A
   * shortcut may accept aliases at the handler (e.g. `n`/`→`/`␣` for next) but the
   * cheat sheet shows the canonical caps.
   */
  readonly keys: readonly string[];
  /** The cheat-sheet group heading. */
  readonly group: ShortcutGroup;
  /** Which scope hook is responsible for binding this shortcut. */
  readonly scope: ShortcutScope;
  /**
   * Optional palette command spec. When present, the `⌘K` palette renders an
   * ACTION entry for this shortcut (via `nav.ts`'s derivation). `actionId` is the
   * stable id `CommandPalette` dispatches to the shell's action map; `to` lets the
   * action ALSO navigate first (e.g. "Start review" routes to `/review`).
   */
  readonly palette?: {
    /** The palette group heading (defaults to "Actions"). */
    readonly group?: string;
    /** The lucide icon name for the palette row. */
    readonly icon: string;
    /** The action id the shell's palette-action map runs (omit for nav-only). */
    readonly actionId?: PaletteActionId;
    /** A route to navigate to when chosen (nav-only or nav-then-act). */
    readonly to?: string;
  };
}

/**
 * The closed set of palette ACTION ids the shell knows how to run. Each maps to a
 * handler in `Shell.tsx` that dispatches the SAME `window.appApi` command (or
 * navigation) as the matching on-screen button — there is no second mutation path.
 * Context-scoped actions are no-ops when nothing is selected (the `when` gate in
 * `nav.ts` hides them, and the handler bails defensively).
 */
export type PaletteActionId =
  | "open-source"
  | "open-parent"
  | "raise-priority"
  | "lower-priority"
  | "start-review"
  | "search"
  | "create-backup"
  | "cheat-sheet";

/**
 * The registry. Order here is the cheat-sheet display order within each group.
 *
 * Keys mirror the design kit's caps (IBM Plex `.kbd`): `⌘`/`G`/`?`/`␣`/`⌫` etc.
 * The `scope` says who binds it; the drift test (`shortcuts.test.ts`) asserts each
 * scope-claimed entry is actually wired by reading the scope's known key set.
 */
export const SHORTCUTS: readonly ShortcutDef[] = [
  // ---- Navigation (global) -------------------------------------------------
  {
    id: "command-palette",
    get label() {
      return t("shell.commandPalette");
    },
    keys: ["⌘", "K"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "nav-back",
    get label() {
      return t("shell.back");
    },
    keys: ["⌘", "←"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "nav-forward",
    get label() {
      return t("shell.forward");
    },
    keys: ["⌘", "→"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "undo",
    get label() {
      return t("shell.undoLastAction");
    },
    keys: ["⌘", "Z"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "search",
    get label() {
      return t("shell.search");
    },
    keys: ["/"],
    group: "Navigation",
    scope: "global",
    palette: { group: "Go to", icon: "search", actionId: "search", to: "/search" },
  },
  {
    id: "goto-queue",
    get label() {
      return t("shell.goToQueue");
    },
    keys: ["G", "Q"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "goto-review",
    get label() {
      return t("shell.goToReview");
    },
    keys: ["G", "R"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "goto-library",
    get label() {
      return t("shell.goToLibrary");
    },
    keys: ["G", "L"],
    group: "Navigation",
    scope: "global",
  },
  {
    id: "cheat-sheet",
    get label() {
      return t("shell.thisCheatSheet");
    },
    keys: ["?"],
    group: "Navigation",
    scope: "global",
    palette: { group: "Go to", icon: "keyboard", actionId: "cheat-sheet" },
  },
  // ---- Actions (global, on the selected element) ---------------------------
  {
    id: "open-source",
    get label() {
      return t("shell.openSource");
    },
    keys: ["O"],
    group: "Actions",
    scope: "global",
    palette: { icon: "external", actionId: "open-source" },
  },
  {
    id: "open-parent",
    get label() {
      return t("shell.openParent");
    },
    keys: ["U"],
    group: "Actions",
    scope: "global",
    palette: { icon: "arrowUp", actionId: "open-parent" },
  },
  {
    id: "raise-priority",
    get label() {
      return t("shell.raisePriority");
    },
    keys: ["+"],
    group: "Actions",
    scope: "global",
    palette: { icon: "arrowUp", actionId: "raise-priority" },
  },
  {
    id: "lower-priority",
    get label() {
      return t("shell.lowerPriority");
    },
    keys: ["-"],
    group: "Actions",
    scope: "global",
    palette: { icon: "arrowDown", actionId: "lower-priority" },
  },
  {
    id: "start-review",
    get label() {
      return t("shell.startReview");
    },
    keys: ["G", "R"],
    group: "Actions",
    scope: "global",
    palette: { group: "Session", icon: "play", actionId: "start-review", to: "/review" },
  },
  {
    id: "create-backup",
    get label() {
      return t("shell.createABackup");
    },
    keys: ["⌘", "B"],
    group: "Actions",
    scope: "global",
    palette: { group: "Session", icon: "shield", actionId: "create-backup" },
  },
  // ---- Reading (reader scope) ----------------------------------------------
  {
    id: "extract",
    get label() {
      return t("shell.extractSelection");
    },
    keys: ["E"],
    group: "Reading",
    scope: "reader",
  },
  {
    id: "cloze",
    get label() {
      return t("shell.clozeSelection");
    },
    keys: ["C"],
    group: "Reading",
    scope: "reader",
  },
  {
    id: "highlight",
    get label() {
      return t("shell.highlight");
    },
    keys: ["H"],
    group: "Reading",
    scope: "reader",
  },
  {
    id: "set-read-point",
    get label() {
      return t("shell.setReadPoint");
    },
    keys: ["␣"],
    group: "Reading",
    scope: "reader",
  },
  // ---- Review (review scope) -----------------------------------------------
  {
    id: "reveal",
    get label() {
      return t("shell.revealAnswer");
    },
    keys: ["␣"],
    group: "Review",
    scope: "review",
  },
  {
    id: "grade",
    get label() {
      return t("shell.gradeAgainEasy");
    },
    keys: ["1", "4"],
    group: "Review",
    scope: "review",
  },
  {
    id: "review-edit",
    get label() {
      return t("shell.editCard");
    },
    keys: ["E"],
    group: "Review",
    scope: "review",
  },
  {
    id: "review-suspend",
    get label() {
      return t("shell.suspend");
    },
    keys: ["S"],
    group: "Review",
    scope: "review",
  },
  // ---- Queue / process loop (queue scope) ----------------------------------
  {
    id: "process-reveal",
    get label() {
      return t("shell.revealCardAnswerOnACard");
    },
    keys: ["␣"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "process-grade",
    get label() {
      return t("shell.gradeAgainEasyOnACard");
    },
    keys: ["1", "4"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "next-item",
    get label() {
      return t("shell.nextSkip");
    },
    keys: ["N"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "postpone",
    get label() {
      return t("shell.postpone");
    },
    keys: ["P"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "done",
    get label() {
      return t("shell.markDone");
    },
    keys: ["D"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "dismiss",
    get label() {
      return t("shell.dismiss");
    },
    keys: ["X"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "delete",
    get label() {
      return t("shell.delete");
    },
    keys: ["⌫"],
    group: "Triage",
    scope: "queue",
  },
  {
    id: "process-undo",
    get label() {
      return t("shell.undoProcessAction");
    },
    keys: ["⌘", "Z"],
    group: "Triage",
    scope: "queue",
  },
  // ---- Inbox bulk triage (triage scope, T126) ------------------------------
  // The inbox is the real "triage" surface: these keys make a 50-item morning
  // mouse-free. They are BOUND in `pages/inbox/useInboxTriageShortcuts.ts` (the
  // drift test scans that hook's source). `⌘Z` is intentionally absent — global
  // undo fires before the scope gate, so the inbox scope must not bind it.
  {
    id: "inbox-cursor-down",
    get label() {
      return t("shell.moveCursorDown");
    },
    keys: ["J"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-cursor-up",
    get label() {
      return t("shell.moveCursorUp");
    },
    keys: ["K"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-range-extend",
    get label() {
      return t("shell.extendSelection");
    },
    keys: ["⇧", "J"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-toggle-row",
    get label() {
      return t("shell.addRemoveCursorRow");
    },
    keys: ["X"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-select-group",
    get label() {
      return t("shell.selectRestOfGroup");
    },
    keys: ["S"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-select-all",
    get label() {
      return t("shell.selectAll");
    },
    keys: ["⌘", "A"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-clear",
    get label() {
      return t("shell.clearSelection");
    },
    keys: ["Esc"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-read-now",
    get label() {
      return t("shell.readNowSelection");
    },
    keys: ["1"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-queue-soon",
    get label() {
      return t("shell.queueSoonSelection");
    },
    keys: ["2"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-keep",
    get label() {
      return t("shell.saveForLaterSelection");
    },
    keys: ["3"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-delete",
    get label() {
      return t("shell.deleteSelection");
    },
    keys: ["6"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-priority-band",
    get label() {
      return t("shell.armPriorityABCD");
    },
    keys: ["A", "B", "C", "D"],
    group: "Inbox",
    scope: "triage",
  },
  {
    id: "inbox-accept-suggestion",
    get label() {
      return t("shell.acceptSuggestedPriority");
    },
    keys: ["Enter"],
    group: "Inbox",
    scope: "triage",
  },
] as const;

/** The cheat-sheet group display order. */
export const CHEAT_GROUP_ORDER: readonly ShortcutGroup[] = [
  "Navigation",
  "Actions",
  "Reading",
  "Review",
  "Triage",
  "Inbox",
];

/** All shortcuts in a given scope (for the drift test + per-scope wiring). */
export function shortcutsForScope(scope: ShortcutScope): readonly ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.scope === scope);
}

/** All shortcuts that carry a palette action spec (for the `⌘K` action entries). */
export function paletteShortcuts(): readonly ShortcutDef[] {
  return SHORTCUTS.filter((s) => s.palette !== undefined);
}
