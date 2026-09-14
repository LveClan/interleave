import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { MIGRATIONS_DIR, migrateDatabase, openDatabase } from "./index";

it("adds the language operation without changing prior logs, settings, lineage or indexes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "interleave-language-migration-"));
  const staged = path.join(directory, "migrations");
  mkdirSync(path.join(staged, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const entries = journal.entries.filter((entry) => entry.idx <= 42);
  for (const entry of entries)
    cpSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(staged, `${entry.tag}.sql`));
  writeFileSync(path.join(staged, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  const handle = openDatabase(path.join(directory, "test.sqlite"));
  try {
    migrateDatabase(handle.db, staged);
    handle.sqlite.exec("INSERT INTO settings VALUES ('ui.theme', '\"dark\"')");
    handle.sqlite.exec(`
      INSERT INTO elements (id, type, status, stage, priority, title, created_at, updated_at)
      VALUES ('source', 'source', 'active', 'raw_source', 0.5, 'Original source', '2026-01-01', '2026-01-01');
      INSERT INTO elements (id, type, status, stage, priority, title, parent_id, source_id, created_at, updated_at)
      VALUES ('extract', 'extract', 'active', 'raw_extract', 0.5, 'Original extract', 'source', 'source', '2026-01-01', '2026-01-01');
    `);
    handle.sqlite.exec(
      "INSERT INTO operation_log (id, op_type, payload, created_at, batch_id) VALUES ('old', 'update_element', '{\"batchId\":\"batch\"}', '2026-01-01', 'batch')",
    );
    const old = handle.sqlite.prepare("SELECT * FROM operation_log").all();
    const lineage = handle.sqlite.prepare("SELECT * FROM elements ORDER BY id").all();
    migrateDatabase(handle.db, MIGRATIONS_DIR);
    expect(handle.sqlite.prepare("SELECT * FROM operation_log").all()).toEqual(old);
    expect(handle.sqlite.prepare("SELECT * FROM elements ORDER BY id").all()).toEqual(lineage);
    expect(handle.sqlite.prepare("SELECT * FROM settings").all()).toEqual([
      { key: "ui.theme", value: '"dark"' },
    ]);
    handle.sqlite.exec(
      "INSERT INTO operation_log (id, op_type, payload, created_at) VALUES ('language', 'set_language', '{}', '2026-09-15')",
    );
    expect(() =>
      handle.sqlite.exec(
        "INSERT INTO operation_log (id, op_type, payload, created_at) VALUES ('invalid', 'unknown', '{}', '2026-09-15')",
      ),
    ).toThrow();
    expect(() =>
      handle.sqlite.exec(
        "INSERT INTO operation_log (id, op_type, payload, created_at, element_id) VALUES ('fk', 'set_language', '{}', '2026-09-15', 'missing')",
      ),
    ).toThrow();
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(handle.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(
      (
        handle.sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE name = 'operation_log_batch_idx'")
          .get() as { sql: string }
      ).sql,
    ).toMatch(/WHERE.*batch_id.*IS NOT NULL/i);
  } finally {
    handle.sqlite.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
