import { common } from "./locales/en/common";
import { menu } from "./locales/en/menu";
import { optimization } from "./locales/en/optimization";
import { settings } from "./locales/en/settings";
import { shell } from "./locales/en/shell";
import { trash } from "./locales/en/trash";
import { workload } from "./locales/en/workload";
import { pseudoLanguage } from "./pseudo";

declare const __INTERLEAVE_I18N_TEST__: boolean;

export const english = { common, menu, settings, shell, trash, optimization, workload } as const;

export type Messages = {
  [N in keyof typeof english]?: Record<string, string>;
};

export interface LanguageDefinition {
  readonly code: string;
  readonly nativeName: string;
  readonly direction: "ltr" | "rtl";
  readonly messages: Messages;
}

// Static imports keep every supported locale available offline in both bundles.
export const languages: readonly LanguageDefinition[] = [
  { code: "en", nativeName: "English", direction: "ltr", messages: english },
  ...(typeof __INTERLEAVE_I18N_TEST__ !== "undefined" && __INTERLEAVE_I18N_TEST__
    ? [pseudoLanguage(english)]
    : []),
];
