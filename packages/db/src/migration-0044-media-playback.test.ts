import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MIGRATIONS_DIR, migrateDatabase, openDatabase } from "./index";

it("adds playback storage without rebuilding lineage and enforces source and duration constraints", () => {
  const migration = readFileSync(join(MIGRATIONS_DIR, "0044_vengeful_mach_iv.sql"), "utf8");
  expect(migration).not.toMatch(/DROP TABLE|ALTER TABLE/i);
  const handle = openDatabase(":memory:");
  try {
    migrateDatabase(handle.db);
    handle.sqlite.exec(
      "INSERT INTO elements (id,type,status,stage,priority,title,created_at,updated_at) VALUES ('source','source','active','raw_source',0.5,'Media','2026-01-01','2026-01-01')",
    );
    const insert = handle.sqlite.prepare(
      "INSERT INTO source_media_playback (source_element_id,content_hash,duration_ms,coverage,updated_at) VALUES (?,?,?,?,?)",
    );
    expect(() => insert.run("missing", "hash", null, "[]", "2026-01-01")).toThrow();
    expect(() => insert.run("source", "hash", -1, "[]", "2026-01-01")).toThrow();
    expect(() => insert.run("source", "hash", null, "{}", "2026-01-01")).toThrow();
    insert.run("source", "hash", null, "[]", "2026-01-01");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally {
    handle.sqlite.close();
  }
});
