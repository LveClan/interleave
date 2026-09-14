import type { LanguageDefinition, Messages } from "./resources";

/** Test fixture only. Padding leaves interpolation and user content untouched. */
export function pseudoLanguage(english: Messages): LanguageDefinition {
  return {
    code: "en-XA",
    nativeName: "[Long test language]",
    direction: "ltr",
    messages: Object.fromEntries(
      Object.entries(english).map(([namespace, messages]) => [
        namespace,
        Object.fromEntries(
          Object.entries(messages)
            .filter(([key]) => !(namespace === "menu" && key === "edit"))
            .map(([key, message]) => [key, `[${message} extended text for layout]`]),
        ),
      ]),
    ),
  };
}
