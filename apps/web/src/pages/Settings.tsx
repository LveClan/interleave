import { LanguageSetting } from "../components/LanguageSetting";
import { format, t, useLocale } from "../i18n";
import "./settings.css";
/**
 * Settings screen (T011).
 *
 * The real preferences surface, rebuilt from `design/kit/app/screen-settings.jsx`
 * for React 19 + Tailwind v4. It reads and writes the typed user/domain settings
 * (daily review budget, desired retention, default topic interval, default source
 * priority, keyboard layout, theme) THROUGH the typed `window.appApi`
 * (`settings.getAll()` / `settings.updateMany()`) — the renderer never touches
 * SQLite. Every change persists immediately to the SQLite `settings` table and
 * survives an app restart; the same values are what the scheduler reads.
 *
 * Pure UI: no domain logic lives here. Validation/clamping/defaults are owned by
 * `@interleave/core` (and re-validated on the main side); this component only
 * orchestrates UI state + optimistic updates and awaits the IPC promises. Outside
 * Electron (browser/Vite-only) it shows a clear "desktop only" state.
 */

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { OptimizationPanel } from "../components/OptimizationPanel";
import { WorkloadSimulator } from "../components/WorkloadSimulator";
import { InlineHint } from "../help/Contextual";
import {
  type AppSettings,
  appApi,
  type BackupArtifact,
  type BackupsCreateResult,
  type CapturePairingResult,
  type DbStatus,
  type HealthResult,
  isDesktop,
  RESET_LOCAL_DATA_CONFIRMATION_PHRASE,
  RESTORE_BACKUP_CONFIRMATION_PHRASE,
  type RendererSettings,
  SEMANTIC_COVERAGE_THRESHOLD,
  type SemanticIndexHealth,
  type SemanticModelState,
  type SemanticStatusResult,
  type SettingValue,
  type ThemePreference,
} from "../lib/appApi";
import { SETTINGS_CHANGED_EVENT } from "../shell/nav";
import { applyTheme } from "../theme";

function settingsError(error: unknown): string {
  console.error("[settings] operation failed", error);
  return error instanceof Error
    ? t("settings.actionFailedDetails", { details: error.message })
    : t("settings.actionFailed");
}

/** Human-readable byte size for the backup toast. */
function formatBytes(bytes: number): string {
  return format.bytes(bytes);
}

function formatBackupArtifactLabel(artifact: BackupArtifact): string {
  return [
    artifact.schemaVersion,
    t("settings.fileCount", { count: artifact.fileCount }),
    formatBytes(artifact.sizeBytes),
  ].join(" · ");
}

/**
 * Local fallback defaults mirroring `@interleave/core`'s DEFAULT_APP_SETTINGS. Typed as
 * the RENDERER projection ({@link RendererSettings}) — the user's OWN keys are MAIN-SIDE
 * secrets, so the renderer state holds the write-only `*Configured` booleans, never the
 * plaintext keys.
 */
const FALLBACK_SETTINGS: RendererSettings = {
  dailyBudgetMinutes: 60,
  distillationQuotaPercent: 15,
  overloadPolicy: "suggest",
  extractAgingPolicy: "off",
  extractAgingReturnThreshold: 5,
  extractAgingAgeDays: 30,
  dailyReviewBudget: 60,
  defaultDesiredRetention: 0.9,
  defaultTopicIntervalDays: 7,
  defaultSourcePriority: 0.375,
  burySiblings: true,
  trashRetentionDays: 30,
  balanceWarnings: true,
  parkedResurfaceAfterDays: 90,
  chronicPostponeThreshold: 5,
  lapseClusterDetectionEnabled: true,
  lapseClusterMinLapses: 5,
  lapseClusterWindowDays: 30,
  lapseClusterMinCards: 2,
  rereadProposalsEnabled: true,
  rereadProposalWeeklyCap: 2,
  weeklyReviewEnabled: true,
  weeklyReviewCadenceDays: 7,
  adaptiveAttentionIntervals: true,
  importBalanceFactor: 1.5,
  keyboardLayout: "qwerty",
  theme: "dark",
  language: "system",
  displayName: "",
  retentionByBand: {},
  retentionByBandEnabled: false,
  fsrsParamsGlobal: null,
  semanticSearchEnabled: true,
  embeddingModelId: "onnx-community/embeddinggemma-300m-ONNX",
  embeddingModelDownloaded: false,
  aiEnabled: false,
  aiProviderKind: "local",
  aiManagedProxyEnabled: false,
  aiModelDownloaded: false,
  aiLocalModelId: "local:Llama-3.2-3B-Instruct-Q4_K_M",
  aiKeyConfigured: false,
};

/** Max length of the display name (mirrors `@interleave/core` `DISPLAY_NAME_MAX`). */
const DISPLAY_NAME_MAX = 64;

const PRIORITY_LABELS = ["A", "B", "C", "D"] as const;
type PriorityLabel = (typeof PRIORITY_LABELS)[number];
const PRIORITY_VALUE: Record<PriorityLabel, number> = { A: 0.875, B: 0.625, C: 0.375, D: 0.125 };

/** Numeric priority → coarse A/B/C/D label (mirrors core/priority). */
function priorityToLabel(priority: number): PriorityLabel {
  const v = Math.min(1, Math.max(0, priority));
  if (v >= 0.75) return "A";
  if (v >= 0.5) return "B";
  if (v >= 0.25) return "C";
  return "D";
}

/** Inclusive UI bounds for desired retention (mirrors `@interleave/core`). */
const DESIRED_RETENTION_MIN = 0.8;
const DESIRED_RETENTION_MAX = 0.97;

const TOPIC_INTERVAL_OPTIONS = [3, 7, 14, 30] as const;
const DAILY_BUDGET_MINUTES_MIN = 5;
const DAILY_BUDGET_MINUTES_MAX = 300;
const DAILY_BUDGET_MINUTE_PRESETS = [15, 30, 60, 120] as const;
const OVERLOAD_POLICY_OPTIONS: { value: AppSettings["overloadPolicy"]; label: string }[] = [
  {
    value: "off",
    get label() {
      return t("settings.off");
    },
  },
  {
    value: "suggest",
    get label() {
      return t("settings.suggest");
    },
  },
  {
    value: "automatic",
    get label() {
      return t("settings.automatic");
    },
  },
];
const EXTRACT_AGING_POLICY_OPTIONS: {
  value: AppSettings["extractAgingPolicy"];
  label: string;
}[] = [
  {
    value: "off",
    get label() {
      return t("settings.off");
    },
  },
  {
    value: "suggest",
    get label() {
      return t("settings.suggest");
    },
  },
  {
    value: "automatic",
    get label() {
      return t("settings.automatic");
    },
  },
];
const EXTRACT_AGING_RETURN_THRESHOLD_MIN = 1;
const EXTRACT_AGING_RETURN_THRESHOLD_MAX = 50;
const EXTRACT_AGING_AGE_DAYS_MIN = 1;
const EXTRACT_AGING_AGE_DAYS_MAX = 3650;
/** Inclusive UI bounds for lapse-cluster detection (mirror `@interleave/core` LAPSE_CLUSTER_*). */
const LAPSE_CLUSTER_MIN_LAPSES_MIN = 2;
const LAPSE_CLUSTER_MIN_LAPSES_MAX = 20;
const LAPSE_CLUSTER_MIN_CARDS_MIN = 2;
const LAPSE_CLUSTER_MIN_CARDS_MAX = 10;
const LAPSE_CLUSTER_WINDOW_DAYS_MIN = 7;
const LAPSE_CLUSTER_WINDOW_DAYS_MAX = 365;
/** Inclusive UI bounds for the re-read proposal cap (mirror `@interleave/core` REREAD_*) — T129. */
const REREAD_PROPOSAL_WEEKLY_CAP_MIN = 1;
const REREAD_PROPOSAL_WEEKLY_CAP_MAX = 10;
const KEYBOARD_LAYOUTS: { value: AppSettings["keyboardLayout"]; label: string }[] = [
  { value: "qwerty", label: "QWERTY" },
  { value: "dvorak", label: "Dvorak" },
  { value: "vim", label: "Vim" },
];

const SettingLabel = createContext<string | undefined>(undefined);

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="setting-row flex items-center justify-between gap-5 border-border-faint border-b py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div id={labelId} className="font-medium text-base text-text">
          {label}
        </div>
        {hint ? <div className="mt-0.5 text-sm text-text-3">{hint}</div> : null}
      </div>
      <SettingLabel.Provider value={labelId}>
        <fieldset className="setting-row__control flex-none" aria-labelledby={labelId}>
          {children}
        </fieldset>
      </SettingLabel.Provider>
    </div>
  );
}

function SectionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-1.5 font-medium text-text-2 text-xs uppercase tracking-wide">{title}</div>
      <div className="rounded-lg border border-border bg-surface-2 px-4">{children}</div>
    </section>
  );
}

/** A small segmented control matching the kit's `Segmented`. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  const labelId = useContext(SettingLabel);
  return (
    <fieldset
      aria-labelledby={labelId}
      className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            data-testid={`${name}-option-${opt.value}`}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={
              active
                ? "rounded-[5px] bg-accent px-3 py-1 font-medium text-sm text-text-on-accent"
                : "rounded-[5px] px-3 py-1 font-medium text-sm text-text-2 hover:text-text"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/** A small on/off switch matching the kit's `Toggle`. */
