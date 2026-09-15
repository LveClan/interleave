const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const binding = process.argv.includes("--electron")
  ? path.resolve(__dirname, "../native/better_sqlite3.node")
  : undefined;
const db = new Database(":memory:", binding ? { nativeBinding: binding } : {});
try {
  const row = db.prepare("SELECT sqlite_version() AS version, 1 AS ok").get();
  if (row.ok !== 1) throw new Error("SQLite query failed");
  const vecPath = path.resolve(
    __dirname,
    "../native",
    process.platform === "win32"
      ? "vec0.dll"
      : process.platform === "darwin"
        ? "vec0.dylib"
        : "vec0.so",
  );
  if (binding && fs.existsSync(vecPath)) {
    db.loadExtension(vecPath);
    if (!db.prepare("SELECT vec_version() AS v").get().v) throw new Error("sqlite-vec failed");
  }
  console.log(
    JSON.stringify({
      runtime: process.versions.electron ? "electron" : "node",
      platform: process.platform,
      arch: process.arch,
      abi: process.versions.modules,
      sqlite: row.version,
      binding: binding ?? "package default",
    }),
  );
} finally {
  db.close();
}
