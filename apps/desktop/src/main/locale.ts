import { createI18n, type LocaleState, resolveLocale, type TFunction } from "@interleave/i18n";
import { app, BrowserWindow } from "electron";
import { IPC_CHANNELS } from "../shared/channels";
import type { DbService } from "./db-service";
import { installApplicationMenu } from "./menu";

export class LocaleController {
  private readonly i18n = createI18n();
  private state: LocaleState | undefined;

  constructor(private readonly dbService: DbService) {}

  get translate(): TFunction {
    return this.i18n.t;
  }

  sync(): LocaleState {
    const preference = this.dbService.getAppSettings().settings.language;
    const systemLocale = app.getLocale();
    const locale = resolveLocale(preference, systemLocale);
    const next = { preference, systemLocale, locale };
    if (!this.state || locale !== this.state.locale) {
      void this.i18n.changeLanguage(locale);
      installApplicationMenu(this.i18n.t);
    }
    const changed = JSON.stringify(this.state) !== JSON.stringify(next);
    this.state = next;
    if (changed) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.localeChanged, next);
      }
    }
    return next;
  }
}
