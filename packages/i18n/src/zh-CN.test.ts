import { describe, expect, it } from "vitest";
import { createI18n, english, type LanguageDefinition, languages } from "./index";
import { common } from "./locales/zh-CN/common";
import { menu } from "./locales/zh-CN/menu";
import { optimization } from "./locales/zh-CN/optimization";
import { settings } from "./locales/zh-CN/settings";
import { shell } from "./locales/zh-CN/shell";
import { trash } from "./locales/zh-CN/trash";
import { workload } from "./locales/zh-CN/workload";
import { validateLanguage } from "./validate";

// Check the translation files directly before they enter the shipped registry.
const chinese = {
  code: "zh-CN",
  nativeName: "Simplified Chinese",
  direction: "ltr",
  messages: { common, menu, optimization, settings, shell, trash, workload },
} as const satisfies LanguageDefinition;

describe("Simplified Chinese translation resources", () => {
  it.each(
    Object.keys(english) as (keyof typeof english)[],
  )("%s covers every source message without introducing unknown keys", (namespace) => {
    expect(Object.keys(chinese.messages[namespace]).sort()).toEqual(
      Object.keys(english[namespace]).sort(),
    );
  });

  it("preserves interpolation and plural contracts and has no empty translations", () => {
    expect(validateLanguage(chinese)).toEqual([]);
  });

  it.each([
    0, 1, 2, 1200,
  ])("renders Chinese plurals for count %i while preserving interpolated user content", (count) => {
    const instance = createI18n("zh-CN", [...languages, chinese]);
    const title = "User <title> {{raw}}";
    expect(instance.t("trash.restoredBatch", { count, title })).toBe(
      trash.restoredBatch_other
        .replace("{{count, number}}", new Intl.NumberFormat("zh-CN").format(count))
        .replace("{{title}}", title),
    );
  });
});
