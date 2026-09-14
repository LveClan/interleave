import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  preference: "system",
  systemLocale: "zh-CN",
  send: vi.fn(),
  install: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getLocale: () => h.systemLocale },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: h.send } }] },
}));
vi.mock("./menu", () => ({ installApplicationMenu: h.install }));

import { IPC_CHANNELS } from "../shared/channels";
import type { DbService } from "./db-service";
import { LocaleController } from "./locale";

describe("main language coordination", () => {
  beforeEach(() => {
    h.preference = "system";
    h.systemLocale = "zh-CN";
    h.send.mockClear();
    h.install.mockClear();
  });
  it("resolves unsupported systems and synchronizes all renderers from persisted settings", () => {
    const db = { getAppSettings: () => ({ settings: { language: h.preference } }) } as DbService;
    const controller = new LocaleController(db);
    expect(controller.sync()).toEqual({
      preference: "system",
      systemLocale: "zh-CN",
      locale: "en",
    });
    expect(h.install).toHaveBeenCalledOnce();
    expect(h.install.mock.calls[0]?.[0]("menu.file")).toBe("File");
    h.preference = "en";
    controller.sync();
    expect(h.send).toHaveBeenLastCalledWith(IPC_CHANNELS.localeChanged, {
      preference: "en",
      systemLocale: "zh-CN",
      locale: "en",
    });
    controller.sync();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.install).toHaveBeenCalledOnce();
  });
});
