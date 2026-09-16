import { describe, expect, it } from "vitest";
import { createI18n, english, type LanguageDefinition, languages } from "./index";
import { collection } from "./locales/zh-CN/collection";
import { common } from "./locales/zh-CN/common";
import { details } from "./locales/zh-CN/details";
import { home } from "./locales/zh-CN/home";
import { learning } from "./locales/zh-CN/learning";
import { menu } from "./locales/zh-CN/menu";
import { optimization } from "./locales/zh-CN/optimization";
import { options } from "./locales/zh-CN/options";
import { settings } from "./locales/zh-CN/settings";
import { shell } from "./locales/zh-CN/shell";
import { sourceReturn } from "./locales/zh-CN/sourceReturn";
import { supplement } from "./locales/zh-CN/supplement";
import { trash } from "./locales/zh-CN/trash";
import { workload } from "./locales/zh-CN/workload";
import { validateLanguage } from "./validate";

// Check source coverage as well as rendering through the shipped registry.
const chinese = {
  code: "zh-CN",
  nativeName: "Simplified Chinese",
  direction: "ltr",
  messages: {
    common,
    collection,
    details,
    learning,
    options,
    supplement,
    home,
    menu,
    optimization,
    settings,
    shell,
    trash,
    workload,
    sourceReturn,
  },
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
    expect(languages.find((language) => language.code === "zh-CN")?.messages).toEqual(
      chinese.messages,
    );
    const instance = createI18n("zh-CN");
    const title = "User <title> {{raw}}";
    expect(instance.t("trash.restoredBatch", { count, title })).toBe(
      trash.restoredBatch_other
        .replace("{{count, number}}", new Intl.NumberFormat("zh-CN").format(count))
        .replace("{{title}}", title),
    );
  });
});