function Toggle({
  checked,
  onChange,
  name,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  name: string;
}) {
  const labelId = useContext(SettingLabel);
  return (
    <button
      type="button"
      role="switch"
      aria-labelledby={labelId}
      aria-checked={checked}
      data-testid={name}
      onClick={() => onChange(!checked)}
      className={
        checked
          ? "relative inline-flex h-6 w-11 rounded-full bg-accent transition-colors"
          : "relative inline-flex h-6 w-11 rounded-full bg-surface transition-colors ring-1 ring-border"
      }
    >
      <span
        data-testid={`${name}-thumb`}
        className={
          checked
            ? "absolute top-0.5 left-[calc(100%-var(--s-5)-2px)] size-5 rounded-full bg-text-on-accent transition-[left]"
            : "absolute top-0.5 left-0.5 size-5 rounded-full bg-text-3 transition-[left]"
        }
      />
    </button>
  );
}

/**
 * One A/B/C/D band's desired-retention control (T079). A band with no stored target
 * INHERITS the global default — the slider shows that effective value and a muted
 * "inherits" note; nudging the slider sets a per-band override, and a "Reset" link
 * clears it back to inherit. The hint reads "shorter/longer intervals" relative to
 * the global so the user understands the load trade-off.
 */
function RetentionBandRow({
  band,
  target,
  global,
  enabled,
  onSet,
}: {
  band: "A" | "B" | "C" | "D";
  target: number | undefined;
  global: number;
  enabled: boolean;
  onSet: (band: "A" | "B" | "C" | "D", target: number | null) => void;
}) {
  const effective = target ?? global;
  const pct = Math.round(effective * 100);
  const inherits = target === undefined;
  const delta = Math.round((effective - global) * 100);
  const hint =
    delta === 0
      ? t("settings.globalMatch")
      : delta > 0
        ? t("settings.globalShorter")
        : t("settings.globalLonger");
  return (
    <SettingRow
      label={t("settings.band", { band })}
      hint={inherits ? t("settings.inheritsTheGlobalDefault") : hint}
    >
      <div className="flex items-center gap-2.5">
        <input
          aria-label={t("settings.band", { band })}
          type="range"
          min={Math.round(DESIRED_RETENTION_MIN * 100)}
          max={Math.round(DESIRED_RETENTION_MAX * 100)}
          step={1}
          value={pct}
          disabled={!enabled}
          data-testid={`setting-retention-band-${band}`}
          onChange={(e) => onSet(band, Number(e.target.value) / 100)}
          className="w-32 accent-accent disabled:opacity-40"
        />
        <span
          data-testid={`setting-retention-band-${band}-value`}
          className="w-12 text-right font-mono font-semibold text-accent-text text-sm"
        >
          {format.number(pct / 100, { style: "percent" })}
        </span>
        <button
          type="button"
          data-testid={`setting-retention-band-${band}-reset`}
          disabled={!enabled || inherits}
          onClick={() => onSet(band, null)}
          className="text-text-3 text-xs hover:text-text disabled:opacity-30"
        >
          {t("settings.reset")}
        </button>
      </div>
    </SettingRow>
  );
}

/**
 * The "AI assistance" settings section (T093). On-device + OFF BY DEFAULT: the switch
 * turns on the seven AI formulation actions; the provider picker + the WRITE-ONLY key
 * field let a user bring their OWN key (stored in SQLite only, read back as
 * `keyConfigured`, never echoed). The local model is the explicitly-experimental option
 * (a one-time download); the managed proxy is behind a content-is-sent disclosure
 * confirm. Pure UI — one command per action; no model/SQL/key in React.
 */
function AiAssistancePanel({
  settings,
  patch,
}: {
  settings: RendererSettings;
  patch: (next: Partial<AppSettings>) => Promise<void>;
}) {
  const [status, setStatus] = useState<{
    enabled: boolean;
    providerKind: string;
    keyConfigured: boolean;
    modelDownloaded: boolean;
    managedProxyEnabled: boolean;
  } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      setStatus(await appApi.aiStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const onToggle = useCallback(
    async (enabled: boolean) => {
      await patch({ aiEnabled: enabled });
      await refreshStatus();
    },
    [patch, refreshStatus],
  );

  const onSaveKey = useCallback(async () => {
    if (keyInput.trim().length === 0) return;
    await patch({ aiApiKey: keyInput.trim() });
    setKeyInput("");
    await refreshStatus();
  }, [keyInput, patch, refreshStatus]);

  const onDownloadModel = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await appApi.downloadAiModel();
      await refreshStatus();
    } catch (error) {
      setDownloadError(settingsError(error));
    } finally {
      setDownloading(false);
    }
  }, [refreshStatus]);

  const onToggleProxy = useCallback(
    async (enabled: boolean) => {
      // Enabling the managed proxy DISCLOSES that content is sent off-device.
      if (enabled) {
        const ok = window.confirm(t("settings.proxyConfirm"));
        if (!ok) return;
      }
      await patch({ aiManagedProxyEnabled: enabled });
      await refreshStatus();
    },
    [patch, refreshStatus],
  );

  const isLocal = settings.aiProviderKind === "local";
  const isOwnKey = settings.aiProviderKind === "anthropic" || settings.aiProviderKind === "openai";

  return (
    <SectionPanel title={t("settings.aiAssistance")}>
      {downloadError ? (
        <p role="alert" className="py-2 text-danger text-sm">
          {downloadError}
        </p>
      ) : null}
      <SettingRow
        label={t("settings.onDeviceAIAssistance")}
        hint={t("settings.helpFormulateCardsExplainSimplifySuggestQ")}
      >
        <Toggle
          name="setting-ai-enabled"
          checked={settings.aiEnabled}
          onChange={(value) => void onToggle(value)}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.aiProvider")}
        hint={t("settings.localRunsAnExperimentalOnDeviceModel")}
      >
        <Segmented
          name="setting-ai-provider"
          value={settings.aiProviderKind}
          onChange={(value) =>
            void patch({ aiProviderKind: value as AppSettings["aiProviderKind"] })
          }
          options={[
            {
              value: "local",
              get label() {
                return t("settings.local");
              },
            },
            { value: "anthropic", label: "Anthropic" },
            { value: "openai", label: "OpenAI" },
          ]}
        />
      </SettingRow>

      {isOwnKey ? (
        <SettingRow
          label={t("settings.aiAPIKey")}
          hint={
            status?.keyConfigured
              ? t("settings.aKeyIsConfiguredStoredInThis")
              : t("settings.yourOwnProviderKeyStoredInThis")
          }
        >
          <div className="flex items-center gap-2">
            <input
              aria-label={t("settings.aiAPIKey")}
              type="password"
              data-testid="setting-ai-api-key"
              value={keyInput}
              placeholder={status?.keyConfigured ? t("settings.configured") : "sk-…"}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-40 rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              data-testid="setting-ai-store-key"
              onClick={() => void onSaveKey()}
              className="rounded-md border border-border bg-surface px-3 py-1 text-sm text-text hover:bg-surface-2"
            >
              {t("settings.storeKey")}
            </button>
          </div>
        </SettingRow>
      ) : null}

      {isLocal ? (
        <SettingRow
          label={t("settings.localModel")}
          hint={
            status?.modelDownloaded
              ? t("settings.theExperimentalOnDeviceModelIsReady")
              : t("settings.downloadTheExperimentalOnDeviceInstructionModel")
          }
        >
          <button
            type="button"
            data-testid="setting-ai-download-model"
            disabled={downloading || status?.modelDownloaded}
            onClick={() => void onDownloadModel()}
            className="rounded-md border border-border bg-surface px-3 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-40"
          >
            {status?.modelDownloaded
              ? t("settings.ready")
              : downloading
                ? t("settings.downloading")
                : t("settings.downloadModel")}
          </button>
        </SettingRow>
      ) : null}

      <SettingRow label={t("settings.managedProxy")} hint={t("settings.offByDefaultWhenOnAICalls")}>
        <Toggle
          name="setting-ai-managed-proxy"
          checked={settings.aiManagedProxyEnabled}
          onChange={(value) => void onToggleProxy(value)}
        />
      </SettingRow>
    </SectionPanel>
  );
}

/** A small "OK" status chip matching the kit's `.set-ok` (mirrors the backup-result chip). */
function OkChip({ testid, icon, children }: { testid: string; icon: IconName; children: string }) {
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2.5 py-1 text-ok text-xs"
    >
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

/** A neutral mono token pill matching the kit's `.set-token`. */
function Token({ testid, children }: { testid: string; children: string }) {
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-text-2 text-xs whitespace-nowrap"
    >
      {children}
    </span>
  );
}

/** A soft status chip with an ok / warn / danger tint (uniform shape, full tint). */
function StatusChip({
  testid,
  icon,
  tone,
  children,
}: {
  testid: string;
  icon: IconName;
  tone: "ok" | "warn" | "danger";
  children: string;
}) {
  const tint =
    tone === "ok"
      ? "bg-ok-soft text-ok"
      : tone === "warn"
        ? "bg-warn-soft text-warn"
        : "bg-danger-soft text-danger";
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${tint}`}
    >
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

/** A single readiness-checklist line (pass = check, fail = warning, muted-to-warn). */
function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm ${ok ? "text-text-2" : "text-warn"}`}
    >
      <Icon name={ok ? "check" : "warning"} size={13} />
      {label}
    </span>
  );
}

/** The reliability threshold as a whole percent (mirrors the desktop constant). */
const SEMANTIC_THRESHOLD_PCT = Math.round(SEMANTIC_COVERAGE_THRESHOLD * 100);

/** Human copy + chip tone for the honest model state (U1/U5) — never a raw enum token. */
function modelStateChip(state: SemanticModelState): {
  testid: string;
  icon: IconName;
  tone: "ok" | "warn";
  text: string;
} {
  switch (state) {
    case "ready":
      return {
        testid: "semantic-model-ready",
        icon: "check",
        tone: "ok",
        get text() {
          return t("settings.modelReady");
        },
      };
    case "loading":
      return {
        testid: "semantic-model-loading",
        icon: "hourglass",
        tone: "warn",
        get text() {
          return t("settings.loadingModel");
        },
      };
    default:
      return {
        testid: "semantic-model-fallback",
        icon: "warning",
        tone: "warn",
        get text() {
          return t("settings.usingBasicKeywordFallbackQualityReduced");
        },
      };
  }
}

