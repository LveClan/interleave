import { createI18n } from "./index";

// Compile-only contract checks. Kept out of runtime entry points.
function checkMessages() {
  const { t } = createI18n();
  t("trash.restored", { title: "source title" });
  // @ts-expect-error Unknown message IDs must be rejected.
  t("trash.doesNotExist");
  // @ts-expect-error Required interpolation names come from the English literal.
  t("trash.restored", { incorrect: "source title" });
}
void checkMessages;
