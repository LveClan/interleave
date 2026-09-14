import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function checkProductionLocales(root = repoRoot) {
  const locations = [
    path.join(root, "apps/desktop/dist/main.cjs"),
    path.join(root, "apps/desktop/dist/renderer/assets"),
    path.join(root, "apps/web/dist/assets"),
  ];
  for (const location of locations) {
    const bundle = location.endsWith(".cjs")
      ? readFileSync(location, "utf8")
      : readdirSync(location)
          .filter((file) => file.endsWith(".js"))
          .map((file) => readFileSync(path.join(location, file), "utf8"))
          .join("\n");
    for (const message of [
      "Could not save the language preference",
      "Keyboard shortcuts",
      "Restored {{count, number}}",
      "Default topic interval",
    ]) {
      if (!bundle.includes(message))
        throw new Error(`${location}: missing local English resource: ${message}`);
    }
    for (const sentinel of ["extended text for layout", "Long test language"]) {
      if (bundle.includes(sentinel))
        throw new Error(
          `${location}: test language is present; rebuild without INTERLEAVE_I18N_TEST`,
        );
    }
  }
  console.log(
    "[i18n] English resources found in main and both renderer artifacts; no test language.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  checkProductionLocales();
