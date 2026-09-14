import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { english, languages } from "./resources";
import { placeholders, validateLanguage } from "./validate";

const root = resolve(import.meta.dirname, "../../..");
const messages = Object.fromEntries(
  Object.entries(english).flatMap(([namespace, values]) =>
    Object.entries(values).map(([key, value]) => [`${namespace}.${key}`, value]),
  ),
);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
        ? [path]
        : [];
  });
}

describe("message resource checks", () => {
  it("validates registered resources and rejects unknown IDs, empty translations and changed placeholders", () => {
    for (const language of languages) expect(validateLanguage(language)).toEqual([]);
    expect(
      validateLanguage({
        code: "de",
        nativeName: "test",
        direction: "ltr",
        messages: {
          menu: { file: "", unknown: "text" },
          trash: { restored: "{{wrong}}", restoredBatch_one: "{{count, number}} {{title}}" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown message"),
        expect.stringContaining("empty message"),
        expect.stringContaining("interpolation mismatch"),
        expect.stringContaining("missing plural other"),
      ]),
    );
  });

  it("checks literal IDs and all required interpolation arguments at app call sites", () => {
    const errors: string[] = [];
    for (const path of [
      ...sources(join(root, "apps/web/src")),
      ...sources(join(root, "apps/desktop/src")),
    ]) {
      const text = readFileSync(path, "utf8");
      if (!text.includes("i18n")) continue;
      const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === "t") {
          const id = node.arguments[0];
          if (!id || !ts.isStringLiteral(id))
            errors.push(`${path}: t requires a literal message ID`);
          else {
            const source = messages[id.text] ?? messages[`${id.text}_other`];
            if (source === undefined) errors.push(`${path}: unknown ${id.text}`);
            else {
              const args = node.arguments[1];
              const names =
                args && ts.isObjectLiteralExpression(args)
                  ? args.properties.map((property) =>
                      property.name && ts.isIdentifier(property.name) ? property.name.text : "",
                    )
                  : [];
              const required = placeholders(source).map(
                (placeholder) => placeholder.split(",")[0]?.trim() ?? "",
              );
              if (messages[`${id.text}_other`]) required.push("count");
              for (const name of required)
                if (!names.includes(name)) errors.push(`${path}: ${id.text} missing ${name}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(errors).toEqual([]);
  });
});
