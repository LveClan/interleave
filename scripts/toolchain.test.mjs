import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Processes } from "./processes.mjs";
import { commandEnv, satisfies } from "./toolchain.mjs";

test("engine bounds reject unsupported Node and unsupported range syntax", () => {
  for (const version of ["v22.13.1", "v22.23.2"])
    assert.equal(satisfies(version, ">=22.13.1 <23"), true);
  for (const version of ["v20.19.0", "v22.13.0", "v23.0.0", "v26.7.0"])
    assert.equal(satisfies(version, ">=22.13.1 <23"), false);
  assert.throws(() => satisfies("v22.23.2", "^22"), /Unsupported/);
});

test("child environment normalizes Windows PATH spelling and preserves overrides", () => {
  const env = commandEnv({
    Path: "custom path",
    PATH: "custom path",
    INTERLEAVE_DATA_DIR: "data with spaces",
  });
  assert.deepEqual(
    Object.keys(env).filter((key) => key.toLowerCase() === "path"),
    ["PATH"],
  );
  assert.equal(env.PATH.split(path.delimiter)[0], path.dirname(process.execPath));
  assert.ok(env.PATH.endsWith("custom path"));
  assert.equal(env.INTERLEAVE_DATA_DIR, "data with spaces");
});

test("subprocesses preserve spaces, shell metacharacters, environment and nonzero exits", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "interleave process "));
  const script = path.join(dir, "child with spaces.cjs");
  const processes = new Processes();
  try {
    writeFileSync(
      script,
      'const assert = require("node:assert/strict"); assert.equal(process.argv[2], "a & b % c"); assert.equal(process.env.PROBE_VALUE, "with spaces");',
    );
    const executable = path.join(
      dir,
      process.platform === "win32" ? "node with spaces.exe" : "node with spaces",
    );
    cpSync(process.execPath, executable);
    await processes.run(executable, [script, "a & b % c"], {
      cwd: dir,
      env: commandEnv({ PROBE_VALUE: "with spaces" }),
    });
    await assert.rejects(
      processes.run(process.execPath, ["-e", "process.exit(7)"]),
      /exited with 7/,
    );
    await assert.rejects(processes.run(path.join(dir, "missing-executable"), []), /ENOENT/);
  } finally {
    processes.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanup terminates a live child and its grandchild", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "interleave cleanup "));
  const ready = path.join(dir, "ready.json");
  const script = path.join(dir, "parent.cjs");
  writeFileSync(
    script,
    `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); require('node:fs').writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,child:child.pid})); setInterval(()=>{},1000);`,
  );
  const processes = new Processes();
  try {
    processes.spawn(process.execPath, [script, ready]);
    const deadline = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const pids = JSON.parse(readFileSync(ready, "utf8"));
    processes.close();
    for (const pid of Object.values(pids)) {
      let alive = true;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          alive = false;
        }
      }
      assert.equal(alive, false, `Process ${pid} survived cleanup`);
    }
  } finally {
    processes.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
