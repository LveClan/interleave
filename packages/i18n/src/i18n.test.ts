import { describe, expect, it } from "vitest";
import {
  canonicalLocale,
  createFormatters,
  createI18n,
  english,
  languages,
  resolveLocale,
} from "./index";
import { pseudoLanguage } from "./pseudo";

describe("local language registry and fallback", () => {
  it("ships only English and safely resolves unsupported and malformed language preferences", () => {
    expect(languages.map((language) => language.code)).toEqual(["en"]);
    for (const system of ["zh-CN", "fr-FR", "not a language", "", "en_US"]) {
      expect(resolveLocale("system", system)).toBe("en");
      expect(createI18n(system).t("menu.file")).toBe("File");
    }
    expect(canonicalLocale("en_US")).toBe("en-US");
  });

  it("accepts a new local resource, prioritizes explicit choice, and preserves script boundaries", () => {
    const chinese = {
      code: "zh-CN",
      nativeName: "test",
      direction: "ltr" as const,
      messages: { menu: { file: "test file" } },
    };
    const available = [...languages, chinese];
    expect(resolveLocale("system", "zh-Hans-SG", available)).toBe("zh-CN");
    expect(resolveLocale("en", "zh-CN", available)).toBe("en");
    expect(resolveLocale("system", "zh-TW", available)).toBe("en");
    const instance = createI18n("zh-CN", available);
    expect(instance.t("menu.file")).toBe("test file");
    expect(instance.t("menu.edit")).toBe("Edit");
  });

  it("uses English fallback for empty/missing translations and full-sentence plural interpolation", () => {
    const available = [...languages, pseudoLanguage(english)];
    const instance = createI18n("en-XA", available);
    expect(instance.t("menu.edit")).toBe("Edit");
    expect(instance.t("menu.file")).toContain("extended text for layout");
    instance.addResource("en-XA", "translation", "menu.view", "");
    expect(instance.t("menu.view")).toBe("View");
    for (const count of [0, 1, 2, 1200]) {
      const rendered = instance.t("trash.restoredBatch", { count, title: "User <title> {{raw}}" });
      expect(rendered).toContain(
        count === 1 ? "1 item ·" : `${new Intl.NumberFormat("en-XA").format(count)} items ·`,
      );
      expect(rendered).toContain("User <title> {{raw}}");
    }
  });
});

describe("presentation-only Intl formatting", () => {
  it("formats dates, numbers, units and relative time without changing timestamps", () => {
    const format = createFormatters("de-DE");
    const stored = "2026-09-15T12:00:00.000Z";
    expect(format.number(1234.5)).toBe("1.234,5");
    expect(format.date(stored, { dateStyle: "short", timeZone: "UTC" })).toBe("15.09.26");
    expect(format.relative(-2, "day")).toBe(
      new Intl.RelativeTimeFormat("de-DE", { numeric: "auto", style: "short" }).format(-2, "day"),
    );
    expect(format.bytes(1536)).toContain("1,5");
    expect(stored).toBe("2026-09-15T12:00:00.000Z");
    expect(createFormatters("bad locale").number(1234)).toBe("1,234");
    expect(format.date("invalid legacy timestamp")).toBe("");
  });
});
