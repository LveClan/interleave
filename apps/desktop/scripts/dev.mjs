import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Processes } from "../../../scripts/processes.mjs";
import { commandEnv, repoRoot } from "../../../scripts/toolchain.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const webRequire = createRequire(path.join(repoRoot, "apps/web/package.json"));
const processes = new Processes();
const args = process.argv.slice(2);
const built = args.includes("--built");
const smoke = args.includes("--smoke");
let dataDir;

function freePort(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Server exited before becoming ready: ${url}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* Server is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready within 60s: ${url}`);
}

async function verifyStartup(electron, port) {
  const { chromium } = await import("@playwright/test");
  const endpoint = `http://127.0.0.1:${port}`;
  await waitForServer(`${endpoint}/json/version`, electron.child);
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30_000 }));
    await page.waitForFunction(
      () => !!window.appApi && (document.getElementById("root")?.children.length ?? 0) > 0,
      null,
      { timeout: 30_000 },
    );
    const status = await page.evaluate(async () => ({
      health: await window.appApi.app.health(),
      db: await window.appApi.db.getStatus(),
      text: document.body.innerText.length,
      url: location.href,
    }));
    assert.equal(status.health.status, "ok");
    assert.equal(status.health.dbOpen, true);
    assert.equal(status.db.open, true);
    assert.equal(status.db.migrated, true);
    assert.equal(status.db.foreignKeys, 1);
    assert.equal(status.db.journalMode, "wal");
    assert.ok(status.db.appliedMigrations > 0);
    assert.ok(status.text > 0);
    assert.ok(built ? status.url.startsWith("app://") : status.url.startsWith("http://"));
    console.log(`[smoke] main + preload + renderer + SQLite: ${JSON.stringify(status)}`);
    if (process.platform === "darwin") {
      const session = await browser.newBrowserCDPSession();
      await session.send("Browser.close");
    } else {
      await page.evaluate(() => {
        setTimeout(() => window.close(), 0);
      });
    }
    let timer;
    try {
      await Promise.race([
        electron.done,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Electron did not close within 15s")), 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (args.some((arg) => !["--built", "--smoke"].includes(arg)))
    throw new Error("Usage: dev.mjs [--built] [--smoke]");
  const env = commandEnv();
  delete env.ELECTRON_RUN_AS_NODE;
  if (built) {
    delete env.VITE_DEV_SERVER_URL;
    for (const file of [
      "apps/desktop/dist/main.cjs",
      "apps/desktop/dist/preload.cjs",
      "apps/desktop/dist/job-worker.cjs",
      "apps/web/dist/index.html",
    ]) {
      if (!existsSync(path.join(repoRoot, file)))
        throw new Error(`${file} missing. Run node scripts/desktop.mjs build first.`);
    }
  } else {
    const explicit = process.env.VITE_DEV_SERVER_URL;
    const url = new URL(explicit ?? "http://127.0.0.1:5173");
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "VITE_DEV_SERVER_URL must be a local HTTP origin, e.g. http://127.0.0.1:5174",
      );
    }
    try {
      await freePort(Number(url.port || 80), url.hostname);
    } catch (error) {
      if (explicit || error.code !== "EADDRINUSE")
        throw new Error(`Dev port unavailable at ${url.origin}: ${error.message}`);
      url.port = String(await freePort(0, url.hostname));
    }
    env.VITE_DEV_SERVER_URL = url.origin;
    const viteCli = path.join(path.dirname(webRequire.resolve("vite/package.json")), "bin/vite.js");
    const vite = processes.spawn(
      process.execPath,
      [viteCli, "--host", url.hostname, "--port", url.port || "80", "--strictPort"],
      { cwd: path.join(repoRoot, "apps/web"), env },
    );
    vite.done.catch((error) => {
      if (!processes.closing) {
        console.error(error.message);
        processes.close();
        process.exitCode = 1;
      }
    });
    await waitForServer(url.origin, vite.child);
    console.log(`[dev] Renderer: ${url.origin}`);
    await processes.run(process.execPath, [path.join(desktopDir, "build.mjs")], {
      cwd: desktopDir,
      env,
    });
  }
  const electronArgs = [desktopDir];
  let debugPort;
  if (smoke) {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "interleave startup "));
    env.INTERLEAVE_DATA_DIR = dataDir;
    env.INTERLEAVE_DISABLE_AUTOMATIC_BACKUPS = "1";
    env.INTERLEAVE_DISABLE_EMBEDDING_MAINTENANCE = "1";
    env.INTERLEAVE_SUPPRESS_ONBOARDING = "1";
    for (const key of Object.keys(env)) {
      if (key.startsWith("INTERLEAVE_SEED_") || key === "INTERLEAVE_CAPTURE_ENABLED")
        delete env[key];
    }
    debugPort = await freePort(0, "127.0.0.1");
    electronArgs.push(
      `--user-data-dir=${path.join(dataDir, "chromium")}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
    );
    console.log(`[smoke] Isolated data directory: ${dataDir}`);
  }
  const electron = processes.spawn(require("electron"), electronArgs, { cwd: desktopDir, env });
  if (smoke) await verifyStartup(electron, debugPort);
  else await electron.done;
}

processes.handleSignals();
main()
  .catch((error) => {
    console.error(`[desktop] ${error.stack}`);
    process.exitCode = 1;
  })
  .finally(() => {
    processes.close();
    if (dataDir) {
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        console.error(`[smoke] Could not remove ${dataDir}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  });
