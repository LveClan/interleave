import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MIGRATIONS_DIR, migrateDatabase, openDatabase } from "./index";

it("adds chapter range ownership with uniqueness and foreign keys without rebuilding lineage", () => {
  expect(readFileSync(join(MIGRATIONS_DIR, "0045_ordinary_mentallo.sql"), "utf8")).not.toMatch(
    /DROP TABLE|ALTER TABLE/i,
  );
  const handle = openDatabase(":memory:");
  try {
    migrateDatabase(handle.db);
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      handle.sqlite
        .prepare("INSERT INTO source_sections VALUES (?,?,?,?,?,?,?)")
        .run("missing", "source", "source", "range", "[]", "hash", "later"),
    ).toThrow();
    expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally {
    handle.sqlite.close();
  }
});
