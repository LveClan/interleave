/**
 * Package the desktop app on its target OS: macOS DMG or Windows x64 NSIS/ZIP.
 *
 * This is the single "ship" entry point — `pnpm --filter @interleave/desktop dist`
 * from the repository root. It wraps the EXISTING pipeline; it does not replace
 * it. Steps, in order:
 *
 *   1. Build the renderer            → apps/web/dist (Vite, offline asset URLs)
 *   2. Vendor the Electron-ABI addon → apps/desktop/native/better_sqlite3.node
 *   3. Bundle main + preload + stage → apps/desktop/dist/{main.cjs,preload.cjs,
 *      migrations + renderer + embedding model assets}        (build.mjs)
 *   4. electron-builder              → apps/desktop/release/ (.dmg or .exe/.zip)
 *
 * electron-builder is packaging-ONLY: it consumes the already-built `dist/` +
 * the vendored native module and produces the installer. Signing is driven by
 * `electron-builder.config.cjs`: macOS builds are ad-hoc signed by default;
 * `dist:release` uses the maintainer's optional Apple signing setup. Windows
 * builds need no Apple credentials and remain unsigned without a Windows certificate. The
 * native addon is `asarUnpack`ed so `dlopen` finds it at runtime (the #1
 * better-sqlite3 packaging failure mode); `native-binding.ts` rewrites the in-asar
 * path to the `app.asar.unpacked` sibling.
 *
 * Set INTERLEAVE_DIST_SKIP_BUILD=1 to skip steps 1–3 (re-package an existing
 * `dist/` for the same OS and architecture), or INTERLEAVE_DIST_DIR_ONLY=1 to
 * produce only the unpacked application (`--dir`, no installer or ZIP).
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProductionLocales } from "../../../scripts/check-i18n-build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

/** Run a command, inheriting stdio; throw on non-zero exit. */
function run(cmd, args, cwd = desktopDir, env = {}) {
  console.log(`\n[dist] $ ${cmd} ${args.join(" ")}  (cwd: ${path.relative(repoRoot, cwd) || "."})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function runPnpm(args, cwd = desktopDir) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Run packaging through pnpm --filter @interleave/desktop dist.");
  // Invoke the JS entry directly: execFileSync cannot execute pnpm.cmd on Windows.
  run(process.execPath, [cli, ...args], cwd);
}

export function packagingArgs(platform, arch, requested = []) {
  if (requested.some((arg) => !["--win", "--mac"].includes(arg)) || requested.length > 1) {
    throw new Error("Usage: pnpm --filter @interleave/desktop dist [--win | --mac]");
  }
  const target = requested.includes("--win")
    ? "win32"
    : requested.includes("--mac")
      ? "darwin"
      : platform;
  if (!["darwin", "win32"].includes(target) || target !== platform) {
    throw new Error(
      "Package on macOS or native Windows; native SQLite/ONNX assets must match the target OS.",
    );
  }
  if ((target === "win32" && arch !== "x64") || (target === "darwin" && arch !== "arm64")) {
    throw new Error("Supported package architectures: Windows x64 and macOS arm64.");
  }
  return [target === "win32" ? "--win" : "--mac", `--${arch}`, "--publish", "never"];
}

function main() {
  if (process.env.INTERLEAVE_I18N_TEST === "1") {
    throw new Error("The i18n test build cannot be packaged for distribution.");
  }
  const targetArgs = packagingArgs(process.platform, process.arch, process.argv.slice(2));
  const skipBuild = process.env.INTERLEAVE_DIST_SKIP_BUILD === "1";
  const dirOnly = process.env.INTERLEAVE_DIST_DIR_ONLY === "1";

  if (!skipBuild) {
    // 1) Renderer (apps/web/dist). build.mjs (step 3) stages this into dist/renderer.
    runPnpm(["--filter", "@interleave/web", "build"], repoRoot);

    // 2) Refresh the native addon for this host and Electron version before packaging.
    run(process.execPath, ["scripts/vendor-native.mjs"], desktopDir, {
      INTERLEAVE_SKIP_ELECTRON_REBUILD: "0",
    });

    // 2b) Vendor + verify the sqlite-vec vec0 loadable extension (T087). Runs the
    //     functional smoke test against the shipped binary and FAILS the build on an
    //     ABI mismatch, so a packaged app never ships a non-functional vec0.
    run(process.execPath, ["scripts/vendor-sqlite-vec.mjs"], desktopDir, {
      INTERLEAVE_REQUIRE_VEC: "1",
    });

    // 3) main.cjs + preload.cjs + dist/drizzle + dist/renderer + model assets.
    run(process.execPath, ["build.mjs"], desktopDir, { INTERLEAVE_REQUIRE_EMBEDDING_MODEL: "1" });
  } else {
    console.log("[dist] INTERLEAVE_DIST_SKIP_BUILD=1 — re-packaging existing dist/.");
  }

  checkProductionLocales(repoRoot);

  // 4) Package. `--dir` skips installer/archive creation.
  const ebArgs = ["electron-builder", ...targetArgs, "--config", "electron-builder.config.cjs"];
  if (dirOnly) ebArgs.push("--dir");
  runPnpm(["exec", ...ebArgs]);

  console.log("\n[dist] done — artifacts in apps/desktop/release/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