/** Human headline for the index-health rollup (U2/U5). */
function indexHealthHeadline(health: SemanticIndexHealth): string {
  switch (health) {
    case "healthy":
      return t("settings.searchIndexReady");
    case "building":
      return t("settings.buildingSearchIndex");
    case "stale":
      return t("settings.searchIndexIncomplete");
    default:
      return t("settings.searchRunningInReducedMode");
  }
}

/** Translate a raw embed-job error ("code: message") into plain language (U4/U5). */
function plainEmbedError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("too large") || lower.includes("oversiz"))
    return t("settings.anItemWasTooLargeToIndex");
  if (lower.includes("dim")) return t("settings.anItemProducedAnUnexpectedResultAnd");
  if (lower.includes("crash") || lower.includes("worker"))
    return t("settings.theBackgroundIndexerCrashed");
  if (lower.includes("timeout") || lower.includes("timed out"))
    return t("settings.indexingTimedOut");
  if (lower.includes("model")) return t("settings.theSearchModelFailedToLoad");
  return t("settings.someItemsCouldnTBeIndexed");
}

/** Friendly remaining-time copy from an ETA in seconds. */
function formatEta(seconds: number): string {
  if (seconds <= 0) return t("settings.almostDone");
  if (seconds < 60) return t("settings.etaSeconds", { count: seconds });
  return t("settings.etaMinutes", { count: Math.round(seconds / 60) });
}

/**
 * Search Intelligence panel (U5) — the always-accessible observability surface for
 * the embedding lifecycle. Mirrors {@link AiAssistancePanel}: reads `semanticStatus`
 * on mount, refreshes on `embed` job events + window focus, and renders honest,
 * human-readable states (never raw enum tokens) for model readiness, index health +
 * coverage + ETA, a readiness checklist, failures with a retry, and a rebuild action.
 * Collapses to a single message when the vector engine is unavailable, and shows a
 * neutral state for an empty vault — no false "partial coverage".
 */
function SearchIntelligencePanel() {
  const [status, setStatus] = useState<SemanticStatusResult | null>(null);
  const [busy, setBusy] = useState<"reindex" | "retry" | "model" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      setStatus(await appApi.semanticStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isDesktop()) return;
    const unsubscribe = appApi.subscribeJobs((job) => {
      if (job.type === "embed") void refresh();
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refresh]);

  const run = useCallback(
    (kind: "reindex" | "retry" | "model", action: () => Promise<unknown>) => () => {
      setBusy(kind);
      setActionError(null);
      void (async () => {
        try {
          await action();
          await refresh();
        } catch (error) {
          setActionError(settingsError(error));
        } finally {
          setBusy(null);
        }
      })();
    },
    [refresh],
  );

  // Pre-load: a skeleton, never a flash of 0 / 0.
  if (!status) {
    return (
      <SectionPanel title={t("settings.searchIntelligence")}>
        <SettingRow label={t("settings.semanticSearch")} hint={t("settings.checkingStatus")}>
          <span data-testid="semantic-loading" className="text-sm text-text-3">
            {t("settings.loading")}
          </span>
        </SettingRow>
      </SectionPanel>
    );
  }

  // Vector engine unavailable on this install → one honest message, no controls.
  if (!status.vecAvailable) {
    return (
      <SectionPanel title={t("settings.searchIntelligence")}>
        <SettingRow
          label={t("settings.semanticSearch")}
          hint={t("settings.semanticSearchIsnTAvailableOnThis")}
        >
          <StatusChip testid="semantic-unavailable" icon="info" tone="warn">
            {t("settings.unavailable")}
          </StatusChip>
        </SettingRow>
      </SectionPanel>
    );
  }

  const modelChip = modelStateChip(status.modelState);
  const isFallback = status.modelState === "fallback";
  const pct = status.total > 0 ? Math.round(status.coverageRatio * 100) : 0;
  const healthIcon: IconName =
    status.indexHealth === "healthy"
      ? "check"
      : status.indexHealth === "degraded"
        ? "warning"
        : "hourglass";
  const healthTone: "ok" | "warn" | "danger" =
    status.indexHealth === "healthy" ? "ok" : status.indexHealth === "degraded" ? "danger" : "warn";
  // Auto-indexing is parked while on battery (the supervisor defers the bulk reindex).
  // Say so plainly instead of a frozen "Building…"/"incomplete" — Rebuild stays available.
  const pausedOnBattery = status.autoIndexPaused === "battery";

  return (
    <SectionPanel title={t("settings.searchIntelligence")}>
      {actionError ? (
        <p role="alert" className="py-2 text-danger text-sm">
          {actionError}
        </p>
      ) : null}
      <SettingRow
        label={t("settings.searchIndex")}
        hint={t("settings.findRelatedMaterialByMeaningNotJust")}
      >
        <StatusChip
          testid="semantic-index-health"
          icon={pausedOnBattery ? "info" : healthIcon}
          tone={healthTone}
        >
          {pausedOnBattery ? t("settings.indexingPaused") : indexHealthHeadline(status.indexHealth)}
        </StatusChip>
      </SettingRow>

      {status.total === 0 ? (
        <SettingRow
          label={t("settings.indexed")}
          hint={t("settings.nothingToIndexYetAddSourcesTo")}
        >
          <span data-testid="semantic-empty" className="text-sm text-text-3">
            {t("settings.nothingToIndexYet")}
          </span>
        </SettingRow>
      ) : (
        <SettingRow
          label={t("settings.indexed")}
          hint={
            pausedOnBattery
              ? t("settings.onBatteryPlugInToFinishIndexing")
              : status.etaSeconds != null
                ? formatEta(status.etaSeconds)
                : status.indexHealth === "building"
                  ? t("settings.estimating")
                  : pct < SEMANTIC_THRESHOLD_PCT
                    ? t("settings.partialSemanticSearchImprovesAsMoreItems")
                    : t("settings.fullyIndexed")
          }
        >
          <div className="flex items-center gap-2" data-testid="semantic-progress">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-sm text-text-2">
              {t("settings.progress", { embedded: status.embedded, total: status.total })}
            </span>
          </div>
        </SettingRow>
      )}

      <SettingRow
        label={t("settings.searchModel")}
        hint={
          isFallback
            ? status.modelLoadError
              ? t("settings.modelLoadFailed")
              : t("settings.theOnDeviceModelIsnTLoaded")
            : t("settings.runsEntirelyOnDeviceNoContentLeaves")
        }
      >
        <div className="flex items-center gap-2">
          <StatusChip testid={modelChip.testid} icon={modelChip.icon} tone={modelChip.tone}>
            {modelChip.text}
          </StatusChip>
          {isFallback ? (
            <button
              type="button"
              data-testid="semantic-recheck-model"
              disabled={busy === "model"}
              onClick={run("model", () => appApi.semanticDownloadModel())}
              className="rounded-md border border-border bg-surface px-3 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === "model" ? t("settings.checking") : t("settings.recheck")}
            </button>
          ) : null}
        </div>
      </SettingRow>

      <SettingRow label={t("settings.readiness")} hint={t("settings.whatSemanticSearchNeedsToRun")}>
        <div data-testid="semantic-checklist" className="flex flex-col items-end gap-1">
          <ChecklistItem ok label={t("settings.searchEngineReady")} />
          <ChecklistItem ok={status.modelState === "ready"} label={t("settings.modelVerified")} />
          <ChecklistItem ok={!isFallback} label={t("settings.vectorsCompatible")} />
        </div>
      </SettingRow>

      {status.failedCount > 0 ? (
        <SettingRow
          label={t("settings.couldnTIndex")}
          hint={
            status.lastError
              ? plainEmbedError(status.lastError)
              : t("settings.someItemsCouldnTBeIndexed")
          }
        >
          <div className="flex items-center gap-2">
            <StatusChip testid="semantic-failed" icon="warning" tone="danger">
              {t("settings.failedCount", { count: status.failedCount })}
            </StatusChip>
            <button
              type="button"
              data-testid="semantic-retry-failed"
              disabled={busy === "retry"}
              onClick={run("retry", () => appApi.semanticRetryFailed())}
              className="rounded-md border border-border bg-surface px-3 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-40"
            >
              {busy === "retry" ? t("settings.retrying") : t("settings.retryFailed")}
            </button>
          </div>
        </SettingRow>
      ) : null}

      <SettingRow
        label={t("settings.rebuildIndex")}
        hint={t("settings.reEmbedAnythingMissingOrOutOf")}
      >
        <button
          type="button"
          data-testid="semantic-reindex"
          disabled={busy === "reindex"}
          onClick={run("reindex", () => appApi.semanticReindex({ onlyMissing: false }))}
          className="rounded-md border border-border bg-surface px-3 py-1 text-sm text-text hover:bg-surface-2 disabled:opacity-40"
        >
          {busy === "reindex" ? t("settings.rebuilding") : t("settings.rebuild")}
        </button>
      </SettingRow>
    </SectionPanel>
  );
}

/** The settings key the System panel reads/writes to demonstrate persistence (T007). */
const PERSIST_KEY = "desktop.lastCheck";

/**
 * The "System" section (T007). Folds the desktop diagnostics into the native Settings
 * vocabulary: a real consumer of the typed `window.appApi` bridge that proves the renderer
 * reaches trusted local capabilities ONLY through the bridge (never SQLite/Node/fs directly):
 *   - `app.health()` + `db.getStatus()` report the shell + SQLite are up and migrated,
 *   - a setting can be written and read back, and (per the Definition of Done) survives a full
 *     app restart — the E2E relaunches Electron and re-reads it.
 *
 * Pure UI — it only awaits IPC-backed promises from the typed client; no domain logic here.
 */
