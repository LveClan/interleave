/**
 * SettingsRepository (T008) — the canonical local store for user/domain settings.
 *
 * Settings (daily review budget, default desired retention, default topic
 * interval, default source priority, keyboard layout, theme) live in the SQLite
 * `settings` key/value table (T011 builds the UI on top). Values are stored as
 * JSON text and parsed on read. App-level desktop settings (e.g. window bounds)
 * stay in Electron config, not here.
 *
 * Legacy settings remain idempotent key upserts. Language preference writes append
 * `set_language` in the same transaction; no secrets enter that operation payload.
 */

import {
  type AppSettings,
  appSettingsFromStored,
  coerceSettingsPatch,
  coerceSettingValue,
  SETTINGS_KEYS,
  settingsPatchToStored,
} from "@interleave/core";
import { type InterleaveDatabase, settings } from "@interleave/db";
import { eq } from "drizzle-orm";
import { OperationLogRepository } from "./operation-log-repository";
import type { TransactionClient } from "./types";

export class SettingsRepository {
  constructor(private readonly db: InterleaveDatabase) {}

  /** Read and JSON-parse one setting by key, or `null` if unset. */
  get<T = unknown>(key: string): T | null {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? (JSON.parse(row.value) as T) : null;
  }

  /** Read one setting, falling back to `fallback` when unset. */
  getOr<T>(key: string, fallback: T): T {
    const value = this.get<T>(key);
    return value === null ? fallback : value;
  }

  /** Read all settings as a parsed key→value record. */
  getAll(): Record<string, unknown> {
    const rows = this.db.select().from(settings).all();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      out[row.key] = JSON.parse(row.value) as unknown;
    }
    return out;
  }

  /** Create or overwrite one setting (JSON-encoded). Returns the stored value. */
  set<T>(key: string, value: T): T {
    if (key === SETTINGS_KEYS.language) {
      this.setMany({ [key]: coerceSettingValue("language", value) });
      return this.get<T>(key) as T;
    }
    const json = JSON.stringify(value ?? null);
    this.db
      .insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json } })
      .run();
    return value;
  }

  /** Create/overwrite many settings in one transaction. */
  setMany(values: Record<string, unknown>): void {
    this.db.transaction((tx) => {
      this.setManyWithin(tx, values);
    });
  }

  /** Create/overwrite many settings inside a caller-owned transaction. */
  setManyWithin(tx: TransactionClient, values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
      const next = key === SETTINGS_KEYS.language ? coerceSettingValue("language", value) : value;
      const previousLanguage =
        key === SETTINGS_KEYS.language
          ? tx.select().from(settings).where(eq(settings.key, key)).get()?.value
          : undefined;
      const json = JSON.stringify(next ?? null);
      tx.insert(settings)
        .values({ key, value: json })
        .onConflictDoUpdate({ target: settings.key, set: { value: json } })
        .run();
      if (key === SETTINGS_KEYS.language && previousLanguage !== json) {
        new OperationLogRepository(tx).append(tx, {
          opType: "set_language",
          elementId: null,
          payload: {
            key,
            previous: previousLanguage ? JSON.parse(previousLanguage) : "system",
            next,
          },
        });
      }
    }
  }

  /** Delete one setting by key (settings are not user data — hard delete is fine). */
  delete(key: string): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }

  // ---------------------------------------------------------------------------
  // Typed app-settings surface (T011)
  //
  // The canonical user/domain settings (daily review budget, desired retention,
  // topic interval, default source priority, keyboard layout, theme) are read
  // and written as one validated `AppSettings` model layered on the key/value
  // store. Defaults fill any unset key, and every value is coerced/clamped via
  // `@interleave/core` so a corrupt/legacy row can never reach the scheduler/UI.
  // This is the surface the scheduler (T028/T036/T037) reads through.
  // ---------------------------------------------------------------------------

  /**
   * Read the complete, validated {@link AppSettings}. Unset keys resolve to the
   * canonical defaults, so the result is always complete even on a fresh DB.
   */
  getAppSettings(): AppSettings {
    return appSettingsFromStored(this.getAll());
  }

  /**
   * Apply a partial {@link AppSettings} patch (validated + coerced) in a single
   * transaction, then return the full resulting settings. Unknown fields are
   * dropped and out-of-range values are clamped before they are persisted.
   *
   * Accepts a loose record (the patch may arrive from validated-but-`undefined`-
   * permitting IPC) — `coerceSettingsPatch` keeps only the known, valid fields.
   */
  updateAppSettings(patch: Readonly<Record<string, unknown>>): AppSettings {
    const clean = coerceSettingsPatch(patch);
    const stored = settingsPatchToStored(clean);
    if (Object.keys(stored).length > 0) {
      this.setMany(stored);
    }
    return this.getAppSettings();
  }
}
