import { describe, expect, it } from "vitest";
import { appSettingsFromStored, coerceSettingsPatch, settingsPatchToStored } from "./settings";

describe("language preference storage", () => {
  it("defaults old settings to system and preserves future languages for app-level resolution", () => {
    expect(appSettingsFromStored({}).language).toBe("system");
    expect(appSettingsFromStored({ "ui.language": "zh-CN" }).language).toBe("zh-CN");
    expect(appSettingsFromStored({ "ui.language": { invalid: true } }).language).toBe("system");
    expect(appSettingsFromStored({ "ui.language": "../../en" }).language).toBe("system");
    expect(settingsPatchToStored(coerceSettingsPatch({ language: "en" }))).toEqual({
      "ui.language": "en",
    });
  });
});
