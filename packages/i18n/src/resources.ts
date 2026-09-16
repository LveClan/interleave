import { collection } from "./locales/en/collection";
import { common } from "./locales/en/common";
import { details } from "./locales/en/details";
import { home } from "./locales/en/home";
import { learning } from "./locales/en/learning";
import { menu } from "./locales/en/menu";
import { optimization } from "./locales/en/optimization";
import { options } from "./locales/en/options";
import { settings } from "./locales/en/settings";
import { shell } from "./locales/en/shell";
import { sourceReturn } from "./locales/en/sourceReturn";
import { supplement } from "./locales/en/supplement";
import { trash } from "./locales/en/trash";
import { workload } from "./locales/en/workload";
import { collection as zhCollection } from "./locales/zh-CN/collection";
import { common as zhCommon } from "./locales/zh-CN/common";
import { details as zhDetails } from "./locales/zh-CN/details";
import { home as zhHome } from "./locales/zh-CN/home";
import { learning as zhLearning } from "./locales/zh-CN/learning";
import { menu as zhMenu } from "./locales/zh-CN/menu";
import { optimization as zhOptimization } from "./locales/zh-CN/optimization";
import { options as zhOptions } from "./locales/zh-CN/options";
import { settings as zhSettings } from "./locales/zh-CN/settings";
import { shell as zhShell } from "./locales/zh-CN/shell";
import { sourceReturn as zhSourceReturn } from "./locales/zh-CN/sourceReturn";
import { supplement as zhSupplement } from "./locales/zh-CN/supplement";
import { trash as zhTrash } from "./locales/zh-CN/trash";
import { workload as zhWorkload } from "./locales/zh-CN/workload";
import { pseudoLanguage } from "./pseudo";

declare const __INTERLEAVE_I18N_TEST__: boolean;

export const english = {
  common,
  collection,
  details,
  learning,
  options,
  supplement,
  home,
  menu,
  settings,
  shell,
  trash,
  optimization,
  workload,
  sourceReturn,
} as const;

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
  {
    code: "zh-CN",
    nativeName: "简体中文",
    direction: "ltr",
    messages: {
      common: zhCommon,
      collection: zhCollection,
      details: zhDetails,
      learning: zhLearning,
      options: zhOptions,
      supplement: zhSupplement,
      home: zhHome,
      menu: zhMenu,
      optimization: zhOptimization,
      settings: zhSettings,
      shell: zhShell,
      sourceReturn: zhSourceReturn,
      trash: zhTrash,
      workload: zhWorkload,
    },
  },
  ...(typeof __INTERLEAVE_I18N_TEST__ !== "undefined" && __INTERLEAVE_I18N_TEST__
    ? [pseudoLanguage(english)]
    : []),
];
