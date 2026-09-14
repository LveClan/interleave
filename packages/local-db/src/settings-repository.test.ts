import {
  DAILY_REVIEW_BUDGET_MAX,
  DEFAULT_APP_SETTINGS,
  PRIORITY_LABEL_VALUE,
  SETTINGS_KEYS,
} from "@interleave/core";
import type { DbHandle } from "@interleave/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsRepository } from "./settings-repository";
import { createInMemoryDb } from "./test-db";

let handle: DbHandle;
let settings: SettingsRepository;

beforeEach(() => {
  handle = createInMemoryDb();
  settings = new SettingsRepository(handle.db);
});

afterEach(() => {
  handle.sqlite.close();
});

describe("SettingsRepository", () => {
  it("stores JSON values, overwrites them, and supports fallbacks/deletes", () => {
    expect(settings.getOr("missing", "fallback")).toBe("fallback");

    settings.set("reader.width", { px: 720 });
    expect(settings.get("reader.width")).toEqual({ px: 720 });

    settings.set("reader.width", { px: 840 });
    expect(settings.get("reader.width")).toEqual({ px: 840 });

    settings.delete("reader.width");
    expect(settings.get("reader.width")).toBeNull();
  });

  it("writes many settings in one call and returns a parsed record", () => {
    settings.setMany({
      "ui.theme": "dark",
      "queue.dailyBudget": 42,
      "nullable.value": null,
    });

    expect(settings.getAll()).toMatchObject({
      "ui.theme": "dark",
      "queue.dailyBudget": 42,
      "nullable.value": null,
    });
  });

  it("returns complete validated app settings and persists only coerced patch fields", () => {
    expect(settings.getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);

    const updated = settings.updateAppSettings({
      dailyReviewBudget: 9999,
      defaultSourcePriority: PRIORITY_LABEL_VALUE.A,
      theme: "dark",
      unknown: "ignored",
    });

    expect(updated.dailyReviewBudget).toBe(DAILY_REVIEW_BUDGET_MAX);
    expect(updated.defaultSourcePriority).toBe(PRIORITY_LABEL_VALUE.A);
    expect(updated.theme).toBe("dark");
    expect(updated.chronicPostponeThreshold).toBe(DEFAULT_APP_SETTINGS.chronicPostponeThreshold);
    expect(settings.get(SETTINGS_KEYS.dailyReviewBudget)).toBe(DAILY_REVIEW_BUDGET_MAX);
    expect(settings.get("unknown")).toBeNull();
  });

  it("persists the coerced chronic postpone threshold", () => {
    const updated = settings.updateAppSettings({ chronicPostponeThreshold: 999 });
    expect(updated.chronicPostponeThreshold).toBe(50);
    expect(settings.get(SETTINGS_KEYS.chronicPostponeThreshold)).toBe(50);
  });

  it("persists language in the existing settings store and rolls a failed multi-setting write back", () => {
    expect(settings.getAppSettings().language).toBe("system");
    settings.updateAppSettings({ language: "en" });
    expect(new SettingsRepository(handle.db).getAppSettings().language).toBe("en");
    expect(settings.get("ui.language")).toBe("en");
    const operation = handle.sqlite
      .prepare(
        "SELECT op_type, payload, element_id FROM operation_log WHERE op_type = 'set_language'",
      )
      .get() as { op_type: string; payload: string; element_id: string | null };
    expect(operation.op_type).toBe("set_language");
    expect(operation.element_id).toBeNull();
    expect(JSON.parse(operation.payload)).toEqual({
      key: "ui.language",
      previous: "system",
      next: "en",
    });
    expect(() => settings.setMany({ "ui.language": "zh-CN", invalid: 1n })).toThrow();
    expect(settings.getAppSettings().language).toBe("en");
    expect(
      handle.sqlite
        .prepare("SELECT count(*) AS n FROM operation_log WHERE op_type = 'set_language'")
        .get(),
    ).toEqual({ n: 1 });
    handle.sqlite.exec(
      "CREATE TRIGGER reject_language BEFORE INSERT ON operation_log WHEN NEW.op_type = 'set_language' BEGIN SELECT RAISE(ABORT, 'test rejection'); END",
    );
    expect(() => settings.updateAppSettings({ language: "system" })).toThrow("test rejection");
    expect(settings.getAppSettings().language).toBe("en");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
