import { english, type LanguageDefinition } from "./resources";

/** i18next's {{name, formatter}} placeholders; compare names and formatting contracts. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => (match[1] ?? "").trim())
    .sort();
}

export function validateLanguage(language: LanguageDefinition): string[] {
  const errors: string[] = [];
  for (const [namespace, messages] of Object.entries(language.messages)) {
    const source = english[namespace as keyof typeof english] as Record<string, string> | undefined;
    for (const [key, message] of Object.entries(messages)) {
      const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
      const original = source?.[key] ?? source?.[`${base}_other`];
      const path = `${language.code}.${namespace}.${key}`;
      if (original === undefined) errors.push(`${path}: unknown message`);
      else if (JSON.stringify(placeholders(original)) !== JSON.stringify(placeholders(message)))
        errors.push(`${path}: interpolation mismatch`);
      if (!message.trim())
        errors.push(`${path}: empty message; omit unfinished translations for fallback`);
      if (/\{\{|\}\}/.test(message.replace(/\{\{[^{}]+\}\}/g, "")))
        errors.push(`${path}: malformed interpolation`);
      if (base !== key) {
        for (const category of new Intl.PluralRules(language.code).resolvedOptions()
          .pluralCategories) {
          if (!messages[`${base}_${category}`]) errors.push(`${path}: missing plural ${category}`);
        }
      }
    }
  }
  return [...new Set(errors)];
}