function SystemPanel() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [persisted, setPersisted] = useState<SettingValue | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Guards the async bridge reads/writes against setState-after-unmount when the user
  // navigates away mid-call (mirrors the `mounted` ref convention used by `Settings()`).
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!isDesktop()) return;
    try {
      const [h, s, g] = await Promise.all([
        appApi.health(),
        appApi.dbStatus(),
        appApi.getSettings({ key: PERSIST_KEY }),
      ]);
      if (!mounted.current) return;
      setHealth(h);
      setStatus(s);
      setPersisted(g.settings[PERSIST_KEY]);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(settingsError(e));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const writeSetting = useCallback(async () => {
    try {
      const value = `checked-${new Date().toISOString()}`;
      await appApi.updateSetting({ key: PERSIST_KEY, value });
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      setError(settingsError(e));
    }
  }, [refresh]);

  // A failed load surfaces the error row AND flips the Local-database chip to "Unavailable"
  // (instead of a perpetual "Checking…"), keeping the chip coherent with the error row.
  const loading = !error && (health === null || status === null);
  const healthy = error === null && health?.status === "ok" && status?.open === true;

  return (
    <section className="mb-6" data-testid="desktop-status" data-desktop="true">
      <div className="mb-1.5 font-medium text-text-2 text-xs uppercase tracking-wide">
        {t("settings.system")}
      </div>
      <div className="rounded-lg border border-border bg-surface-2 px-4">
        <SettingRow
          label={t("settings.localDatabase")}
          hint={t("settings.onDeviceSQLiteStoreBackingThisVault")}
        >
          {loading ? (
            <Token testid="health-status">{t("settings.checking")}</Token>
          ) : healthy ? (
            <OkChip testid="health-status" icon="checkCircle">
              {t("settings.healthy")}
            </OkChip>
          ) : (
            <span
              data-testid="health-status"
              className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-danger text-xs"
            >
              {t("settings.unavailable")}
            </span>
          )}
        </SettingRow>

        <SettingRow
          label={t("settings.schema")}
          hint={t("settings.migrationsAppliedToTheLocalStore")}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Token testid="db-applied-migrations">
              {status ? t("settings.migrationCount", { count: status.appliedMigrations }) : "…"}
            </Token>
            {status?.migrated ? (
              <OkChip testid="db-migrated" icon="check">
                {t("settings.upToDate")}
              </OkChip>
            ) : null}
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.connection")}
          hint={t("settings.journalModeForeignKeysAndWriteLock")}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Token testid="db-journal-mode">{status?.journalMode ?? "…"}</Token>
            <Token testid="db-foreign-keys">
              {status ? (status.foreignKeys ? t("settings.fkOn") : t("settings.fkOff")) : "…"}
            </Token>
            <Token testid="db-busy-timeout">
              {status ? t("settings.milliseconds", { count: status.busyTimeoutMs }) : "…"}
            </Token>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.persistenceCheck")}
          hint={t("settings.writeATimestampedValueAndReadIt")}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span data-testid="persisted-value" className="font-mono text-text-3 text-xs">
              {persisted === undefined ? "(unset)" : String(persisted)}
            </span>
            <button
              type="button"
              data-testid="persist-button"
              onClick={() => void writeSetting()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-2 hover:border-border-strong"
            >
              <Icon name="edit" size={14} />
              {t("settings.writeCheck")}
            </button>
          </div>
        </SettingRow>

        {error ? (
          <SettingRow label={t("settings.systemCheckFailed")} hint={t("settings.seeTheErrorBelow")}>
            <span data-testid="desktop-status-error" className="text-danger text-sm">
              {error}
            </span>
          </SettingRow>
        ) : null}
      </div>
    </section>
  );
}

export function Settings() {
  useLocale();
  const desktop = isDesktop();
  const [settings, setSettings] = useState<RendererSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [openingBackupsFolder, setOpeningBackupsFolder] = useState(false);
  const [backup, setBackup] = useState<BackupsCreateResult | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupFolderError, setBackupFolderError] = useState<string | null>(null);
  const [backupArtifacts, setBackupArtifacts] = useState<readonly BackupArtifact[]>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [backupListError, setBackupListError] = useState<string | null>(null);
  const [selectedBackupTimestamp, setSelectedBackupTimestamp] = useState("");
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  // Restore from a file on disk (T056) — independent of the timestamp restore above so the two
  // rows stay separately controllable, but they share the panel's in-flight / restart locking.
  const [selectedArchivePath, setSelectedArchivePath] = useState("");
  const [selectedArchiveName, setSelectedArchiveName] = useState("");
  const [restoreFilePhrase, setRestoreFilePhrase] = useState("");
  const [restoreFileBusy, setRestoreFileBusy] = useState(false);
  const [restoreFileError, setRestoreFileError] = useState<string | null>(null);
  const [restoreFileSuccess, setRestoreFileSuccess] = useState<string | null>(null);
  const [choosingArchive, setChoosingArchive] = useState(false);
  const [dataRestartRequired, setDataRestartRequired] = useState(false);
  const backupListRequestId = useRef(0);
  const mounted = useRef(true);
  const replacementInFlight = useRef(false);
  // Browser-capture pairing (T062) — the loopback server's token + running state.
  const [pairing, setPairing] = useState<CapturePairingResult | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [confirmExtractAgingAutomatic, setConfirmExtractAgingAutomatic] = useState(false);

  const loadBackupArtifacts = useCallback(async () => {
    const requestId = backupListRequestId.current + 1;
    backupListRequestId.current = requestId;
    setBackupListLoading(true);
    setBackupListError(null);
    try {
      const result = await appApi.listBackups();
      if (!mounted.current || requestId !== backupListRequestId.current) return;
      const artifacts = result.backups;
      setBackupArtifacts(artifacts);
      setSelectedBackupTimestamp((current) =>
        artifacts.some((artifact) => artifact.timestamp === current)
          ? current
          : (artifacts[0]?.timestamp ?? ""),
      );
    } catch (e) {
      if (!mounted.current || requestId !== backupListRequestId.current) return;
      setBackupArtifacts([]);
      setSelectedBackupTimestamp("");
      setBackupListError(settingsError(e));
    } finally {
      if (mounted.current && requestId === backupListRequestId.current) {
        setBackupListLoading(false);
      }
    }
  }, []);

  /**
   * Trigger a full backup through the typed bridge (the main process does ALL the
   * work — snapshot `app.sqlite`, copy the vault, write the hashed manifest, zip).
   * The renderer only awaits display-safe metadata; it never touches the filesystem.
   */
  const runBackup = useCallback(async () => {
    if (dataRestartRequired) return;
    setBackingUp(true);
    setBackupError(null);
    try {
      const result = await appApi.createBackup();
      setBackup(result);
      await loadBackupArtifacts();
    } catch (e) {
      setBackupError(settingsError(e));
    } finally {
      setBackingUp(false);
    }
  }, [dataRestartRequired, loadBackupArtifacts]);

  const restoreSelectedBackup = useCallback(async () => {
    if (
      replacementInFlight.current ||
      dataRestartRequired ||
      !selectedBackupTimestamp ||
      restorePhrase !== RESTORE_BACKUP_CONFIRMATION_PHRASE
    ) {
      return;
    }
    replacementInFlight.current = true;
    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreSuccess(null);
    try {
      await appApi.restoreBackup({
        timestamp: selectedBackupTimestamp,
        confirm: true,
        phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE,
      });
      setRestorePhrase("");
      setResetPhrase("");
      setDataRestartRequired(true);
      setRestoreSuccess(t("settings.restoredBackup", { name: selectedBackupTimestamp }));
    } catch (e) {
      setRestoreError(settingsError(e));
    } finally {
      replacementInFlight.current = false;
      setRestoreBusy(false);
    }
  }, [dataRestartRequired, restorePhrase, selectedBackupTimestamp]);

  /**
   * Pick a backup `.zip` on disk through the main-owned native open-file dialog
   * (`appApi.pickBackupArchive`). The renderer only ever receives the chosen path; it never
   * reads the file. A `cancelled` result is a no-op. We store the path plus a display basename
   * and clear any stale phrase/result so the row re-arms for the freshly chosen archive.
   */
  const chooseArchive = useCallback(async () => {
    setChoosingArchive(true);
    try {
      const result = await appApi.pickBackupArchive();
      if ("cancelled" in result) return;
      const basename = result.path.split(/[\\/]/).pop() ?? result.path;
      setSelectedArchivePath(result.path);
      setSelectedArchiveName(basename);
      setRestoreFilePhrase("");
      setRestoreFileError(null);
      setRestoreFileSuccess(null);
    } catch (e) {
      setRestoreFileError(settingsError(e));
    } finally {
      setChoosingArchive(false);
    }
  }, []);

  /**
   * Restore the chosen archive — mirrors `restoreSelectedBackup` but feeds the picked path to
   * `appApi.restoreBackupFromFile`. Main extracts + verifies + installs through the same
   * rollback pipeline. Shares the `replacementInFlight` ref so it cannot overlap the other
   * destructive backup operations, and flips the panel into restart-required on success.
   */
  const restoreFromFile = useCallback(async () => {
    if (
      replacementInFlight.current ||
      dataRestartRequired ||
      !selectedArchivePath ||
      restoreFilePhrase !== RESTORE_BACKUP_CONFIRMATION_PHRASE
    ) {
      return;
    }
    replacementInFlight.current = true;
    setRestoreFileBusy(true);
    setRestoreFileError(null);
    setRestoreFileSuccess(null);
    try {
      await appApi.restoreBackupFromFile({
        path: selectedArchivePath,
        confirm: true,
        phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE,
      });
      setRestoreFilePhrase("");
      setRestorePhrase("");
      setResetPhrase("");
      setDataRestartRequired(true);
      setRestoreFileSuccess(t("settings.restoredFile", { name: selectedArchiveName }));
    } catch (e) {
      setRestoreFileError(settingsError(e));
    } finally {
      replacementInFlight.current = false;
      setRestoreFileBusy(false);
    }
  }, [dataRestartRequired, restoreFilePhrase, selectedArchivePath, selectedArchiveName]);

  const resetLocalData = useCallback(async () => {
    if (
      replacementInFlight.current ||
      dataRestartRequired ||
      resetPhrase !== RESET_LOCAL_DATA_CONFIRMATION_PHRASE
    ) {
      return;
    }
    replacementInFlight.current = true;
    setResetBusy(true);
    setResetError(null);
    setResetSuccess(null);
    try {
      await appApi.resetLocalData({
        confirm: true,
        phrase: RESET_LOCAL_DATA_CONFIRMATION_PHRASE,
      });
      setRestorePhrase("");
      setResetPhrase("");
      setDataRestartRequired(true);
      setResetSuccess(t("settings.localDataResetRestartInterleaveBeforeContinuing"));
    } catch (e) {
      setResetError(settingsError(e));
    } finally {
      replacementInFlight.current = false;
      setResetBusy(false);
    }
  }, [dataRestartRequired, resetPhrase]);

  useEffect(() => {
    // Set on mount, clear on unmount. A cleanup-only reset leaves this `false` after
    // React StrictMode's dev mount→unmount→remount cycle, silently dropping the
    // post-await backup-list loader results below. Mirrors ReviewScreen.tsx.
    mounted.current = true;
    return () => {
      mounted.current = false;
      backupListRequestId.current += 1;
    };
  }, []);

  const openBackupsFolder = useCallback(async () => {
    setOpeningBackupsFolder(true);
    setBackupFolderError(null);
    try {
      await appApi.openBackupsFolder();
    } catch (e) {
      setBackupFolderError(settingsError(e));
    } finally {
      setOpeningBackupsFolder(false);
    }
  }, []);

  // Load the persisted settings from SQLite through the bridge on mount.
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { settings: loaded } = await appApi.getAppSettings();
        if (cancelled) return;
        setSettings(loaded);
        applyTheme(loaded.theme);
      } catch (e) {
        if (!cancelled) setError(settingsError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    void loadBackupArtifacts();
  }, [loadBackupArtifacts]);

  // Load the browser-capture pairing state (token + enabled/running/port) (T062).
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await appApi.getCapturePairing();
        if (!cancelled) setPairing(result);
      } catch (e) {
        if (!cancelled) setPairingError(settingsError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Enable/disable the loopback capture server (starts/stops it live). */
  const toggleCapture = useCallback(async (enabled: boolean) => {
    setPairingError(null);
    try {
      const next = await appApi.setCaptureEnabled({ enabled });
      // setEnabled returns enabled/running/port; re-read for the token + origin hint.
      const full = await appApi.getCapturePairing();
      setPairing({ ...full, ...next });
    } catch (e) {
      setPairingError(settingsError(e));
    }
  }, []);

  /** Regenerate the pairing token (UNPAIRS the current extension). */
  const regenerateToken = useCallback(async () => {
    if (!window.confirm(t("settings.regenerateThePairingTokenTheCurrentlyPaired"))) {
      return;
    }
    setPairingError(null);
    try {
      await appApi.regenerateCaptureToken();
      const full = await appApi.getCapturePairing();
      setPairing(full);
      setTokenCopied(false);
    } catch (e) {
      setPairingError(settingsError(e));
    }
  }, []);

  /** Copy the token to the clipboard for the user to paste into the extension. */
  const copyToken = useCallback(async () => {
    if (!pairing?.token) return;
    try {
      await navigator.clipboard.writeText(pairing.token);
      setTokenCopied(true);
      window.setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; reveal the token so the user can copy manually.
      setTokenRevealed(true);
    }
  }, [pairing?.token]);

  /**
   * Optimistically apply a patch in the UI, persist it through the bridge, and
   * reconcile with the validated/coerced result the main side returns. Theme is
   * applied to <html> immediately so the change is visible.
   */
  const patch = useCallback(async (next: Partial<AppSettings>) => {
    // AI own-key is WRITE-ONLY: it goes to the main side via the patch but never lives
    // in renderer state.
    const { aiApiKey, ...rendererNext } = next;
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            ...rendererNext,
            ...(aiApiKey !== undefined ? { aiKeyConfigured: aiApiKey.trim().length > 0 } : {}),
          }
        : prev,
    );
    if (next.theme) applyTheme(next.theme);
    try {
      const { settings: confirmed } = await appApi.updateAppSettings({ patch: next });
      setSettings(confirmed);
      applyTheme(confirmed.theme);
      setError(null);
      // Tell settings-reading shell chrome (the sidebar identity chip) to re-read
      // the change live — no remount required.
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
    } catch (e) {
      setError(settingsError(e));
    }
  }, []);

  /**
   * Toggle the per-priority/per-concept retention feature (T079) through the typed
   * `retention.setBandEnabled` command (which also invalidates the per-card scheduler
   * cache), then re-read the full settings so the resolved targets reflect the change.
   */
  const setRetentionEnabled = useCallback(async (enabled: boolean) => {
    setSettings((prev) => (prev ? { ...prev, retentionByBandEnabled: enabled } : prev));
    try {
      await appApi.setRetentionBandEnabled({ enabled });
      const { settings: confirmed } = await appApi.getAppSettings();
      setSettings(confirmed);
      setError(null);
    } catch (e) {
      setError(settingsError(e));
    }
  }, []);

  /**
   * Set/clear one priority-band desired-retention target (T079). `target === null`
   * clears the override (the band inherits the global default). Persists through the
   * typed `retention.setBand` command (which bumps the per-card scheduler cache), then
   * re-reads the full settings so the band map + the implied intervals reflect it.
   */
  const setRetentionBand = useCallback(
    async (band: "A" | "B" | "C" | "D", target: number | null) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const nextBand = { ...prev.retentionByBand };
        if (target === null) delete nextBand[band];
        else nextBand[band] = target;
        return { ...prev, retentionByBand: nextBand };
      });
      try {
        const { retention } = await appApi.setRetentionBand({ band, target });
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                retentionByBand: retention.byBand,
                retentionByBandEnabled: retention.byBandEnabled,
              }
            : prev,
        );
        setError(null);
      } catch (e) {
        setError(settingsError(e));
      }
    },
    [],
  );

  if (!desktop) {
    return (
      <div
        className="mx-auto h-full w-full max-w-3xl overflow-auto px-7 py-8"
        data-testid="route-settings"
      >
        <header className="mb-6">
          <h1 className="font-semibold text-2xl text-text tracking-tight">
            {t("settings.settings")}
          </h1>
          <p className="mt-1 text-sm text-text-2">
            {t("settings.localFirstEverythingStaysOnThisDevice")}
          </p>
        </header>
        <section
          data-testid="settings-desktop-only"
          className="rounded-lg border border-border bg-surface-2 p-4"
        >
          <p className="text-sm text-text-2">{t("settings.runningInABrowserSettingsPersistIn")}</p>
        </section>
      </div>
    );
  }

  const s = settings ?? FALLBACK_SETTINGS;
  const retentionPct = Math.round(s.defaultDesiredRetention * 100);
  const selectedBackup = backupArtifacts.find(
    (artifact) => artifact.timestamp === selectedBackupTimestamp,
  );
  const dataReplacementBusy = restoreBusy || resetBusy || restoreFileBusy;
  const backupControlsLocked = dataRestartRequired || dataReplacementBusy;
  const canRestore =
    selectedBackupTimestamp.length > 0 &&
    restorePhrase === RESTORE_BACKUP_CONFIRMATION_PHRASE &&
    !backupControlsLocked;
  const canRestoreFile =
    selectedArchivePath.length > 0 &&
    restoreFilePhrase === RESTORE_BACKUP_CONFIRMATION_PHRASE &&
    !backupControlsLocked;
  const canReset = resetPhrase === RESET_LOCAL_DATA_CONFIRMATION_PHRASE && !backupControlsLocked;

  return (
    <div
      className="mx-auto h-full w-full max-w-3xl overflow-auto px-7 py-8"
      data-testid="route-settings"
    >
      <header className="mb-6">
        <div>
          <h1 className="font-semibold text-2xl text-text tracking-tight">
            {t("settings.settings")}
          </h1>
          <p className="mt-1 text-sm text-text-2">
            {t("settings.localFirstEverythingStaysOnThisDevice")}
          </p>
        </div>
      </header>

      <SectionPanel title={t("settings.reviewAndScheduling")}>
        <SettingRow
          label={t("settings.dailyReviewBudget")}
          hint={t("settings.softCapOnEstimatedReviewAndProcessing")}
        >
          <div className="flex flex-col items-end gap-2">
            <Segmented
              name="setting-budget-preset"
              value={s.dailyBudgetMinutes}
              options={DAILY_BUDGET_MINUTE_PRESETS.map((value) => ({
                value,
                label: t("settings.minutesShort", { count: value }),
              }))}
              onChange={(dailyBudgetMinutes) => void patch({ dailyBudgetMinutes })}
            />
            <div className="flex items-center gap-2.5">
              <input
                aria-label={t("settings.dailyReviewBudget")}
                type="range"
                min={DAILY_BUDGET_MINUTES_MIN}
                max={DAILY_BUDGET_MINUTES_MAX}
                step={5}
                value={s.dailyBudgetMinutes}
                data-testid="setting-budget"
                onChange={(e) => void patch({ dailyBudgetMinutes: Number(e.target.value) })}
                className="w-40 accent-accent"
              />
              <span
                data-testid="setting-budget-value"
                className="w-16 text-right font-mono font-semibold text-sm text-text"
              >
                {t("settings.minutes", { count: s.dailyBudgetMinutes })}
              </span>
            </div>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.distillationFloor")}
          hint={t("settings.reserveThisShareOfEachDayAnd")}
        >
          <div className="flex items-center gap-2.5">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={s.distillationQuotaPercent}
              aria-label={t("settings.distillationFloorPercent")}
              data-testid="setting-distillation-quota"
              onChange={(e) => void patch({ distillationQuotaPercent: Number(e.target.value) })}
              className="w-40 accent-accent"
            />
            <span
              data-testid="setting-distillation-quota-value"
              className="w-16 text-right font-mono font-semibold text-sm text-text"
            >
              {s.distillationQuotaPercent === 0
                ? t("settings.off")
                : format.number(s.distillationQuotaPercent / 100, { style: "percent" })}
            </span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.overloadPolicy")}
          hint={
            s.overloadPolicy === "automatic"
              ? t("settings.oncePerLocalDaySafeLowValue")
              : s.overloadPolicy === "suggest"
                ? t("settings.manualOverloadSuggestionsStayVisibleAndWait")
                : t("settings.noStandingPolicyRunsTheManualOverload")
          }
        >
          <Segmented
            name="setting-overload-policy"
            value={s.overloadPolicy}
            options={OVERLOAD_POLICY_OPTIONS}
            onChange={(overloadPolicy) => void patch({ overloadPolicy })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.extractAging")}
          hint={
            s.extractAgingPolicy === "automatic"
              ? t("settings.oncePerLocalDayDueStagnantExtracts")
              : s.extractAgingPolicy === "suggest"
                ? t("settings.showAManualSweepForDueExtracts")
                : t("settings.extractsKeepReturningUntilYouProcessThem")
          }
        >
          <div className="flex max-w-md flex-col items-end gap-3">
            <Segmented
              name="setting-extract-aging-policy"
              value={confirmExtractAgingAutomatic ? "automatic" : s.extractAgingPolicy}
              options={EXTRACT_AGING_POLICY_OPTIONS}
              onChange={(extractAgingPolicy) => {
                if (extractAgingPolicy === "automatic" && s.extractAgingPolicy !== "automatic") {
                  setConfirmExtractAgingAutomatic(true);
                  return;
                }
                setConfirmExtractAgingAutomatic(false);
                void patch({ extractAgingPolicy });
              }}
            />
            {confirmExtractAgingAutomatic ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-right text-sm">
                <span className="text-text-2">
                  {t("settings.enableADailyAutomaticReferenceSweepFor")}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-accent-soft-bd bg-accent-soft px-2.5 py-1 font-medium text-accent-text"
                  onClick={() => {
                    setConfirmExtractAgingAutomatic(false);
                    void patch({ extractAgingPolicy: "automatic" });
                  }}
                >
                  {t("settings.enable")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-text-2 hover:text-text"
                  onClick={() => setConfirmExtractAgingAutomatic(false)}
                >
                  {t("settings.cancel")}
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-3">
              <label className="flex items-center gap-2 text-sm text-text-2">
                <span>{t("settings.returns")}</span>
                <input
                  aria-label={t("settings.extractAging")}
                  type="number"
                  min={EXTRACT_AGING_RETURN_THRESHOLD_MIN}
                  max={EXTRACT_AGING_RETURN_THRESHOLD_MAX}
                  step={1}
                  value={s.extractAgingReturnThreshold}
                  data-testid="setting-extract-aging-threshold"
                  onChange={(e) =>
                    void patch({ extractAgingReturnThreshold: Number(e.target.value) })
                  }
                  className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-text-2">
                <span>{t("settings.days")}</span>
                <input
                  aria-label={t("settings.extractAging")}
                  type="number"
                  min={EXTRACT_AGING_AGE_DAYS_MIN}
                  max={EXTRACT_AGING_AGE_DAYS_MAX}
                  step={1}
                  value={s.extractAgingAgeDays}
                  data-testid="setting-extract-aging-days"
                  onChange={(e) => void patch({ extractAgingAgeDays: Number(e.target.value) })}
                  className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text"
                />
              </label>
            </div>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.desiredRetention")}
          hint={t("settings.fsrsTargetRecallProbabilityHigherMoreReviews")}
        >
          <div className="flex items-center gap-2.5">
            <input
              aria-label={t("settings.desiredRetention")}
              type="range"
              min={80}
              max={97}
              step={1}
              value={retentionPct}
              data-testid="setting-retention"
              onChange={(e) =>
                void patch({ defaultDesiredRetention: Number(e.target.value) / 100 })
              }
              className="w-40 accent-accent"
            />
            <span
              data-testid="setting-retention-value"
              className="w-16 text-right font-mono font-semibold text-accent-text text-sm"
            >
              {format.number(retentionPct / 100, { style: "percent" })}
            </span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.defaultTopicInterval")}
          hint={t("settings.howOftenATopicResurfacesOnThe")}
        >
          <Segmented
            name="setting-topic-interval"
            value={s.defaultTopicIntervalDays}
            onChange={(value) => void patch({ defaultTopicIntervalDays: value })}
            options={TOPIC_INTERVAL_OPTIONS.map((d) => ({
              value: d,
              label: t("settings.daysShort", { count: d }),
            }))}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.parkedResurfacing")}
          hint={t("settings.daysBeforeSavedForLaterSourcesReturn")}
        >
          <div className="flex items-center gap-2.5">
            <input
              aria-label={t("settings.parkedResurfacing")}
              type="number"
              min={1}
              max={3650}
              step={1}
              value={s.parkedResurfaceAfterDays}
              data-testid="setting-parked-resurface"
              onChange={(e) => void patch({ parkedResurfaceAfterDays: Number(e.target.value) })}
              className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text"
            />
            <span className="text-sm text-text-3">{t("settings.days2")}</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.defaultSourcePriority")}
          hint={t("settings.priorityAssignedToNewlyImportedSources")}
        >
          <div className="flex items-center gap-1.5" data-testid="setting-priority">
            {PRIORITY_LABELS.map((p) => {
              const active = priorityToLabel(s.defaultSourcePriority) === p;
              return (
                <button
                  key={p}
                  type="button"
                  data-testid={`setting-priority-${p}`}
                  aria-pressed={active}
                  onClick={() => void patch({ defaultSourcePriority: PRIORITY_VALUE[p] })}
                  className={
                    active
                      ? "inline-flex min-w-9 items-center justify-center gap-1.5 rounded-md border border-accent-soft-bd bg-accent-soft px-2 py-1 font-medium text-accent-text text-sm"
                      : "inline-flex min-w-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-medium text-sm text-text-2 hover:text-text"
                  }
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: `var(--prio-${p.toLowerCase()})` }}
                  />
                  {p}
                </button>
              );
            })}
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.burySiblings")}
          hint={t("settings.donTShowCardsFromTheSame")}
        >
          <Toggle
            name="setting-bury-siblings"
            checked={s.burySiblings}
            onChange={(value) => void patch({ burySiblings: value })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.importProcessBalanceWarnings")}
          hint={t("settings.warnOnTheInboxAndAnalyticsWhen")}
        >
          <Toggle
            name="setting-balance-warnings"
            checked={s.balanceWarnings}
            onChange={(value) => void patch({ balanceWarnings: value })}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.weeklyReview")}
          hint={t("settings.scheduleTheLedgerAndIntegrityRitualAs")}
        >
          <div className="flex items-center gap-3">
            <Toggle
              name="setting-weekly-review"
              checked={s.weeklyReviewEnabled}
              onChange={(value) => void patch({ weeklyReviewEnabled: value })}
            />
            <input
              aria-label={t("settings.weeklyReview")}
              type="number"
              min={1}
              max={90}
              step={1}
              value={s.weeklyReviewCadenceDays}
              data-testid="setting-weekly-cadence"
              disabled={!s.weeklyReviewEnabled}
              onChange={(e) => void patch({ weeklyReviewCadenceDays: Number(e.target.value) })}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text disabled:opacity-50"
            />
            <span className="text-sm text-text-3">{t("settings.days2")}</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.lapseClusterDetection")}
          hint={t("settings.surfaceSourceRegionsWhereSeveralCardsKeep")}
        >
          <div className="flex items-center gap-3">
            <Toggle
              name="setting-lapse-cluster"
              checked={s.lapseClusterDetectionEnabled}
              onChange={(value) => void patch({ lapseClusterDetectionEnabled: value })}
            />
            <input
              type="number"
              min={LAPSE_CLUSTER_MIN_LAPSES_MIN}
              max={LAPSE_CLUSTER_MIN_LAPSES_MAX}
              step={1}
              aria-label={t("settings.minimumLapses")}
              value={s.lapseClusterMinLapses}
              data-testid="setting-lapse-cluster-min-lapses"
              disabled={!s.lapseClusterDetectionEnabled}
              onChange={(e) => void patch({ lapseClusterMinLapses: Number(e.target.value) })}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text disabled:opacity-50"
            />
            <span className="text-sm text-text-3">{t("settings.lapses")}</span>
            <input
              type="number"
              min={LAPSE_CLUSTER_MIN_CARDS_MIN}
              max={LAPSE_CLUSTER_MIN_CARDS_MAX}
              step={1}
              aria-label={t("settings.minimumCards")}
              value={s.lapseClusterMinCards}
              data-testid="setting-lapse-cluster-min-cards"
              disabled={!s.lapseClusterDetectionEnabled}
              onChange={(e) => void patch({ lapseClusterMinCards: Number(e.target.value) })}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text disabled:opacity-50"
            />
            <span className="text-sm text-text-3">{t("settings.cards")}</span>
            <input
              type="number"
              min={LAPSE_CLUSTER_WINDOW_DAYS_MIN}
              max={LAPSE_CLUSTER_WINDOW_DAYS_MAX}
              step={1}
              aria-label={t("settings.windowDays")}
              value={s.lapseClusterWindowDays}
              data-testid="setting-lapse-cluster-window"
              disabled={!s.lapseClusterDetectionEnabled}
              onChange={(e) => void patch({ lapseClusterWindowDays: Number(e.target.value) })}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text disabled:opacity-50"
            />
            <span className="text-sm text-text-3">{t("settings.days2")}</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.reReadProposals")}
          hint={t("settings.turnAStrugglingCardGroupIntoA")}
        >
          <div className="flex items-center gap-3">
            <Toggle
              name="setting-reread-proposals"
              checked={s.rereadProposalsEnabled}
              onChange={(value) => void patch({ rereadProposalsEnabled: value })}
            />
            <input
              type="number"
              min={REREAD_PROPOSAL_WEEKLY_CAP_MIN}
              max={REREAD_PROPOSAL_WEEKLY_CAP_MAX}
              step={1}
              aria-label={t("settings.activeProposalsAtOnce")}
              value={s.rereadProposalWeeklyCap}
              data-testid="setting-reread-proposal-cap"
              disabled={!s.rereadProposalsEnabled}
              onChange={(e) => void patch({ rereadProposalWeeklyCap: Number(e.target.value) })}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right font-mono font-semibold text-sm text-text disabled:opacity-50"
            />
            <span className="text-sm text-text-3">{t("settings.activeAtOnce")}</span>
          </div>
        </SettingRow>
      </SectionPanel>

      <SectionPanel title={t("settings.retentionByPriority")}>
        <SettingRow
          label={t("settings.perPriorityRetention")}
          hint={t("settings.holdHighValueACardsToA")}
        >
          <Toggle
            name="setting-retention-by-band"
            checked={s.retentionByBandEnabled}
            onChange={(value) => void setRetentionEnabled(value)}
          />
        </SettingRow>
        {PRIORITY_LABELS.map((band) => (
          <RetentionBandRow
            key={band}
            band={band}
            target={s.retentionByBand[band]}
            global={s.defaultDesiredRetention}
            enabled={s.retentionByBandEnabled}
            onSet={(b, t) => void setRetentionBand(b, t)}
          />
        ))}
      </SectionPanel>

      <WorkloadSimulator />

      <OptimizationPanel />

      <AiAssistancePanel settings={s} patch={patch} />

      <SearchIntelligencePanel />

      <SectionPanel title={t("settings.interface")}>
        <SettingRow label={t("common.language")}>
          <LanguageSetting disabled={backupControlsLocked} />
        </SettingRow>
        <SettingRow
          label={t("settings.displayName")}
          hint={t("settings.shownInTheSidebarLocalToThis")}
        >
          <input
            aria-label={t("settings.displayName")}
            type="text"
            data-testid="setting-display-name"
            value={s.displayName}
            maxLength={DISPLAY_NAME_MAX}
            placeholder={t("settings.localVault")}
            onChange={(e) => void patch({ displayName: e.target.value })}
            className="w-48 rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </SettingRow>

        <SettingRow label={t("settings.theme")} hint={t("settings.followTheSystemOrChooseAFixed")}>
          <Segmented
            name="setting-theme"
            value={s.theme}
            onChange={(value) => void patch({ theme: value as ThemePreference })}
            options={[
              {
                value: "system",
                get label() {
                  return t("settings.system");
                },
              },
              {
                value: "light",
                get label() {
                  return t("settings.light");
                },
              },
              {
                value: "dark",
                get label() {
                  return t("settings.dark");
                },
              },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.keyboardLayout")}
          hint={t("settings.affectsDefaultShortcutBindings")}
        >
          <Segmented
            name="setting-keyboard"
            value={s.keyboardLayout}
            onChange={(value) => void patch({ keyboardLayout: value })}
            options={KEYBOARD_LAYOUTS}
          />
        </SettingRow>
      </SectionPanel>

      <SectionPanel title={t("settings.dataAndBackup")}>
        <div className="border-border-faint border-b py-3.5" data-testid="settings-backup-note">
          <InlineHint slug="backup-vs-export" slugLabel={t("settings.backupVsExport")}>
            {t("settings.aBackupIsAFullRecoverableCopy")}
          </InlineHint>
        </div>
        <SettingRow
          label={t("settings.backUpNow")}
          hint={t("settings.exportTheDatabaseAssetVaultToA")}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              data-testid="settings-backup-now"
              disabled={backingUp || backupControlsLocked}
              onClick={() => void runBackup()}
              className={
                backingUp || backupControlsLocked
                  ? "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-3"
                  : "inline-flex items-center gap-2 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm hover:bg-accent-soft/80"
              }
            >
              <Icon name="download" size={14} />
              {backingUp ? t("settings.backingUp") : t("settings.backUpNow")}
            </button>
            <button
              type="button"
              data-testid="settings-open-backups-folder"
              disabled={openingBackupsFolder || dataReplacementBusy}
              onClick={() => void openBackupsFolder()}
              className={
                openingBackupsFolder || dataReplacementBusy
                  ? "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-3"
                  : "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-2 hover:border-border-strong hover:text-text"
              }
            >
              <Icon name="external" size={14} />
              {openingBackupsFolder ? t("settings.opening") : t("settings.openBackupsFolder")}
            </button>
          </div>
        </SettingRow>
        {backup ? (
          <SettingRow label={t("settings.lastBackup")} hint={backup.archiveName}>
            <span
              data-testid="settings-backup-result"
              className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2.5 py-1 text-ok text-xs"
            >
              <Icon name="check" size={13} />
              {formatBytes(backup.sizeBytes)} ·{" "}
              {t("settings.fileCount", { count: backup.fileCount })} · {backup.schemaVersion}
            </span>
          </SettingRow>
        ) : null}
        {dataRestartRequired ? (
          <SettingRow
            label={t("settings.restartRequired")}
            hint={t("settings.theLocalDataStoreWasReplaced")}
          >
            <span data-testid="settings-data-restart-required" className="text-danger text-sm">
              {t("settings.restartInterleaveBeforeChangingSettingsImportingOr")}
            </span>
          </SettingRow>
        ) : null}
        {backupError ? (
          <SettingRow label={t("settings.backupFailed")} hint={t("settings.seeTheErrorBelow")}>
            <span data-testid="settings-backup-error" className="text-danger text-sm">
              {backupError}
            </span>
          </SettingRow>
        ) : null}
        {backupFolderError ? (
          <SettingRow
            label={t("settings.openFolderFailed")}
            hint={t("settings.theBackupCommandIsStillAvailable")}
          >
            <span data-testid="settings-backup-folder-error" className="text-danger text-sm">
              {backupFolderError}
            </span>
          </SettingRow>
        ) : null}
        <SettingRow
          label={t("settings.availableBackups")}
          hint={
            backupListLoading
              ? t("settings.loadingAppManagedBackups")
              : backupArtifacts.length > 0
                ? t("settings.backupCount", { count: backupArtifacts.length })
                : t("settings.noRestorableAppManagedBackupsFound")
          }
        >
          <button
            type="button"
            data-testid="settings-backup-refresh"
            disabled={backupListLoading || backupControlsLocked}
            onClick={() => void loadBackupArtifacts()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text hover:bg-surface-2 disabled:opacity-40"
          >
            <Icon name="review" size={14} />
            {backupListLoading ? t("settings.refreshing") : t("settings.refresh")}
          </button>
        </SettingRow>
        {backupListError ? (
          <SettingRow label={t("settings.backupListFailed")} hint={t("settings.seeTheErrorBelow")}>
            <span data-testid="settings-backup-list-error" className="text-danger text-sm">
              {backupListError}
            </span>
          </SettingRow>
        ) : null}
        {backupArtifacts.length > 0 ? (
          <div
            data-testid="settings-backup-list"
            className="space-y-1.5 border-border-faint border-b py-3.5"
          >
            {backupArtifacts.map((artifact) => {
              const selected = artifact.timestamp === selectedBackupTimestamp;
              return (
                <button
                  key={artifact.timestamp}
                  type="button"
                  data-testid={`settings-backup-artifact-${artifact.timestamp}`}
                  aria-pressed={selected}
                  disabled={backupControlsLocked}
                  onClick={() => {
                    setSelectedBackupTimestamp(artifact.timestamp);
                    setRestorePhrase("");
                    setRestoreError(null);
                    setRestoreSuccess(null);
                  }}
                  className={
                    selected
                      ? "flex w-full flex-col gap-2 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-2 text-left disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between"
                      : "flex w-full flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between"
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm text-text">
                      {artifact.timestamp}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-text-3">
                      {artifact.automatic ? t("settings.automatic") : t("settings.manual")} ·{" "}
                      {format.date(artifact.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </span>
                  <span
                    className={
                      selected
                        ? "min-w-0 truncate font-medium text-accent-text text-xs"
                        : "min-w-0 truncate text-text-3 text-xs"
                    }
                  >
                    {formatBackupArtifactLabel(artifact)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <SettingRow
          label={t("settings.restoreSelectedBackup")}
          hint={
            selectedBackup
              ? t("settings.restoreHint", { phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE })
              : t("settings.selectABackupBeforeRestore")
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span id="settings-restore-confirm-help" className="sr-only">
              {t("settings.restoreHelp", { phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE })}
            </span>
            <input
              type="text"
              data-testid="settings-restore-confirm"
              aria-label={t("settings.restoreSelectedBackup")}
              aria-describedby="settings-restore-confirm-help"
              value={restorePhrase}
              disabled={!selectedBackup || backupControlsLocked}
              placeholder={RESTORE_BACKUP_CONFIRMATION_PHRASE}
              onChange={(e) => setRestorePhrase(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40 sm:w-44"
            />
            <button
              type="button"
              data-testid="settings-restore-backup"
              disabled={!canRestore}
              onClick={() => void restoreSelectedBackup()}
              className={
                canRestore
                  ? "inline-flex items-center gap-2 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm hover:bg-accent-soft/80"
                  : "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-3"
              }
            >
              <Icon name="restore" size={14} />
              {restoreBusy ? t("settings.restoring") : t("settings.restore")}
            </button>
          </div>
        </SettingRow>
        {restoreSuccess ? (
          <SettingRow
            label={t("settings.restoreComplete")}
            hint={t("settings.theAppDataChangedUnderneathThisUI")}
          >
            <span data-testid="settings-restore-success" className="text-ok text-sm">
              {restoreSuccess}
            </span>
          </SettingRow>
        ) : null}
        {restoreError ? (
          <SettingRow
            label={t("settings.restoreFailed")}
            hint={t("settings.backupsWerePreservedReviewTheErrorBelow")}
          >
            <span data-testid="settings-restore-error" className="text-danger text-sm">
              {restoreError}
            </span>
          </SettingRow>
        ) : null}
        <SettingRow
          label={t("settings.restoreFromAFile")}
          hint={
            selectedArchiveName
              ? t("settings.restoreFileHint", {
                  phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE,
                  name: selectedArchiveName,
                })
              : t("settings.chooseABackupZipSavedOnThis")
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              data-testid="settings-restore-file-choose"
              disabled={choosingArchive || backupControlsLocked}
              onClick={() => void chooseArchive()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-2 hover:border-border-strong hover:text-text disabled:opacity-40"
            >
              <Icon name="external" size={14} />
              {choosingArchive ? t("settings.choosing") : t("settings.chooseBackupFile")}
            </button>
            {selectedArchiveName ? (
              <span
                data-testid="settings-restore-file-path"
                className="min-w-0 truncate font-mono text-sm text-text-3"
              >
                {selectedArchiveName}
              </span>
            ) : null}
          </div>
        </SettingRow>
        {selectedArchiveName ? (
          <SettingRow
            label={t("settings.confirmFileRestore")}
            hint={t("settings.replaceWarning", { name: selectedArchiveName })}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span id="settings-restore-file-confirm-help" className="sr-only">
                {t("settings.restoreFileHelp", { phrase: RESTORE_BACKUP_CONFIRMATION_PHRASE })}
              </span>
              <input
                type="text"
                data-testid="settings-restore-file-confirm"
                aria-label={t("settings.restoreFromAFile")}
                aria-describedby="settings-restore-file-confirm-help"
                value={restoreFilePhrase}
                disabled={!selectedArchivePath || backupControlsLocked}
                placeholder={RESTORE_BACKUP_CONFIRMATION_PHRASE}
                onChange={(e) => setRestoreFilePhrase(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-40 sm:w-44"
              />
              <button
                type="button"
                data-testid="settings-restore-file"
                disabled={!canRestoreFile}
                onClick={() => void restoreFromFile()}
                className={
                  canRestoreFile
                    ? "inline-flex items-center gap-2 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm hover:bg-accent-soft/80"
                    : "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-3"
                }
              >
                <Icon name="restore" size={14} />
                {restoreFileBusy ? t("settings.restoring") : t("settings.restoreFromFile")}
              </button>
            </div>
          </SettingRow>
        ) : null}
        {restoreFileSuccess ? (
          <SettingRow
            label={t("settings.restoreComplete")}
            hint={t("settings.theAppDataChangedUnderneathThisUI")}
          >
            <span data-testid="settings-restore-file-success" className="text-ok text-sm">
              {restoreFileSuccess}
            </span>
          </SettingRow>
        ) : null}
        {restoreFileError ? (
          <SettingRow
            label={t("settings.fileRestoreFailed")}
            hint={t("settings.backupsWerePreservedReviewTheErrorBelow")}
          >
            <span data-testid="settings-restore-file-error" className="text-danger text-sm">
              {restoreFileError}
            </span>
          </SettingRow>
        ) : null}
        <SettingRow
          label={t("settings.freshStart")}
          hint={t("settings.resetHint", { phrase: RESET_LOCAL_DATA_CONFIRMATION_PHRASE })}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span id="settings-reset-confirm-help" className="sr-only">
              {t("settings.resetHelp", { phrase: RESET_LOCAL_DATA_CONFIRMATION_PHRASE })}
            </span>
            <input
              type="text"
              data-testid="settings-reset-confirm"
              aria-label={t("settings.freshStart")}
              aria-describedby="settings-reset-confirm-help"
              value={resetPhrase}
              disabled={backupControlsLocked}
              placeholder={RESET_LOCAL_DATA_CONFIRMATION_PHRASE}
              onChange={(e) => setResetPhrase(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-2 focus:ring-danger disabled:opacity-40 sm:w-48"
            />
            <button
              type="button"
              data-testid="settings-reset-local-data"
              disabled={!canReset}
              onClick={() => void resetLocalData()}
              className={
                canReset
                  ? "inline-flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 font-medium text-danger text-sm hover:bg-danger/15"
                  : "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-3"
              }
            >
              <Icon name="trash" size={14} />
              {resetBusy ? t("settings.resetting") : t("settings.startOver")}
            </button>
          </div>
        </SettingRow>
        {resetSuccess ? (
          <SettingRow
            label={t("settings.freshStartComplete")}
            hint={t("settings.backupsWerePreserved")}
          >
            <span data-testid="settings-reset-success" className="text-ok text-sm">
              {resetSuccess}
            </span>
          </SettingRow>
        ) : null}
        {resetError ? (
          <SettingRow
            label={t("settings.freshStartFailed")}
            hint={t("settings.backupsWerePreservedReviewTheErrorBelow")}
          >
            <span data-testid="settings-reset-error" className="text-danger text-sm">
              {resetError}
            </span>
          </SettingRow>
        ) : null}
      </SectionPanel>

      {/* Browser capture (T062) — the loopback-server pairing card. */}
      <section className="mb-6 scroll-mt-6" id="browser-capture" data-testid="settings-capture">
        <div className="mb-1.5 font-medium text-text-2 text-xs uppercase tracking-wide">
          {t("settings.browserCapture")}
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-4">
          <SettingRow
            label={t("settings.captureServer")}
            hint={t("settings.letTheInterleaveBrowserExtensionSavePages")}
          >
            <button
              type="button"
              data-testid="settings-capture-toggle"
              role="switch"
              aria-checked={pairing?.enabled ?? false}
              onClick={() => void toggleCapture(!(pairing?.enabled ?? false))}
              className={
                pairing?.enabled
                  ? "inline-flex items-center gap-2 rounded-md border border-accent-soft-bd bg-accent-soft px-3 py-1.5 font-medium text-accent-text text-sm"
                  : "inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-sm text-text-2 hover:border-border-strong"
              }
            >
              <Icon name={pairing?.enabled ? "check" : "globe"} size={14} />
              {pairing?.enabled ? t("settings.enabled") : t("settings.disabled")}
            </button>
          </SettingRow>

          {pairing?.enabled ? (
            <>
              <SettingRow
                label={t("settings.status")}
                hint={
                  pairing.running
                    ? t("settings.listening", { address: `127.0.0.1:${pairing.port ?? "—"}` })
                    : t("settings.starting")
                }
              >
                <span
                  data-testid="settings-capture-status"
                  className={
                    pairing.running
                      ? "inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2.5 py-1 text-ok text-xs"
                      : "inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-text-3 text-xs"
                  }
                >
                  <Icon name={pairing.running ? "check" : "clock"} size={13} />
                  {pairing.running ? t("settings.running") : t("settings.stopped")}
                </span>
              </SettingRow>

              <SettingRow
                label={t("settings.pairingToken")}
                hint={t("settings.openTheExtensionSOptionsAndPaste")}
              >
                <div className="flex items-center gap-2">
                  <code
                    data-testid="settings-capture-token"
                    className="max-w-[15rem] truncate rounded bg-surface px-2 py-1 font-mono text-text-2 text-xs"
                    title={tokenRevealed ? pairing.token : t("settings.hiddenUseCopy")}
                  >
                    {tokenRevealed ? pairing.token : "•".repeat(24)}
                  </code>
                  <button
                    type="button"
                    data-testid="settings-capture-copy"
                    onClick={() => void copyToken()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-medium text-sm text-text-2 hover:border-border-strong"
                  >
                    <Icon name={tokenCopied ? "check" : "copy"} size={13} />
                    {tokenCopied ? t("settings.copied") : t("settings.copy")}
                  </button>
                  <button
                    type="button"
                    data-testid="settings-capture-regenerate"
                    onClick={() => void regenerateToken()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-medium text-sm text-text-3 hover:border-border-strong"
                  >
                    <Icon name="review" size={13} />
                    {t("settings.regenerate")}
                  </button>
                </div>
              </SettingRow>

              {pairing.extensionOriginHint ? (
                <SettingRow
                  label={t("settings.pairedWith")}
                  hint={t("settings.theExtensionThatCompletedPairing")}
                >
                  <span
                    data-testid="settings-capture-origin"
                    className="font-mono text-text-3 text-xs"
                  >
                    {pairing.extensionOriginHint}
                  </span>
                </SettingRow>
              ) : null}
            </>
          ) : null}

          {pairingError ? (
            <SettingRow label={t("settings.captureError")} hint={t("settings.seeTheErrorBelow")}>
              <span data-testid="settings-capture-error" className="text-danger text-sm">
                {pairingError}
              </span>
            </SettingRow>
          ) : null}
        </div>
      </section>

      <SystemPanel />

      {error ? (
        <p data-testid="settings-error" className="mt-2 text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
